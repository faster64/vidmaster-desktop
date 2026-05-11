import { describe, it, expect, vi } from "vitest";
import { QueueManager } from "../../electron/queue.js";

describe("QueueManager", () => {
  function fakeRunners({ delay = 50, fail = false } = {}) {
    return {
      noop: async ({ signal, onProgress }) => {
        for (let i = 0; i < 3; i++) {
          if (signal?.aborted) throw new Error("Aborted");
          await new Promise((r) => setTimeout(r, delay));
          onProgress?.((i + 1) * 33, `tick ${i}`);
        }
        if (fail) throw new Error("oops");
        return { ok: true, outputs: ["x"], errors: [] };
      },
    };
  }

  it("runs a single job and emits progress + final state", async () => {
    const updates = [];
    const q = new QueueManager({
      runners: fakeRunners(),
      onUpdate: (s) => updates.push(JSON.parse(JSON.stringify(s))),
    });
    const { jobId } = q.add({ type: "noop", config: {} });
    await q.waitIdle();

    const final = updates.at(-1);
    expect(final.completed.find((j) => j.id === jobId).status).toBe("done");
  });

  it("runs jobs serially: second only starts after first finishes", async () => {
    const order = [];
    const runners = {
      noop: async () => {
        order.push("start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("end");
        return { ok: true, outputs: [], errors: [] };
      },
    };
    const q = new QueueManager({ runners, onUpdate: () => {} });
    q.add({ type: "noop", config: {} });
    q.add({ type: "noop", config: {} });
    await q.waitIdle();
    expect(order).toEqual(["start", "end", "start", "end"]);
  });

  it("cancel sets status to 'cancelled' and starts the next job", async () => {
    const runners = fakeRunners({ delay: 200 });
    const q = new QueueManager({ runners, onUpdate: () => {} });
    const { jobId } = q.add({ type: "noop", config: {} });
    q.add({ type: "noop", config: {} });
    setTimeout(() => q.cancel(jobId), 50);
    await q.waitIdle();
    const completed = q.getState().completed;
    expect(completed.find((j) => j.id === jobId).status).toBe("cancelled");
    expect(completed.length).toBe(2);
  });

  it("captures errors and continues to next job", async () => {
    const q = new QueueManager({
      runners: fakeRunners({ fail: true, delay: 5 }),
      onUpdate: () => {},
    });
    const { jobId } = q.add({ type: "noop", config: {} });
    q.add({ type: "noop", config: {} });
    await q.waitIdle();
    const failed = q.getState().completed.find((j) => j.id === jobId);
    expect(failed.status).toBe("error");
    expect(failed.error.message).toBe("oops");
  });

  it("caps completed history at 50 entries", async () => {
    const runners = {
      noop: async () => ({ ok: true, outputs: [], errors: [] }),
    };
    const q = new QueueManager({ runners, onUpdate: () => {}, historySize: 50 });
    for (let i = 0; i < 60; i++) q.add({ type: "noop", config: {} });
    await q.waitIdle();
    expect(q.getState().completed.length).toBe(50);
  });
});
