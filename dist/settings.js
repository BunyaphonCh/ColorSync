export const LEVELS = [
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
export const COLORS = ["แดง", "เหลือง", "เขียว", "น้ำเงิน"];
export const ACTIVE = ["prepare", "watch", "input", "round"];
export const TERMINAL = ["ended", "stopped"];
export const REASONS = {
  wrong: "กดสีไม่ตรงลำดับ",
  timeout: "หมดเวลาตอบ",
  completed: "ผ่านครบทุกรอบ",
  stopped: "ยุติโดยผู้เล่น",
};
export const RULES = "colorsync-classic-v3";
export const PREPARE_MS = 1500,
  ROUND_MS = 1500,
  INPUT_MS = 10000;
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
// ใช้ seed เดียวกัน จะได้ลำดับสีเดียวกัน เพื่อใช้ในการแข่งสองคน
// สูตร xorshift32 ต้องตรงกับสูตรในเฟิร์มแวร์ ไม่จำเป็นต้องแก้เพื่อเปลี่ยนความเร็ว
export function makeSequence(seed, length = 15) {
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
export function initialState() {
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
export function validateStatus(status) {
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
