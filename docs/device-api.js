import { visualState } from "./timeline.js";
import { validateStatus, uid } from "./settings.js";

// ติดต่อบอร์ดจริงเท่านั้น ส่วนเกมทดลองอยู่ใน mock-device.js
export class DeviceAPI {
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
