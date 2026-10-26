// เกมทดลองทำงานในเบราว์เซอร์ ไม่ส่งคำตอบไปบอร์ด
// ใช้ setTimeout เพื่อให้ไฟแสดงตามเวลาโดยหน้าเว็บยังตอบสนองได้
import {
  LEVELS,
  ACTIVE,
  initialState,
  makeSequence,
  uid,
  PREPARE_MS,
  ROUND_MS,
  INPUT_MS,
} from "./settings.js";
export class MockDevice {
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
