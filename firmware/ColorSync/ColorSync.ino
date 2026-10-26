/* ColorSync v3 — Arduino UNO R4 WiFi (not UNO R3 / R4 Minima)
   Install: Arduino UNO R4 Boards, ArduinoJson (7.x), LiquidCrystal I2C.
   LCD: standard HD44780 16x2 with an I2C backpack, SDA=A4, SCL=A5.
   Open http://<IP printed in Serial Monitor> on the same Wi-Fi.
   Game timing uses millis(); no delay loops while playing.
*/
#include <WiFiS3.h>
#include <Wire.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>
#include "web_assets.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#define WIFI_SSID "§"
#define WIFI_PASSWORD "8g654kp0"
#endif

const byte LED_PINS[4] = {2, 4, 6, 8};
const byte BUTTON_PINS[4] = {3, 5, 7, 9};

const byte BUZZER_PIN = 12;
// HIGH: pin -> resistor -> LED anode; LED cathode -> GND.
// Only set false if LEDs are wired from +5V through a resistor to the pin.
const bool LED_ACTIVE_HIGH = true;
const bool USE_SOUND = true;
const bool USE_LCD = true;
const unsigned int NOTES[4] = {500, 600, 700, 800};
const unsigned long PREPARE_MS = 2500, ROUND_MS = 1500, ANSWER_MS = 10000,
                    DEBOUNCE_MS = 25;
const unsigned int ON_MS[] = {600, 350, 180, 90}, GAP_MS[] = {250, 150, 100, 70};
const int TARGETS[] = {5, 7, 10, 15};
enum Phase { IDLE, PREPARING, WATCH, ANSWERING, ROUND, ENDED, STOPPED };
const char *PHASE_NAMES[] = {"idle",  "prepare", "watch",  "input",
                             "round", "ended",   "stopped"};
Phase phase = IDLE;
int speedIndex = 0, targetLevels = 5, level = 0, score = 0, playIndex = 0,
    answerIndex = 0;
byte sequence[15];
String matchId = "";
int playerIndex = 0;
uint32_t sequenceSeed = 1;
String nickname = "Player", deviceId, bootId, sessionId, lastStartRequest;
const char *endReason = "";
unsigned long revision = 0, sessionCounter = 0;
unsigned long dueAt = 0, answerAt = 0, feedbackUntil = 0;
unsigned long watchStartAt = 0, resultAt = 0, requestReceivedAt = 0;
int effectStep = -1;
int litColor = -1;
bool watchLit = false, inputReleased = false;
byte rawButtons = 0, stableButtons = 0;
unsigned long buttonsChangedAt = 0;
bool rawStart = false, stableStart = false;
unsigned long startChangedAt = 0;

LiquidCrystal_I2C lcd(0x27, 16, 2);
bool lcdReady = false;
char previousLCD[2][17] = {{0}, {0}};
unsigned long lcdUpdatedAt = 0;
WiFiServer server(80);
WiFiClient client;
bool wifiReady = false;
unsigned long wifiCheckedAt = 0, wifiAttemptAt = 0;
// Bounded HTTP request buffer; one request handled at a time.
char requestBuffer[2049];
size_t requestLength = 0;
int headerEnd = -1, bodyLength = 0;
unsigned long requestStartedAt = 0;
const uint8_t *responseData = nullptr;
size_t responseLength = 0, responseOffset = 0;
char jsonBuffer[1024];
bool sending = false;

bool activeGame() {
  return phase == PREPARING || phase == WATCH || phase == ANSWERING || phase == ROUND;
}
bool reached(unsigned long when) {
  return (long)(millis() - when) >= 0;
}
void touch() {
  ++revision;
}
void lightsOff() {
  for (byte i = 0; i < 4; ++i)
    digitalWrite(LED_PINS[i], LED_ACTIVE_HIGH ? LOW : HIGH);
  noTone(BUZZER_PIN);
  litColor = -1;
}
void showColor(int color) {
  lightsOff();
  if (color < 0 || color > 3)
    return;
  digitalWrite(LED_PINS[color], LED_ACTIVE_HIGH ? HIGH : LOW);
  if (USE_SOUND)
    tone(BUZZER_PIN, NOTES[color]);
  litColor = color;
}
void finishGame(const char *reason) {
  lightsOff();
  resultAt = millis();
  effectStep = -1;
  endReason = reason;
  phase = strcmp(reason, "stopped") == 0 ? STOPPED : ENDED;
  if (USE_SOUND)
    tone(BUZZER_PIN, strcmp(reason, "completed") == 0 ? 1200 : 220, 350);
  touch();
  Serial.print("Result: ");
  Serial.print(reason);
  Serial.print(" Score: ");
  Serial.println(score);
  // Result stays on LCD until the next game/configuration, no auto restart.
}
void beginRound() {
  level = score + 1;
  lightsOff();
  playIndex = answerIndex = 0;
  watchLit = false;
  phase = PREPARING;
  dueAt = millis() + PREPARE_MS;
  watchStartAt = dueAt;
  touch();
}
void startGame() {
  score = 0;
  level = 1;
  endReason = "";
  uint32_t x = sequenceSeed ? sequenceSeed : 1;
  for (int i = 0; i < 15; i++) {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    sequence[i] = x % 4;
  }
  sessionId = bootId + "-" + String(++sessionCounter);
  beginRound();
}
// ตรวจเวลาแล้วเปลี่ยนช่วงเกม ใช้ millis เพื่อให้เว็บยังติดต่อได้ระหว่างเล่น
void tickGame() {
  if (phase == PREPARING && reached(dueAt)) {
    phase = WATCH;
    touch();
  }
  if (litColor >= 0 && (phase == ANSWERING || phase == ROUND) && reached(feedbackUntil)) {
    lightsOff();
    touch();
  }
  if (phase == WATCH) {
    // Both board and website use this absolute schedule, without accumulated drift.
    unsigned long elapsed = millis() - watchStartAt;
    unsigned long step = ON_MS[speedIndex] + GAP_MS[speedIndex];
    unsigned long index = elapsed / step;
    int nextColor = -1;
    if (index < (unsigned long)level && elapsed % step < ON_MS[speedIndex])
      nextColor = sequence[index];
    if (nextColor != litColor) {
      if (nextColor < 0) lightsOff(); else showColor(nextColor);
      touch();
    }
    if (index >= (unsigned long)level) {
      phase = ANSWERING;
      inputReleased = false;
      answerAt = millis();
      touch();
    }
  } else if (phase == ANSWERING) {
    if (litColor >= 0 && reached(feedbackUntil))
      lightsOff();
    if (millis() - answerAt >= ANSWER_MS)
      finishGame("timeout");
  } else if (phase == ROUND && reached(dueAt)) {
    if (score >= targetLevels)
      finishGame("completed");
    else
      beginRound();
  }
}
byte readMask() {
  byte mask = 0;
  for (byte i = 0; i < 4; ++i)
    if (digitalRead(BUTTON_PINS[i]) == LOW)
      mask |= (1 << i);
  return mask;
}
// อ่านปุ่มและกรองสัญญาณเด้ง ก่อนตรวจคำตอบ
void tickButtons() {
  const unsigned long now = millis();
  byte mask = readMask();
  if (mask != rawButtons) {
    rawButtons = mask;
    buttonsChangedAt = now;
  }
  if (now - buttonsChangedAt < DEBOUNCE_MS)
    return;
  bool changed = stableButtons != rawButtons;
  stableButtons = rawButtons;
  if (phase != ANSWERING)
    return;
  if (!stableButtons) {
    inputReleased = true;
    return;
  }
  if (!changed || !inputReleased)
    return;
  inputReleased = false;
  if ((stableButtons & (stableButtons - 1)) != 0) {
    finishGame("wrong");
    return;
  }
  int color = 0;
  while (!(stableButtons & (1 << color)))
    ++color;
  int expected = answerIndex;
  if (color != sequence[expected]) {
    finishGame("wrong");
    return;
  }
  showColor(color);
  feedbackUntil = now + 90;
  ++answerIndex;
  answerAt = now;
  touch();
  if (answerIndex == level) {
    ++score;
    phase = ROUND;
    dueAt = now + ROUND_MS;
    if (USE_SOUND)
      tone(BUZZER_PIN, 1000, 180);
    touch();
  }
}
void lcdLine(byte row, const char *text) {
  char padded[17];
  memset(padded, ' ', 16);
  padded[16] = '\0';
  size_t n = strlen(text);
  if (n > 16)
    n = 16;
  memcpy(padded, text, n);
  if (strcmp(previousLCD[row], padded) == 0)
    return;
  lcd.setCursor(0, row);
  lcd.print(padded);
  strcpy(previousLCD[row], padded);
}
// Result animation runs in small steps; no delay() or waiting loops.
void tickEffects() {
  if (phase != ENDED) { effectStep = -1; return; }
  bool won = strcmp(endReason, "completed") == 0;
  unsigned long elapsed = millis() - resultAt;
  int step = elapsed / (won ? 160UL : 300UL);
  int count = won ? 16 : 6;
  if (step >= count) {
    if (effectStep != count) { lightsOff(); effectStep = count; }
    return;
  }
  if (step == effectStep) return;
  effectStep = step;
  lightsOff();
  if (won) {
    digitalWrite(LED_PINS[step % 4], LED_ACTIVE_HIGH ? HIGH : LOW);
    if (USE_SOUND) tone(BUZZER_PIN, 700 + (step % 4) * 200, 100);
  } else if (step % 2 == 0) {
    for (byte i = 0; i < 4; i++)
      digitalWrite(LED_PINS[i], LED_ACTIVE_HIGH ? HIGH : LOW);
    if (USE_SOUND) tone(BUZZER_PIN, 220, 150);
  }
}

// Four 10x8 pixel bunny expressions, two custom characters per face.
byte PET[8][8] = {{16, 17, 19, 31, 21, 31, 15, 7}, {1, 17, 25, 31, 21, 31, 30, 28},
                  {16, 17, 19, 31, 21, 31, 14, 7}, {1, 17, 25, 31, 21, 31, 14, 28},
                  {16, 17, 19, 31, 27, 31, 14, 7}, {1, 17, 25, 31, 27, 31, 14, 28},
                  {16, 17, 19, 31, 21, 31, 13, 7}, {1, 17, 25, 31, 21, 31, 22, 28}};
// อัปเดตข้อความและมาสคอตบน LCD
void tickLCD() {
  if (!lcdReady || millis() - lcdUpdatedAt < 150)
    return;
  lcdUpdatedAt = millis();
  char top[32], bottom[32];
  byte mood = (millis() / 650) % 2 ? 0 : 2;
  if (phase == IDLE) {
    snprintf(top, sizeof(top), "ColorSync READY");
    snprintf(bottom, sizeof(bottom), "Web / Serial1-4");
  } else if (phase == ENDED || phase == STOPPED) {
    snprintf(top, sizeof(top), "%s",
             phase == STOPPED                      ? "STOPPED"
             : strcmp(endReason, "completed") == 0 ? "YOU WIN!"
                                                   : "GAME OVER");
    snprintf(bottom, sizeof(bottom), "Score:%d/%d", score, targetLevels);
    mood = strcmp(endReason, "completed") == 0 ? 4 : 6;
    if (phase == ENDED) {
      unsigned long elapsed = millis() - resultAt;
      bool won = strcmp(endReason, "completed") == 0;
      if (elapsed < 2400) {
        snprintf(top, sizeof(top), "%s", won
          ? ((elapsed / 300) % 2 ? "* YOU WIN! *" : "  YOU WIN!  ")
          : ((elapsed / 300) % 2 ? " GAME OVER " : "! GAME OVER !"));
        if (won && (elapsed / 300) % 2) mood = 0;
      } else if ((elapsed / 2200) % 2) {
        snprintf(bottom, sizeof(bottom), "%s", won ? "Perfect memory!"
          : strcmp(endReason, "timeout") == 0 ? "Time ran out!" : "Try again!");
      }
    }
  } else {
    snprintf(top, sizeof(top), "Lv:%d Round:%d/%d", speedIndex + 1, level, targetLevels);
    if (phase == PREPARING) {
      long remaining = (long)(watchStartAt - millis());
      int seconds = remaining > 0 ? (remaining + 999) / 1000 : 0;
      snprintf(bottom, sizeof(bottom), "Ready... %d", seconds);
    }
    else if (phase == WATCH)
      snprintf(bottom, sizeof(bottom), "Watch %c", "|/-\\"[(millis()/200)%4]);
    else if (phase == ROUND) {
      snprintf(bottom, sizeof(bottom), (millis()/350)%2 ? "Nice! Score:%d" : "+1! Score:%d", score);
      mood = 4;
    } else {
      unsigned long used = millis() - answerAt;
      int seconds = used < ANSWER_MS ? (ANSWER_MS - used + 999) / 1000 : 0;
      snprintf(bottom, sizeof(bottom), "P:%d/%d %ds", answerIndex, level, seconds);
      mood = 2;
    }
  }
  lcdLine(0, top);
  bottom[14] = '\0';
  char padded[15];
  memset(padded, ' ', 14);
  padded[14] = 0;
  memcpy(padded, bottom, min((size_t)14, strlen(bottom)));
  static char lastBottom[15] = "";
  static byte lastMood = 255;
  if (strcmp(lastBottom, padded) != 0) {
    lcd.setCursor(0, 1);
    lcd.print(padded);
    strcpy(lastBottom, padded);
  }
  if (lastMood != mood) {
    lcd.setCursor(14, 1);
    lcd.write(mood);
    lcd.write((byte)(mood + 1));
    lastMood = mood;
  }
}

void closeClient() {
  client.stop();
  client = WiFiClient();
  requestLength = 0;
  headerEnd = -1;
  bodyLength = 0;
  sending = false;
  responseData = nullptr;
  responseLength = responseOffset = 0;
}
void respond(int code, const char *type, const uint8_t *data, size_t length,
             bool gzip = false) {
  client.print("HTTP/1.1 ");
  client.print(code);
  client.println(code == 200 ? " OK" : " Error");
  client.print("Content-Type: ");
  client.println(type);
  client.print("Content-Length: ");
  client.println(length);
  client.println("Connection: close");
  client.println("Cache-Control: no-store");
  if (gzip)
    client.println("Content-Encoding: gzip");
  client.println();
  responseData = data;
  responseLength = length;
  responseOffset = 0;
  sending = true;
  requestStartedAt = millis();
}
void errorResponse(int code, const char *message) {
  snprintf(jsonBuffer, sizeof(jsonBuffer), "{\"error\":\"%s\"}", message);
  respond(code, "application/json", (const uint8_t *)jsonBuffer, strlen(jsonBuffer));
}
size_t statusJSON(char *buffer, size_t capacity) {
  JsonDocument d;
  d["protocol"] = 3;
  d["transport"] = "scheduled-polling";
  d["receivedAt"] = requestReceivedAt;
  d["serverNow"] = millis();
  d["feedbackUntil"] = feedbackUntil;
  if (phase == PREPARING || phase == WATCH) {
    JsonObject plan = d["timeline"].to<JsonObject>();
    plan["start"] = watchStartAt;
    plan["on"] = ON_MS[speedIndex];
    plan["gap"] = GAP_MS[speedIndex];
    JsonArray colors = plan["colors"].to<JsonArray>();
    for (int i = 0; i < level; i++) colors.add(sequence[i]);
  }
  d["deviceId"] = deviceId;
  d["bootId"] = bootId;
  d["sessionId"] = sessionId;
  d["revision"] = revision;
  d["phase"] = PHASE_NAMES[phase];
  d["difficulty"] = speedIndex + 1;
  d["round"] = level;
  d["targetRounds"] = targetLevels;
  d["inputIndex"] = answerIndex;
  d["score"] = score;
  d["litColor"] = litColor;
  d["nickname"] = nickname;
  d["endReason"] = endReason;
  d["matchId"] = matchId;
  d["playerIndex"] = playerIndex;
  d["lcdReady"] = lcdReady;
  return serializeJson(d, buffer, capacity);
}
void statusResponse() {
  size_t n = statusJSON(jsonBuffer, sizeof(jsonBuffer));
  respond(200, "application/json", (const uint8_t *)jsonBuffer, n);
}
bool configure(JsonDocument &d) {
  int difficulty = d["difficulty"] | 0;
  int pi = d["playerIndex"] | 0;
  const char *name = d["nickname"] | "Player", *mid = d["matchId"] | "";
  if (difficulty < 1 || difficulty > 4 || pi < 0 || pi > 1 || strlen(name) > 80 ||
      strlen(mid) > 80)
    return false;
  speedIndex = difficulty - 1;
  targetLevels = TARGETS[speedIndex];
  nickname = name;
  matchId = mid;
  playerIndex = pi;
  sequenceSeed = d["seed"] | 1UL;
  return true;
}
// รับ URL จากเว็บ แล้วเรียกฟังก์ชันเริ่มเกม หยุดเกม หรือส่งสถานะ
void handleRequest() {
  char method[8], path[100];
  if (sscanf(requestBuffer, "%7s %99s", method, path) != 2) {
    errorResponse(400, "Bad request");
    return;
  }
  Serial.print("[HTTP] complete: ");
  Serial.print(method);
  Serial.print(" ");
  Serial.println(path);
  if (strcmp(method, "GET") == 0) {
    if (strcmp(path, "/api/status") == 0) {
      statusResponse();
      return;
    }
    for (size_t i = 0; i < ASSET_COUNT; i++)
      if (strcmp(path, WEB_ASSETS[i].path) == 0) {
        respond(200, WEB_ASSETS[i].mime, WEB_ASSETS[i].data, WEB_ASSETS[i].length, true);
        return;
      }
    errorResponse(404, "Not found");
    return;
  }
  if (strcmp(method, "POST") != 0) {
    errorResponse(405, "Use GET or POST");
    return;
  }
  JsonDocument d;
  if (deserializeJson(d, requestBuffer + headerEnd, bodyLength)) {
    errorResponse(400, "Invalid JSON");
    return;
  }
  if (strcmp(path, "/api/start") == 0) {
    String requestId = d["requestId"] | "";
    if (!requestId.length() || requestId.length() > 80) {
      errorResponse(400, "Missing requestId");
      return;
    }
    if (requestId == lastStartRequest) {
      statusResponse();
      return;
    }
    if (activeGame()) {
      errorResponse(409, "Game already active");
      return;
    }
    if (!configure(d)) {
      errorResponse(400, "Invalid settings");
      return;
    }
    lastStartRequest = requestId;
    Serial.println("[GAME] calling startGame");
    startGame();
    Serial.println("[GAME] started; preparing response");
    statusResponse();
    Serial.println("[HTTP] start response queued");
    return;
  }
  if (strcmp(path, "/api/stop") == 0) {
    String requestedSession = d["sessionId"] | "";
    if (requestedSession != sessionId || !sessionId.length()) {
      errorResponse(409, "Session changed");
      return;
    }
    if (activeGame())
      finishGame("stopped");
    statusResponse();
    return;
  }
  if (strcmp(path, "/api/config") == 0) {
    if (activeGame()) {
      errorResponse(409, "Finish current game first");
      return;
    }
    if (!configure(d)) {
      errorResponse(400, "Invalid settings");
      return;
    }
    phase = IDLE;
    score = level = 0;
    sessionId = "";
    endReason = "";
    lightsOff();
    touch();
    statusResponse();
    return;
  }
  errorResponse(404, "Not found");
}
// ค่อย ๆ อ่านคำขอ HTTP เพื่อไม่ขวางการอ่านปุ่ม
void tickHTTP() {
  if (!wifiReady)
    return;
  if (!client) {
    client = server.available();
    if (!client)
      return;
    requestLength = 0;
    headerEnd = -1;
    bodyLength = 0;
    requestStartedAt = millis();
    Serial.println("[HTTP] new connection");
  }
  if (millis() - requestStartedAt > 30000UL) {
    Serial.print("[HTTP] timeout; received=");
    Serial.print(requestLength);
    Serial.print(" headerEnd=");
    Serial.print(headerEnd);
    Serial.print(" bodyLength=");
    Serial.println(bodyLength);
    closeClient();
    return;
  }
    if (sending) {
    // ส่งครบแล้ว เว้นช่วงก่อนปิดการเชื่อมต่อ
    // ระหว่างรอ loop ยังทำงาน อ่านปุ่มและอัปเดตเกมได้
    if (responseOffset >= responseLength) {
      if (millis() - requestStartedAt >= 250UL) {
        Serial.print("HTTP sent: ");
        Serial.print(responseOffset);
        Serial.print("/");
        Serial.println(responseLength);

        closeClient();
      }
      return;
    }

    // เว้นจังหวะระหว่างส่งแต่ละชุด
    static unsigned long lastWriteAt = 0;

    if (millis() - lastWriteAt < 5UL) {
      return;
    }

    lastWriteAt = millis();

    // ส่งครั้งละไม่เกิน 256 bytes
    size_t remaining = responseLength - responseOffset;
    size_t amount = remaining;

    if (amount > 256) {
      amount = 256;
    }

    size_t bytesSent = client.write(
      responseData + responseOffset,
      amount
    );

    if (bytesSent > 0) {
      responseOffset += bytesSent;
      requestStartedAt = millis();
    }

    // ยังไม่ closeClient() ตรงนี้
    // ให้รอบถัดไปเข้าเงื่อนไขรอด้านบน
    return;
  }
  // Limit reads per loop so buttons/game/LCD continue updating.
  int budget = 256;
  while (budget-- && client.available()) {
    if (requestLength >= sizeof(requestBuffer) - 1) {
      errorResponse(413, "Request too large");
      return;
    }
    requestBuffer[requestLength++] = (char)client.read();
    requestBuffer[requestLength] = '\0';
    if (headerEnd < 0 && requestLength >= 4 &&
        strcmp(requestBuffer + requestLength - 4, "\r\n\r\n") == 0) {
      headerEnd = requestLength;
      // Headers are case-insensitive. Only Content-Length is needed here.
      String headers(requestBuffer);
      headers.toLowerCase();
      if (headers.indexOf("transfer-encoding:") >= 0) {
        errorResponse(400, "Chunked requests unsupported");
        return;
      }
      int at = headers.indexOf("content-length:");
      if (at >= 0)
        bodyLength = headers.substring(at + 15).toInt();
      Serial.print("[HTTP] headers received; body expected=");
      Serial.println(bodyLength);
      if (bodyLength < 0 || bodyLength > 768) {
        errorResponse(413, "Body too large");
        return;
      }
    }
    if (headerEnd >= 0 && requestLength >= (size_t)(headerEnd + bodyLength)) {
      requestReceivedAt = millis();
      handleRequest();
      return;
    }
  }
}
void tickWiFi() {
  if (millis() - wifiCheckedAt < 2000)
    return;
  wifiCheckedAt = millis();
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wifiReady) {
    server.begin();

    wifiReady = true;
    Serial.println("[BUILD] ColorSync SYNC FX 02");
    Serial.print("[WiFi firmware] ");
    Serial.println(WiFi.firmwareVersion());
    Serial.print("Open http://");
    Serial.println(WiFi.localIP());
  } else if (!connected) {
    if (wifiReady) {
      closeClient();
    }
    wifiReady = false;
    // WiFi.begin may block in the library; retry only between games.
    if (!activeGame() && strlen(WIFI_SSID) && millis() - wifiAttemptAt > 30000) {
      wifiAttemptAt = millis();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}
// ตั้งค่าขาอุปกรณ์ LCD และ Wi-Fi ครั้งเดียวตอนเปิดบอร์ด
void setup() {
  Serial.begin(115200); // Do not wait for Serial: standalone operation works.
  for (byte i = 0; i < 4; i++) {
    pinMode(LED_PINS[i], OUTPUT);
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  }
  pinMode(BUZZER_PIN, OUTPUT);
  lightsOff();
  randomSeed(analogRead(A0) ^ micros());
  bootId = String((unsigned long)random(1, 2147483647), HEX) + String(micros(), HEX);
  byte mac[6];
  WiFi.macAddress(mac);
  char id[20];
  snprintf(id, sizeof(id), "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3],
           mac[4], mac[5]);
  deviceId = id;
  if (USE_LCD) {
    Serial.println("Initializing I2C LCD...");
    Wire.begin();
    Wire.beginTransmission(0x27);
    lcdReady = Wire.endTransmission() == 0;
    if (lcdReady) {
      lcd.init();
      lcd.backlight();
      for (byte i = 0; i < 8; i++)
        lcd.createChar(i, PET[i]);
    } else
      Serial.println("LCD not found at 0x27; game continues.");
  }
  if (strlen(WIFI_SSID)) {
    wifiAttemptAt = millis();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  } else
    Serial.println("Set WiFi in secrets.h. Serial 1-4 works without WiFi.");
  Serial.println("Ready. Serial 1-4; buzzer=D12. LED pins=2,4,6,8.");
}
// เรียกตรวจทุกส่วนซ้ำตลอดเวลา ไม่มี delay ยาวในเกม
void loop() {
  tickButtons();
  tickGame();
  tickEffects();
  tickHTTP();
  tickLCD();
  tickWiFi();
  if (Serial.available()) {
    char c = Serial.read();
    if (!activeGame() && c >= '1' && c <= '4') {
      speedIndex = c - '1';
      targetLevels = TARGETS[speedIndex];
      sequenceSeed = micros();
      matchId = "";
      playerIndex = 0;
      nickname = "Player";
      startGame();
    }
  }
}
