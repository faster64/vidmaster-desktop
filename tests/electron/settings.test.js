import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("electron", async () => {
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-settings-"));
  return {
    app: {
      getPath: (name) => name === "userData" ? tmp : tmp,
      getName: () => "vidmaster-test",
      getVersion: () => "0.1.0-test",
    },
  };
});

let createSettings;
beforeEach(async () => {
  vi.resetModules();
  ({ createSettings } = await import("../../electron/settings.js"));
});

describe("settings store", () => {
  it("returns defaults when no value has been set", () => {
    const s = createSettings();
    expect(s.get("ui.theme")).toBe("light");
    expect(s.get("ffmpeg.encoder")).toBe("auto");
  });

  it("persists patches via set()", () => {
    const s = createSettings();
    s.set({ workspace: "D:\\Test" });
    expect(s.get("workspace")).toBe("D:\\Test");
  });

  it("returns full snapshot when get() called with no args", () => {
    const s = createSettings();
    s.set({ workspace: "D:\\Test" });
    const all = s.get();
    expect(all.workspace).toBe("D:\\Test");
    expect(all.version).toBe(1);
  });

  it("notifies onChange subscribers", () => {
    const s = createSettings();
    const cb = vi.fn();
    s.onChange(cb);
    s.set({ workspace: "D:\\Other" });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ workspace: "D:\\Other" }));
  });
});
