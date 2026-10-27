// เก็บประวัติในเบราว์เซอร์ ไม่ใช้ฐานข้อมูลหรือบัญชีผู้ใช้
// แยกคะแนน demo กับ hardware และแยกตามระดับความเร็ว
import { RULES, TERMINAL } from "./settings.js";
export const resultKey = (status) =>
  [status.deviceId, status.bootId, status.sessionId].join(":");
export const eligible = (record) =>
  ["wrong", "timeout", "completed"].includes(record.endReason);
export class HistoryStore {
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
export function matchWinner(players) {
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
