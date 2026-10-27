(function () { "use strict";
// settings.js
const LEVELS = [
  {
    id: 1,
    name: "Beginner",
    on: 600,
    gap: 250,
    rounds: 5,
    label: "เริ่มจับจังหวะ",
  },
  {
    id: 2,
    name: "Intermediate",
    on: 350,
    gap: 150,
    rounds: 7,
    label: "ไวขึ้นอีกนิด",
  },
  {
    id: 3,
    name: "Advanced",
    on: 180,
    gap: 100,
    rounds: 10,
    label: "สมาธิต้องมา",
  },
  {
    id: 4,
    name: "Extreme",
    on: 90,
    gap: 70,
    rounds: 15,
    label: "จำให้ทัน ถ้าทำได้",
  },
];
const COLORS = ["แดง", "เหลือง", "เขียว", "น้ำเงิน"];
const ACTIVE = ["prepare", "watch", "input", "round"];
const TERMINAL = ["ended", "stopped"];
const REASONS = {
  wrong: "กดสีไม่ตรงลำดับ",
  timeout: "หมดเวลาตอบ",
  completed: "ผ่านครบทุกรอบ",
  stopped: "ยุติโดยผู้เล่น",
};
const RULES = "colorsync-classic-v3";
const PREPARE_MS = 1500,
  ROUND_MS = 1500,
  INPUT_MS = 10000;
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
// ใช้ seed เดียวกัน จะได้ลำดับสีเดียวกัน เพื่อใช้ในการแข่งสองคน
// สูตร xorshift32 ต้องตรงกับสูตรในเฟิร์มแวร์ ไม่จำเป็นต้องแก้เพื่อเปลี่ยนความเร็ว
function makeSequence(seed, length = 15) {
  let randomValue = seed >>> 0;
  if (randomValue === 0) {
    randomValue = 1;
  }
  const sequence = [];
  for (let index = 0; index < length; index++) {
    randomValue ^= randomValue << 13;
    randomValue ^= randomValue >>> 17;
    randomValue ^= randomValue << 5;
    const color = (randomValue >>> 0) % 4;
    sequence.push(color);
  }
  return sequence;
}
function initialState() {
  return {
    protocol: 3,
    deviceId: "demo",
    bootId: "browser",
    sessionId: "",
    revision: 0,
    phase: "idle",
    difficulty: 1,
    round: 0,
    targetRounds: 5,
    inputIndex: 0,
    score: 0,
    litColor: -1,
    nickname: "",
    endReason: "",
    matchId: "",
    playerIndex: 0,
  };
}
// ตรวจข้อมูลก่อนนำมาแสดง เพื่อไม่ให้เฟิร์มแวร์คนละรุ่นทำให้เว็บพัง
function validateStatus(status) {
  const errorMessage = "ต้องใช้เฟิร์มแวร์ ColorSync v3 ที่อยู่ในชุดดาวน์โหลด";
  if (!status || status.protocol !== 3) {
    throw new Error(errorMessage);
  }
  const allowedPhases = ["idle", ...ACTIVE, ...TERMINAL];
  const level = LEVELS.find((level) => level.id === status.difficulty);
  if (!allowedPhases.includes(status.phase) || !level) {
    throw new Error(errorMessage);
  }
  const textFields = ["deviceId", "bootId", "sessionId", "nickname", "matchId"];
  for (const field of textFields) {
    if (typeof status[field] !== "string") {
      throw new Error(errorMessage);
    }
  }
  const numberFields = ["revision", "round", "inputIndex", "score"];
  for (const field of numberFields) {
    if (!Number.isInteger(status[field]) || status[field] < 0) {
      throw new Error(errorMessage);
    }
  }
  const invalidProgress =
    status.targetRounds !== level.rounds ||
    status.round > status.targetRounds ||
    status.inputIndex > status.round ||
    status.score > status.targetRounds;
  const invalidColor =
    !Number.isInteger(status.litColor) ||
    status.litColor < -1 ||
    status.litColor > 3;
  if (invalidProgress || invalidColor || ![0, 1].includes(status.playerIndex)) {
    throw new Error(errorMessage);
  }
  if (status.phase !== "idle" && !status.sessionId) {
    throw new Error("ข้อมูลเกมไม่มี sessionId");
  }
  if (
    TERMINAL.includes(status.phase) &&
    !Object.hasOwn(REASONS, status.endReason)
  ) {
    throw new Error("ผลเกมไม่ครบ");
  }
  return status;
}

// timeline.js
// Signed difference also works across the Arduino millis() 32-bit rollover.
function difference(a, b) { return (a - b) | 0; }

// Render a scheduled round locally; scores always come from the board.
function visualState(status, boardNow) {
  const view = { ...status };
  const plan = status.timeline;
  if (plan && ['prepare', 'watch'].includes(status.phase)) {
    const elapsed = difference(boardNow, plan.start);
    const step = plan.on + plan.gap;
    const index = Math.floor(elapsed / step);
    view.litColor = -1;
    if (elapsed < 0) view.phase = 'prepare';
    else if (index < plan.colors.length) {
      view.phase = 'watch';
      if (elapsed % step < plan.on) view.litColor = plan.colors[index];
    } else view.phase = 'input';
  } else if (['input', 'round'].includes(status.phase) &&
             Number.isFinite(status.feedbackUntil) &&
             difference(boardNow, status.feedbackUntil) >= 0) {
    view.litColor = -1;
  }
  return view;
}

// storage.js
// เก็บประวัติในเบราว์เซอร์ ไม่ใช้ฐานข้อมูลหรือบัญชีผู้ใช้
// แยกคะแนน demo กับ hardware และแยกตามระดับความเร็ว

const resultKey = (status) =>
  [status.deviceId, status.bootId, status.sessionId].join(":");
const eligible = (record) =>
  ["wrong", "timeout", "completed"].includes(record.endReason);
class HistoryStore {
  constructor(storage, onError = () => {}) {
    this.storage = storage;
    this.onError = onError;
    this.records = [];
    this.matches = [];
    try {
      const savedData = JSON.parse(storage.getItem("colorsync:v3") || "null");
      if (savedData) {
        if (
          !Array.isArray(savedData.records) ||
          !Array.isArray(savedData.matches)
        ) {
          throw Error();
        }
        this.records = savedData.records.filter(
          (record) =>
            record &&
            record.rules === RULES &&
            ["demo", "hardware"].includes(record.origin) &&
            Number.isInteger(record.difficulty) &&
            record.difficulty >= 1 &&
            record.difficulty <= 4 &&
            typeof record.nickname === "string" &&
            Number.isInteger(record.score) &&
            typeof record.key === "string",
        );
        this.matches = savedData.matches.filter(
          (match) =>
            match &&
            match.rules === RULES &&
            Array.isArray(match.players) &&
            match.players.length === 2 &&
            match.players.every(
              (player) =>
                typeof player.nickname === "string" &&
                Number.isInteger(player.score),
            ),
        );
      }
    } catch {
      onError("อ่านประวัติไม่ได้ ระบบจะเริ่มประวัติชุดใหม่");
    }
  }
  save() {
    try {
      this.storage.setItem(
        "colorsync:v3",
        JSON.stringify({
          records: this.records,
          matches: this.matches,
        }),
      );
    } catch {
      this.onError("บันทึกในเบราว์เซอร์ไม่ได้ ผลยังอยู่ในหน้านี้จนกว่าจะปิด");
    }
  }
  // session เดิมต้องบันทึกเพียงครั้งเดียว แม้บอร์ดส่งผลเดิมมาซ้ำ
  add(status, origin) {
    if (!TERMINAL.includes(status.phase) || !status.sessionId) {
      return;
    }
    const key = resultKey(status);
    if (
      this.records.some(
        (record) => record.key === key && record.origin === origin,
      )
    ) {
      return;
    }
    this.records.unshift({
      ...status,
      key,
      origin,
      rules: RULES,
      endedAt: status.endedAt || new Date().toISOString(),
    });
    this.records = this.records.slice(0, 500);
    this.save();
  }
  addMatch(match) {
    if (this.matches.some((m) => m.id === match.id)) {
      return;
    }
    this.matches.unshift({
      ...match,
      rules: RULES,
      endedAt: new Date().toISOString(),
    });
    this.matches = this.matches.slice(0, 200);
    this.save();
  }
  // เกมที่ผู้เล่นหยุดเองจะไม่ถูกนำไปคิดคะแนนสูงสุด
  best(origin, difficulty, nickname) {
    const matchingRecords = this.records.filter(
      (record) =>
        record.origin === origin &&
        record.difficulty === difficulty &&
        eligible(record) &&
        (!nickname || record.nickname === nickname),
    );
    return matchingRecords.length
      ? Math.max(...matchingRecords.map((record) => record.score))
      : null;
  }
  clear(origin) {
    this.records = this.records.filter((record) => record.origin !== origin);
    this.matches = this.matches.filter((match) => match.origin !== origin);
    this.save();
  }
}
// คืน -1 เมื่อเสมอ, 0 เมื่อคนแรกชนะ, 1 เมื่อคนที่สองชนะ
function matchWinner(players) {
  const firstScore = players[0].score;
  const secondScore = players[1].score;
  if (firstScore === secondScore) {
    return -1;
  }
  if (firstScore > secondScore) {
    return 0;
  }
  return 1;
}

// mock-device.js
// เกมทดลองทำงานในเบราว์เซอร์ ไม่ส่งคำตอบไปบอร์ด
// ใช้ setTimeout เพื่อให้ไฟแสดงตามเวลาโดยหน้าเว็บยังตอบสนองได้

class MockDevice {
  constructor(
    onChange,
    {
      schedule = (fn, ms) => setTimeout(fn, ms),
      cancel = (id) => clearTimeout(id),
      now = () => Date.now(),
    } = {},
  ) {
    this.emitCallback = onChange;
    this.schedule = schedule;
    this.cancel = cancel;
    this.now = now;
    this.jobs = new Set();
    this.state = initialState();
    this.seq = [];
    this.lockUntil = 0;
  }
  // เปลี่ยนสถานะ แล้วแจ้ง app.js ให้อัปเดตหน้าจอ
  emit(patch = {}) {
    Object.assign(this.state, patch);
    this.state.revision++;
    this.emitCallback({
      ...this.state,
    });
  }
  later(fn, ms) {
    const id = this.schedule(() => {
      this.jobs.delete(id);
      fn();
    }, ms);
    this.jobs.add(id);
    return id;
  }
  // ล้างเวลาที่ตั้งไว้ เพื่อไม่ให้ไฟจากเกมเก่าย้อนกลับมาติด
  clear() {
    for (const id of this.jobs) {
      this.cancel(id);
    }
    this.jobs.clear();
  }
  async startGame(settings) {
    if (ACTIVE.includes(this.state.phase)) {
      throw Error("เกมกำลังเล่น");
    }
    this.clear();
    const levelSettings = LEVELS[settings.difficulty - 1];
    this.seq = makeSequence(settings.seed, levelSettings.rounds);
    this.lockUntil = 0;
    this.emit({
      ...settings,
      sessionId: uid(),
      round: 1,
      targetRounds: levelSettings.rounds,
      score: 0,
      inputIndex: 0,
      litColor: -1,
      endReason: "",
      endedAt: null,
      phase: "prepare",
    });
    this.play();
    return {
      ...this.state,
    };
  }
  // แสดงสีตามลำดับของรอบนี้ แล้วเปิดให้ผู้เล่นกด
  play() {
    this.emit({
      phase: "prepare",
      inputIndex: 0,
      litColor: -1,
    });
    const levelSettings = LEVELS[this.state.difficulty - 1];
    let at = PREPARE_MS;
    for (const color of this.seq.slice(0, this.state.round)) {
      this.later(
        () =>
          this.emit({
            phase: "watch",
            litColor: color,
          }),
        at,
      );
      this.later(
        () =>
          this.emit({
            litColor: -1,
          }),
        at + levelSettings.on,
      );
      at += levelSettings.on + levelSettings.gap;
    }
    this.later(() => {
      this.emit({
        phase: "input",
        inputIndex: 0,
        litColor: -1,
      });
      this.arm();
    }, at);
  }
  // เริ่มนับเวลาตอบ 10 วินาทีใหม่หลังคำตอบแต่ละครั้ง
  arm() {
    this.timeout = this.later(() => this.finish("timeout"), INPUT_MS);
  }
  // รับสี 0–3 ตรวจคำตอบ และเพิ่มคะแนนเมื่อถูกครบทั้งรอบ
  input(color) {
    if (
      this.state.phase !== "input" ||
      !Number.isInteger(color) ||
      color < 0 ||
      color > 3 ||
      this.now() < this.lockUntil
    ) {
      return;
    }
    this.cancel(this.timeout);
    this.jobs.delete(this.timeout);
    this.lockUntil = this.now() + 90;
    if (color !== this.seq[this.state.inputIndex]) {
      this.finish("wrong");
      return;
    }
    const count = this.state.inputIndex + 1;
    this.emit({
      litColor: color,
      inputIndex: count,
    });
    this.later(
      () =>
        this.emit({
          litColor: -1,
        }),
      90,
    );
    if (count === this.state.round) {
      this.emit({
        phase: "round",
        score: this.state.score + 1,
      });
      this.later(() => {
        if (this.state.score >= this.state.targetRounds) {
          this.finish("completed");
        } else {
          this.emit({
            round: this.state.round + 1,
          });
          this.play();
        }
      }, ROUND_MS);
    } else {
      this.arm();
    }
  }
  // จบเกมด้วยเหตุผล wrong, timeout, completed หรือ stopped
  finish(reason) {
    this.clear();
    this.emit({
      phase: reason === "stopped" ? "stopped" : "ended",
      endReason: reason,
      litColor: -1,
      endedAt: new Date(this.now()).toISOString(),
    });
  }
  async stopGame() {
    if (ACTIVE.includes(this.state.phase)) {
      this.finish("stopped");
    }
    return {
      ...this.state,
    };
  }
  dispose() {
    this.clear();
  }
}

// device-api.js



// ติดต่อบอร์ดจริงเท่านั้น ส่วนเกมทดลองอยู่ใน mock-device.js
class DeviceAPI {
  constructor(onState, onConnection) {
    this.onState = onState;
    this.onConnection = onConnection;
    this.queue = Promise.resolve();
    this.closed = true;
    this.lastSeen = 0;
    this.revision = -1;
    this.boot = "";
    this.clockBoot = "";
    this.clockSamples = [];
    this.clockOffset = null;
    this.latest = null;
    this.paintKey = "";
  }

  // ถ้ามี data จะส่ง POST ถ้าไม่มีจะอ่านข้อมูลด้วย GET
  request(path, data) {
    // Only one request at a time: polling cannot compete with Start/Stop.
    const next = this.queue.then(() => this.fetchStatus(path, data));
    this.queue = next.catch(() => {});
    return next;
  }

  async fetchStatus(path, data) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const options = {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    };
    if (data) {
      options.method = "POST";
      options.headers = {
        "Content-Type": "application/json",
      };
      options.body = JSON.stringify(data);
    }
    const sentAt = performance.now();
    try {
      const response = await fetch("/api/" + path, options);
      if (!response.ok) {
        throw new Error("บอร์ดตอบกลับ HTTP " + response.status);
      }
      const status = await response.json();
      validateStatus(status);
      this.updateClock(status, sentAt, performance.now());
      return status;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ไม่รับข้อมูลเก่ามาทับข้อมูลล่าสุด เมื่อบอร์ดรีเซ็ตให้เริ่มนับใหม่
  accept(status) {
    const bootKey = status.deviceId + ":" + status.bootId;
    if (bootKey !== this.boot) {
      this.boot = bootKey;
      this.revision = -1;
    }
    if (status.revision < this.revision) {
      return;
    }
    this.revision = status.revision;
    this.lastSeen = Date.now();
    this.onConnection(true);
    this.latest = status;
    this.paint();
  }
  updateClock(status, sentAt, receivedAt) {
    if (!Number.isFinite(status.serverNow) || !Number.isFinite(status.receivedAt)) return;
    const key = status.deviceId + ":" + status.bootId;
    if (key !== this.clockBoot) {
      this.clockBoot = key;
      this.clockSamples = [];
    }
    const serverWork = (status.serverNow - status.receivedAt) >>> 0;
    const travel = Math.max(0, receivedAt - sentAt - serverWork);
    // Translate board millis() into the browser performance.now() clock.
    const offset = status.serverNow + travel / 2 - receivedAt;
    this.clockSamples.push({ travel, offset });
    if (this.clockSamples.length > 12) this.clockSamples.shift();
    this.clockOffset = this.clockSamples.reduce((best, s) => s.travel < best.travel ? s : best).offset;
  }

  paint() {
    if (!this.latest || this.closed) return;
    const fresh = Date.now() - this.lastSeen < 4000;
    let view = this.latest;
    if (this.clockOffset !== null && fresh)
      view = visualState(this.latest, performance.now() + this.clockOffset);
    if (!fresh) {
      view = { ...view, litColor: -1 };
      this.onConnection(false);
    }
    const key = [view.bootId, view.revision, view.phase, view.litColor].join(":");
    if (key !== this.paintKey) {
      this.paintKey = key;
      this.onState(view);
    }
  }

  animate() {
    if (this.closed) return;
    this.paint();
    this.frame = requestAnimationFrame(() => this.animate());
  }

  async connect() {
    this.close();
    this.closed = false;
    const status = await this.request("status");
    if (this.closed) {
      return;
    }
    this.accept(status);

    this.schedulePoll();
    this.animate();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (this.closed) return;
    this.pollTimer = setTimeout(async () => {
      try {
        const status = await this.request("status");
        if (!this.closed) this.accept(status);
      } catch {
        if (!this.closed) this.onConnection(false);
      } finally {
        this.schedulePoll();
      }
    }, 200);
  }
  async startGame(settings) {
    const status = await this.request("start", {
      ...settings,
      requestId: uid(),
    });
    this.accept(status);
    return status;
  }
  async stopGame(sessionId) {
    const status = await this.request("stop", {
      sessionId: sessionId,
      requestId: uid(),
    });
    this.accept(status);
    return status;
  }
  close() {
    this.closed = true;
    clearTimeout(this.pollTimer);
    cancelAnimationFrame(this.frame);
    this.latest = null;
    this.paintKey = "";
  }
}

// logo.js
function drawPixelLogo() {
  // วาดตัวอักษรแบบพิกเซล ใช้ตกแต่งหัวเว็บเท่านั้น ไม่เกี่ยวกับกติกาเกม
  const glyphs = {
    C: ["01111", "11000", "11000", "11000", "11000", "11000", "01111"],
    O: ["01110", "11011", "11011", "11011", "11011", "11011", "01110"],
    L: ["11000", "11000", "11000", "11000", "11000", "11000", "11111"],
    R: ["11110", "11011", "11011", "11110", "11100", "11010", "11011"],
    S: ["01111", "11000", "11000", "01110", "00011", "00011", "11110"],
    Y: ["11011", "11011", "11011", "01110", "00100", "00100", "00100"],
    N: ["11011", "11011", "11111", "11111", "11111", "11011", "11011"],
  };
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "pixel-heading");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("viewBox", "0 0 53 7");
  svg.setAttribute("aria-hidden", "true");
  [..."COLORSYNC"].forEach((c, i) =>
    glyphs[c].forEach((row, y) =>
      [...row].forEach((v, x) => {
        if (v === "1") {
          const record = document.createElementNS(ns, "rect");
          record.setAttribute("x", i * 6 + x);
          record.setAttribute("y", y);
          record.setAttribute("width", "1");
          record.setAttribute("height", "1");
          record.setAttribute(
            "fill",
            i >= 5 ? "var(--accent)" : "currentColor",
          );
          svg.append(record);
        }
      }),
    ),
  );
  document.getElementById("pixel-title").replaceChildren(svg);
}

// app.js





// 1. เครื่องมือเล็ก ๆ สำหรับอ่านและแก้ข้อความในหน้า HTML
function getElement(id) {
  return document.getElementById(id);
}
function getElements(selector) {
  return Array.from(document.querySelectorAll(selector));
}

// 2. ตัวแปรที่ใช้จำสถานะของหน้าจอ
let dataSource = "hardware";
let isConnected = false;
let gameState = initialState();
let selectedDifficulty = 1;
let playMode = "solo";
let currentMatch = null;
let isStarting = false;
let soundEnabled = false;
let audioContext;
let lastLit = -1;
let lastReceived = "";
let toastTimer;
function showToast(message) {
  getElement("toast").textContent = message;
  getElement("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (getElement("toast").hidden = true), 4500);
}
let browserStorage;
try {
  browserStorage = localStorage;
} catch {
  browserStorage = {
    getItem: () => null,
    setItem: () => {
      throw Error("storage blocked");
    },
  };
}
const historyStore = new HistoryStore(browserStorage, showToast);
const demoDevice = new MockDevice((status) => {
  if (dataSource === "demo") {
    handleGameState(status);
  }
});
const boardApi = new DeviceAPI(
  (status) => {
    if (dataSource === "hardware") {
      handleGameState(status);
    }
  },
  (ok) => {
    isConnected = ok;
    updateScreen();
  },
);
const isGameActive = () => ACTIVE.includes(gameState.phase);
const areSettingsLocked = () =>
  isGameActive() ||
  isStarting ||
  !!(currentMatch && currentMatch.status === "between");
function setText(id, value) {
  // ข้ามถ้าไม่มี element นี้ในหน้าเว็บ เพื่อไม่ให้ทั้งหน้าพังตอนเชื่อมบอร์ด
  const element = getElement(id);
  if (element) element.textContent = value;
}
function confirmAction(title, text, onConfirm) {
  setText("confirm-title", title);
  setText("confirm-text", text);
  getElement("confirm-yes").onclick = () => {
    getElement("confirm-dialog").close();
    onConfirm();
  };
  getElement("confirm-dialog").showModal();
}
function playColorSound(color) {
  if (!soundEnabled || dataSource !== "demo" || color < 0) {
    return;
  }
  try {
    audioContext ??= new AudioContext();
    audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.frequency.value = [500, 600, 700, 800][color];
    volume.gain.setValueAtTime(0.045, audioContext.currentTime);
    volume.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + 0.12,
    );
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.13);
  } catch {}
}
// 3. จุดรับข้อมูลกลาง: ทั้งบอร์ดจริงและเกมทดลองส่งสถานะเข้าฟังก์ชันนี้
function handleGameState(status) {
  const key = [
    dataSource,
    status.deviceId,
    status.bootId,
    status.revision,
    status.phase,
    status.litColor,
  ].join(":");
  if (key === lastReceived) {
    return;
  }
  lastReceived = key;
  gameState = status;
  selectedDifficulty = status.difficulty;
  if (status.litColor !== lastLit) {
    playColorSound(status.litColor);
  }
  lastLit = status.litColor;
  if (TERMINAL.includes(status.phase)) {
    historyStore.add(status, dataSource);
    if (
      currentMatch &&
      status.matchId === currentMatch.id &&
      currentMatch.status !== "complete" &&
      currentMatch.status !== "canceled"
    ) {
      currentMatch.players[status.playerIndex] = {
        nickname: status.nickname,
        score: status.score,
        endReason: status.endReason,
      };
      if (status.endReason === "stopped") {
        currentMatch.status = "canceled";
      } else if (status.playerIndex === 0) {
        currentMatch.turn = 1;
        currentMatch.status = "between";
      } else {
        currentMatch.status = "complete";
        historyStore.addMatch(currentMatch);
      }
    }
  }
  updateScreen();
  updateHistoryScreen();
}
function resetScreen() {
  gameState = initialState();
  gameState.difficulty = selectedDifficulty;
  gameState.targetRounds = LEVELS[selectedDifficulty - 1].rounds;
  currentMatch = null;
  lastLit = -1;
}
function chooseSource(next) {
  if (isGameActive()) {
    return showToast("จบเกมปัจจุบันก่อนเปลี่ยนโหมด");
  }
  boardApi.close();
  demoDevice.dispose();
  dataSource = next;
  isConnected = false;
  resetScreen();
  getElement("history-source").value = next;
  getElement("match-source").value = next;
  updateScreen();
  updateHistoryScreen();
}
// เริ่มเกมเดี่ยว หรือเตรียมผู้เล่นและ seed ร่วมกันสำหรับการแข่งขัน
async function startGame() {
  if (
    isStarting ||
    isGameActive()
  ) {
    return;
  }
  // ถ้ายังไม่ต่อบอร์ด ปุ่มเริ่มจะเล่นเกมในเบราว์เซอร์แทน
  if (dataSource === "hardware" && !isConnected) {
    chooseSource("demo");
  }
  isStarting = true;
  updateScreen();
  try {
    if (playMode === "duel" && currentMatch?.status !== "between") {
      const names = [
        getElement("name-one").value.trim() || "Player 1",
        getElement("name-two").value.trim() || "Player 2",
      ];
      if (names[0] === names[1]) {
        throw Error("ใช้ชื่อผู้เล่นต่างกันเพื่อแยกคะแนน");
      }
      currentMatch = {
        id: uid(),
        seed: Math.floor(Math.random() * 4294967295) || 1,
        difficulty: selectedDifficulty,
        origin: dataSource,
        names,
        players: [null, null],
        turn: 0,
        status: "playing",
      };
    }
    const playerTurn = playMode === "duel" ? currentMatch.turn : 0;
    const settings = {
      difficulty: selectedDifficulty,
      nickname:
        playMode === "duel"
          ? currentMatch.names[playerTurn]
          : getElement("name-one").value.trim() || "Player 1",
      seed:
        playMode === "duel"
          ? currentMatch.seed
          : Math.floor(Math.random() * 4294967295) || 1,
      matchId: playMode === "duel" ? currentMatch.id : "",
      playerIndex: playerTurn,
    };
    if (currentMatch) {
      currentMatch.status = "playing";
    }
    await (dataSource === "demo" ? demoDevice : boardApi).startGame(settings);
  } catch (error) {
    showToast(error.message);
    if (currentMatch && currentMatch.players[0]) {
      currentMatch.status = "between";
    } else {
      currentMatch = null;
    }
  } finally {
    isStarting = false;
    updateScreen();
  }
}
async function stopGame() {
  if (!isGameActive()) {
    return;
  }
  try {
    await (dataSource === "demo" ? demoDevice : boardApi).stopGame(
      gameState.sessionId,
    );
  } catch (error) {
    showToast(error.message);
  }
}
// 4. อัปเดตหน้าจอ: เรียกฟังก์ชันย่อยตามส่วนที่ต้องแสดง
// ทุกส่วนอ่าน gameState ชุดเดียวกัน จึงแสดงรอบและคะแนนตรงกัน
function updateScreen() {
  updatePlayMode();
  updateConnectionStatus();
  updateGameMessage();
  updateColorPads();
  updatePlayerScores();
  updateGameControls();
  updateGameResult();
}
function updatePlayMode() {
  const isPlaying = isGameActive();
  const isDuelMode = playMode === "duel";
  document.querySelector(".arena-layout").classList.toggle("duel", isDuelMode);
  getElement("player-one").classList.toggle(
    "active-player",
    isPlaying && (!isDuelMode || currentMatch?.turn === 0),
  );
  getElement("player-two").classList.toggle(
    "active-player",
    isPlaying && isDuelMode && currentMatch?.turn === 1,
  );
  getElement("player-two").hidden = !isDuelMode;
  getElement("solo-panel").hidden = isDuelMode;
  getElements("[data-playmode]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.playmode === playMode);
    button.setAttribute("aria-pressed", button.dataset.playmode === playMode);
    button.disabled = areSettingsLocked();
  });
  setText(
    "mode-description",
    isDuelMode
      ? "ผลัดกันเล่น · ลำดับเดียวกัน · เริ่มที่ 1 สี"
      : "ทำลายสถิติของตัวเองซะมุฮาฮ่า",
  );
}
function updateConnectionStatus() {
  const isPlaying = isGameActive();
  setText(
    "connection-label",
    dataSource === "demo"
      ? "โหมดทดลอง"
      : isConnected
        ? "เชื่อมต่อบอร์ดแล้ว"
        : "ยังไม่เชื่อมต่อ",
  );
  getElement("connection").classList.toggle("connected", isConnected);
  setText(
    "source-label",
    dataSource === "demo"
      ? "ทดลองเล่นบนเว็บ"
      : isConnected
        ? "รับข้อมูลจากบอร์ดจริง"
        : "พร้อมเชื่อมต่อเครื่องเล่น",
  );
  setText(
    "source-description",
    dataSource === "demo"
      ? " · คะแนนทดลองเก็บแยกจากบอร์ดจริง"
      : isConnected
        ? " · กดคำตอบที่ปุ่มบนเครื่อง"
        : " หรือเริ่มจากโหมดทดลองบนเว็บ",
  );
  getElement("demo").hidden = dataSource === "demo";
  getElement("exit-demo").hidden = dataSource !== "demo";
  getElement("demo").disabled = isPlaying;
  getElement("exit-demo").disabled = isPlaying;
  setText("game-source", dataSource === "demo" ? "ทดลองบนเว็บ" : "เล่นกับบอร์ด");
  setText(
    "freshness",
    dataSource === "demo"
      ? "◉ ทดลอง"
      : isConnected
        ? "● เชื่อมต่อ"
        : "○ รอสัญญาณ",
  );
  setText(
    "hardware-note",
    dataSource === "demo"
      ? "กดปุ่มบนเว็บ หรือใช้แป้น 1–4"
      : "กดคำตอบที่ปุ่มสีบนเครื่อง",
  );
}
function updateGameMessage() {
  const isPlaying = isGameActive();
  const phases = {
    idle: [
      "พร้อมหรือยัง",
      "พร้อมท้าทายความจำอะเปล่า?",
      "ใส่ชื่อ เลือกระดับ แล้วกดเริ่มเกมเลย",
    ],
    prepare: [
      "เตรียมตัว",
      "เตรียมตัวให้พร้อม",
      "รอบนี้จำ " + gameState.round + " สี",
    ],
    watch: ["จำลำดับสี", "มองไฟ แล้วจำลำดับ", "รอไฟแสดงครบก่อนกดคำตอบ"],
    input: [
      "ตาคุณแล้ว",
      "ตาคุณแล้ว!",
      "กดตามลำดับที่จำได้ · 10 วินาทีต่อคำตอบ",
    ],
    round: [
      "ผ่านรอบแล้ว",
      "เยี่ยม! ผ่านอีกหนึ่งรอบ",
      "ได้ 1 คะแนน รอบหน้ามีสีเพิ่มอีกหนึ่งสี",
    ],
    ended: [
      "จบเกม",
      gameState.endReason === "completed"
        ? "ผ่านครบแล้ว!"
        : "ไว้ลองใหม่อีกครั้ง",
      REASONS[gameState.endReason] || "เกมจบแล้ว",
    ],
    stopped: ["หยุดเกม", "จบเกมแล้ว", "เกมที่หยุดเองไม่นับอันดับ"],
  };
  const phaseText = phases[gameState.phase] || phases.idle;
  setText("phase-label", phaseText[0]);
  setText("phase-title", phaseText[1]);
  setText("phase-help", phaseText[2]);
  if (dataSource === "hardware" && !isConnected && isPlaying) {
    setText("phase-help", "ขาดการเชื่อมต่อ · เกมบนบอร์ดอาจยังดำเนินอยู่");
  }
}
function updateColorPads() {
  const levelSettings = LEVELS[selectedDifficulty - 1];
  getElements("[data-color]").forEach((button) => {
    button.classList.toggle(
      "lit",
      +button.dataset.color === gameState.litColor &&
        (dataSource === "demo" || isConnected),
    );
    button.disabled = !(dataSource === "demo" && gameState.phase === "input");
  });
  setText("input-count", `${gameState.inputIndex} / ${gameState.round}`);
  // วาดขีดแสดงความคืบหน้า เช่น ตอบถูก 2 จาก 3 สี
  const progressContainer = getElement("input-pips");
  progressContainer.replaceChildren();
  for (let index = 0; index < gameState.round; index++) {
    const progressDot = document.createElement("i");
    if (index < gameState.inputIndex) {
      progressDot.className = "filled";
    }
    progressContainer.append(progressDot);
  }
  setText("level", String(selectedDifficulty).padStart(2, "0"));
  setText("round", `${gameState.round || "—"} / ${levelSettings.rounds}`);
  setText("score", gameState.score);
}
function updatePlayerScores() {
  const isPlaying = isGameActive();
  const isDuelMode = playMode === "duel";
  let playerTurn = 0;
  let firstScore = gameState.score;
  let secondScore = "—";
  let firstStatus = "พร้อมเล่น";
  let secondStatus = "รอเล่น";

  if (isPlaying) {
    firstStatus = "กำลังเล่น";
  }

  if (isDuelMode && currentMatch) {
    playerTurn = currentMatch.turn;

    // คนแรกเล่นจบแล้ว ใช้คะแนนที่เก็บไว้ ไม่เอาคะแนนคนที่สองมาทับ
    if (currentMatch.players[0]) {
      firstScore = currentMatch.players[0].score;
    } else if (playerTurn !== 0) {
      firstScore = 0;
    }

    if (currentMatch.players[1]) {
      secondScore = currentMatch.players[1].score;
    } else if (playerTurn === 1 && currentMatch.status === "playing") {
      secondScore = gameState.score;
    }

    if (playerTurn === 1) {
      firstStatus = "เล่นแล้ว";
      secondStatus = "ตาของคุณ";
    }
  }

  setText("score-one", firstScore);
  setText("score-two", secondScore);
  setText("p1-status", firstStatus);
  setText("p2-status", secondStatus);
  getElement("name-one").disabled = areSettingsLocked();
  getElement("name-two").disabled = areSettingsLocked();
  setText(
    "personal-best",
    historyStore.best(
      dataSource,
      selectedDifficulty,
      getElement("name-one").value.trim() || "Player 1",
    ) ?? "—",
  );
  setText(
    "personal-best-two",
    historyStore.best(
      dataSource,
      selectedDifficulty,
      getElement("name-two").value.trim() || "Player 2",
    ) ?? "—",
  );
  setText("all-best", historyStore.best(dataSource, selectedDifficulty) ?? "—");
}
function updateGameControls() {
  const isPlaying = isGameActive();
  const levelSettings = LEVELS[selectedDifficulty - 1];
  getElements("[data-level]").forEach((button) => {
    button.classList.toggle(
      "selected",
      +button.dataset.level === selectedDifficulty,
    );
    button.setAttribute(
      "aria-pressed",
      +button.dataset.level === selectedDifficulty,
    );
    button.disabled = areSettingsLocked();
  });
  getElement("start").disabled =
    isPlaying || isStarting;
  getElement("start").hidden = isPlaying;
  getElement("stop").hidden = !isPlaying;
  getElement("stop").disabled = dataSource === "hardware" && !isConnected;
  setText(
    "start",
    currentMatch?.status === "between"
      ? `เริ่มตา ${currentMatch.names[1]} ↗`
      : dataSource === "hardware" && !isConnected
        ? "เล่นบนเว็บ ↗"
        : "เริ่มเกม ↗",
  );
  setText(
    "start-help",
    dataSource === "hardware" && !isConnected
      ? "ไม่ต้องมีบอร์ด · คลิกสีบนจอหรือกด 1–4"
      : `${levelSettings.name} · ผ่านครบ ${levelSettings.rounds} รอบ`,
  );
}
function updateGameResult() {
  getElement("result").hidden = !TERMINAL.includes(gameState.phase);
  if (!getElement("result").hidden) {
    let title = `${gameState.nickname} ได้ ${gameState.score} คะแนน`;
    let detail = REASONS[gameState.endReason] || "";
    let action = "เล่นอีกครั้ง ↗";
    if (currentMatch?.status === "between") {
      title = `${currentMatch.names[0]} ได้ ${currentMatch.players[0].score} คะแนน`;
      detail = "ส่งเครื่องให้เพื่อน ทั้งสองคนเริ่มจาก 1 สีและใช้ลำดับเดียวกัน";
      action = `เริ่มตา ${currentMatch.names[1]} ↗`;
    } else if (currentMatch?.status === "complete") {
      const winnerIndex = matchWinner(currentMatch.players);
      title =
        winnerIndex === -1
          ? "เสมอกัน!"
          : `${currentMatch.names[winnerIndex]} ชนะ!`;
      detail = `${currentMatch.names[0]} ${currentMatch.players[0].score} : ${currentMatch.players[1].score} ${currentMatch.names[1]}`;
      action = "แข่งอีกครั้ง ↗";
    } else if (currentMatch?.status === "canceled") {
      title = "ยุติการแข่งขัน";
      detail = "การแข่งขันนี้ไม่มีผู้ชนะ";
    }
    setText("result-title", title);
    setText("result-detail", detail);
    setText("result-action", action);
    getElement("result-action").disabled =
      isStarting || (dataSource === "hardware" && !isConnected);
  }
}
function createElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) {
    element.className = className;
  }
  return element;
}
const formatDate = (dateString) =>
  new Date(dateString).toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  });
// 5. กรองประวัติตามแหล่งข้อมูล ระดับ และชื่อผู้เล่น
function updateHistoryScreen() {
  const origin = getElement("history-source").value;
  const difficultyFilter = Number(getElement("history-level").value);
  const search = getElement("history-search").value.trim().toLowerCase();
  const records = historyStore.records.filter(
    (record) =>
      record.origin === origin &&
      record.difficulty === difficultyFilter &&
      record.nickname.toLowerCase().includes(search),
  );
  const valid = records.filter(eligible);
  setText("history-total", records.length);
  setText(
    "history-best",
    valid.length ? Math.max(...valid.map((record) => record.score)) : "—",
  );
  setText(
    "history-wins",
    records.filter((record) => record.endReason === "completed").length,
  );
  getElement("history-empty").hidden = !!records.length;
  getElement("history-rows").replaceChildren(
    ...records.map((record) => {
      const row = createElement("tr", "");
      const who = createElement("td", "");
      who.append(
        createElement("b", record.nickname),
        createElement("small", formatDate(record.endedAt)),
      );
      row.append(
        who,
        createElement("td", record.matchId ? "แข่งขัน" : "เดี่ยว"),
        createElement("td", `${record.score} / ${record.targetRounds}`),
        createElement("td", REASONS[record.endReason] || record.endReason),
      );
      return row;
    }),
  );
  const rank = new Map();
  for (const record of valid) {
    rank.set(
      record.nickname,
      Math.max(rank.get(record.nickname) || 0, record.score),
    );
  }
  getElement("rank-list").replaceChildren(
    ...[...rank]
      .sort((firstPlayer, secondPlayer) => secondPlayer[1] - firstPlayer[1])
      .map(([playerName, bestScore], i) => {
        const row = createElement("div", "", "rank-row");
        row.append(
          createElement("span", String(i + 1).padStart(2, "0")),
          createElement("b", playerName),
          createElement("strong", bestScore),
        );
        return row;
      }),
  );
  updateMatchHistory();
}

// ประวัติแข่งจะถูกบันทึกเมื่อเล่นจบทั้งสองคนเท่านั้น
function updateMatchHistory() {
  const matches = historyStore.matches.filter(
    (matchRecord) =>
      matchRecord.origin === getElement("match-source").value &&
      matchRecord.difficulty === +getElement("match-level").value,
  );
  getElement("match-empty").hidden = !!matches.length;
  getElement("match-list").replaceChildren(
    ...matches.map((matchRecord) => {
      const card = createElement("article", "", "match-card");
      const winnerIndex = matchWinner(matchRecord.players);
      card.append(
        createElement(
          "div",
          `LEVEL ${matchRecord.difficulty} · ${formatDate(matchRecord.endedAt)}`,
          "eyebrow",
        ),
      );
      const scoreContainer = createElement("div", "", "match-versus");
      for (let i = 0; i < 2; i++) {
        const playerCard = createElement("div", "", "match-player");
        playerCard.append(
          createElement("span", matchRecord.players[i].nickname),
          createElement("strong", matchRecord.players[i].score),
        );
        scoreContainer.append(playerCard);
        if (i === 0) {
          scoreContainer.append(createElement("span", "VS"));
        }
      }
      card.append(
        scoreContainer,
        createElement(
          "p",
          winnerIndex === -1
            ? "เสมอกัน"
            : `${matchRecord.players[winnerIndex].nickname} ชนะ`,
        ),
      );
      return card;
    }),
  );
}
// 6. เปลี่ยนหน้าโดยดู #arena, #history หรือ #matches ใน URL
function showCurrentPage() {
  const hash = location.hash.slice(1);
  const view = ["home", "arena", "history", "matches"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "home";
  getElements(".view").forEach(
    (element) => (element.hidden = element.id !== view),
  );
  getElements("[data-nav]").forEach((element) => {
    const selected = element.dataset.nav === view;
    element.classList.toggle("active", selected);
    if (selected) element.setAttribute("aria-current", "page");
    else element.removeAttribute("aria-current");
  });
  updateHistoryScreen();
  if (hash === "abstract") document.getElementById("abstract").scrollIntoView({ behavior: "smooth" });
}
// 7. สร้างปุ่มเลือกระดับและผูกเหตุการณ์การกดปุ่ม
for (const levelSettings of LEVELS) {
  const button = createElement("button", "", "level-option");
  button.dataset.level = levelSettings.id;
  button.innerHTML = `<span class="level-number">0${levelSettings.id}</span><span><b>${levelSettings.name}</b><small>${levelSettings.on} ms · ${levelSettings.rounds} รอบ</small></span>`;
  button.onclick = () => {
    selectedDifficulty = levelSettings.id;
    resetScreen();
    updateScreen();
  };
  getElement("levels").append(button);
  for (const id of ["history-level", "match-level"]) {
    const option = createElement(
      "option",
      `${levelSettings.id} · ${levelSettings.name} · ${levelSettings.rounds} รอบ`,
    );
    option.value = levelSettings.id;
    getElement(id).append(option);
  }
}
getElements("[data-playmode]").forEach(
  (button) =>
    (button.onclick = () => {
      playMode = button.dataset.playmode;
      resetScreen();
      updateScreen();
    }),
);
getElement("start").onclick = startGame;
getElement("result-action").onclick = startGame;
getElement("stop").onclick = () =>
  confirmAction(
    "จบเกมนี้?",
    "คะแนนที่หยุดเองจะไม่เข้าร่วมอันดับ หากกำลังแข่งจะยกเลิกการแข่งขัน",
    stopGame,
  );
getElement("demo").onclick = () => chooseSource("demo");
getElement("exit-demo").onclick = () => chooseSource("hardware");
for (const id of ["connection", "how-to"]) {
  getElement(id).onclick = () => getElement("connect-dialog").showModal();
}
getElement("connect-device").onclick = async () => {
  if (isGameActive() && dataSource === "demo") {
    return showToast("จบเกมทดลองก่อน");
  }
  dataSource = "hardware";
  setText("connect-message", "กำลังตรวจสอบ…");
  try {
    await boardApi.connect();
    setText("connect-message", "เชื่อมต่อแล้ว");
    getElement("connect-dialog").close();
  } catch {
    setText(
      "connect-message",
      "ยังไม่เจอบอร์ด ลองเปิด IP จาก Serial Monitor หรือเลือกทดลองเล่น",
    );
    isConnected = false;
    updateScreen();
  }
};
getElements("[data-close]").forEach(
  (button) => (button.onclick = () => getElement(button.dataset.close).close()),
);
getElements("[data-color]").forEach(
  (button) => (button.onclick = () => demoDevice.input(+button.dataset.color)),
);
document.addEventListener("keydown", (event) => {
  if (
    event.repeat ||
    /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) ||
    document.querySelector("dialog[open]")
  ) {
    return;
  }
  if (dataSource === "demo" && "1234".includes(event.key)) {
    event.preventDefault();
    demoDevice.input(+event.key - 1);
  }
});
getElement("sound").onclick = () => {
  soundEnabled = !soundEnabled;
  setText("sound", soundEnabled ? "♫ ปิดเสียง" : "♫ เปิดเสียง");
  getElement("sound").setAttribute("aria-pressed", soundEnabled);
};
function applyTheme(themeName) {
  document.documentElement.dataset.theme = themeName;
  getElement("theme")?.setAttribute(
    "aria-label",
    themeName === "dark" ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด",
  );
  if (getElement("theme")) setText("theme", themeName === "dark" ? "☼" : "☾");
  try {
    localStorage.setItem("colorsync:theme", themeName);
  } catch {}
}
if (getElement("theme")) getElement("theme").onclick = () =>
  applyTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );
try {
  applyTheme(localStorage.getItem("colorsync:theme") || "dark");
} catch {
  applyTheme("dark");
}
for (const id of [
  "history-source",
  "history-level",
  "history-search",
  "match-source",
  "match-level",
]) {
  getElement(id).addEventListener("input", updateHistoryScreen);
}
for (const id of ["name-one", "name-two"]) {
  getElement(id).addEventListener("input", updateScreen);
}
getElement("clear-history").onclick = () =>
  confirmAction(
    "ล้างประวัติแหล่งข้อมูลนี้?",
    "จะลบทั้งประวัติเกมและผลการแข่งขันของแหล่งข้อมูลที่เลือกทุกระดับ การลบย้อนกลับไม่ได้",
    () => {
      historyStore.clear(getElement("history-source").value);
      updateHistoryScreen();
      updateScreen();
    },
  );
getElement("new-match").onclick = () => {
  location.hash = "arena";
  if (areSettingsLocked()) {
    return showToast("จบเกมปัจจุบันก่อน");
  }
  playMode = "duel";
  resetScreen();
  updateScreen();
};
window.addEventListener("hashchange", showCurrentPage);
window.addEventListener("beforeunload", (event) => {
  if (isGameActive()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
updateScreen();
showCurrentPage();
// Only probe a board automatically when served from a local address.
// บอร์ดเสิร์ฟเว็บที่พอร์ต 80 เท่านั้น ถ้าเปิดจาก Live Server (เช่นพอร์ต 5500) จะไม่ probe
if (
  location.protocol === "http:" &&
  (location.port === "" || location.port === "80") &&
  (/^(\d{1,3}\.){3}\d{1,3}$/.test(location.hostname) ||
    location.hostname.endsWith(".local"))
) {
  boardApi.connect().catch(() => {
    isConnected = false;
    updateScreen();
  });
}

// ตกแต่งหัวเว็บ แยกไว้ต่างหากเพื่อให้อ่านส่วนเกมได้ง่าย
drawPixelLogo();
})();