import { randomUUID } from "crypto";

export class QueueManager {
  constructor({ runners, onUpdate, historySize = 50 }) {
    this.runners = runners;
    this.onUpdate = onUpdate;
    this.historySize = historySize;
    this.pending = [];
    this.running = null;
    this.completed = [];
    this._idleResolvers = [];
  }

  add({ type, config }) {
    const job = {
      id: randomUUID(),
      type,
      config,
      status: "pending",
      progress: 0,
      message: "",
      createdAt: Date.now(),
    };
    this.pending.push(job);
    this._emit();
    this._maybeStart();
    return { jobId: job.id };
  }

  cancel(jobId) {
    if (this.running?.id === jobId) {
      this.running.controller?.abort();
    } else {
      const idx = this.pending.findIndex((j) => j.id === jobId);
      if (idx >= 0) {
        const [job] = this.pending.splice(idx, 1);
        job.status = "cancelled";
        this._pushCompleted(job);
        this._emit();
      }
    }
  }

  clear() {
    this.completed = [];
    this._emit();
  }

  getState() {
    return {
      running: this.running ? this._public(this.running) : null,
      pending: this.pending.map((j) => this._public(j)),
      completed: this.completed.map((j) => this._public(j)),
    };
  }

  waitIdle() {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise((r) => this._idleResolvers.push(r));
  }

  _public(j) {
    const { controller, ...rest } = j;
    return rest;
  }

  _emit() {
    this.onUpdate?.(this.getState());
  }

  _pushCompleted(job) {
    this.completed.unshift(job);
    if (this.completed.length > this.historySize) {
      this.completed.length = this.historySize;
    }
  }

  _maybeStart() {
    if (this.running || this.pending.length === 0) return;
    const job = this.pending.shift();
    job.status = "running";
    job.startedAt = Date.now();
    job.controller = new AbortController();
    this.running = job;
    this._emit();

    const runner = this.runners[job.type];
    if (!runner) {
      this._fail(job, new Error(`No runner for type: ${job.type}`));
      return;
    }

    runner({
      ...job.config,
      signal: job.controller.signal,
      onProgress: (pct, msg) => {
        job.progress = pct;
        job.message = msg ?? "";
        this._emit();
      },
      onLog: (level, line) => {
        job.logs = job.logs || [];
        job.logs.push({ level, line, ts: Date.now() });
        if (job.logs.length > 200) job.logs.shift();
      },
    }).then(
      (result) => {
        job.result = result;
        job.status = result.ok ? "done" : "error";
        if (!result.ok) job.error = { message: "Task reported errors", details: result.errors };
        this._finish(job);
      },
      (err) => {
        if (err.name === "AbortError" || err.message === "Aborted") {
          job.status = "cancelled";
          this._finish(job);
        } else {
          this._fail(job, err);
        }
      },
    );
  }

  _fail(job, err) {
    job.status = "error";
    job.error = { message: err.message, stack: err.stack };
    this._finish(job);
  }

  _finish(job) {
    job.finishedAt = Date.now();
    this.running = null;
    this._pushCompleted(job);
    this._emit();
    this._maybeStart();
    if (!this.running && this.pending.length === 0) {
      this._idleResolvers.forEach((r) => r());
      this._idleResolvers = [];
    }
  }
}
