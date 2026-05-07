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
    expect(all.version).toBe(5);
  });

  it("notifies onChange subscribers", () => {
    const s = createSettings();
    const cb = vi.fn();
    s.onChange(cb);
    s.set({ workspace: "D:\\Other" });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ workspace: "D:\\Other" }));
  });

  it("migrates v1 store to current version with default youtube/download/telegram/tracking keys", () => {
    const s = createSettings();
    s.set({ workspace: "D:\\Test", version: 1 });
    // Re-create to trigger migration
    const s2 = createSettings();
    expect(s2.get("version")).toBe(5);
    expect(s2.get("youtube.apiKey")).toBe("AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus");
    expect(s2.get("youtube.minDurationMinutes")).toBe(8);
    expect(s2.get("youtube.sortOrder")).toBe("VIEW");
    expect(s2.get("download.autoUpdateYtDlp")).toBe(false);
    expect(s2.get("download.maxConcurrent")).toBe(3);
    expect(s2.get("download.ytdlpPath")).toMatch(/yt-dlp\.exe$/);
    expect(s2.get("telegram.token")).toMatch(/^\d+:/);
    expect(s2.get("telegram.groupId")).toBe(-5227711965);
    expect(s2.get("telegram.trackingChatId")).toBe(8335894661);
    expect(s2.get("tracking.identifier")).toBe("");
    expect(s2.get("workspace")).toBe("D:\\Test"); // preserved
  });

  it("returns defaults for new install (no migration needed)", () => {
    const s = createSettings();
    expect(s.get("version")).toBe(5);
    expect(s.get("youtube.minDurationMinutes")).toBe(8);
    expect(s.get("telegram.token")).toMatch(/^\d+:/);
    expect(s.get("tracking.identifier")).toBe("");
  });

  it("migrates v4 store to v5 with default avatar/lastSettingsTab keys", () => {
    const s = createSettings();
    s.set({ workspace: "D:\\Test", version: 4 });
    const s2 = createSettings();
    expect(s2.get("version")).toBe(5);
    expect(s2.get("avatar.size")).toBe(80);
    expect(s2.get("avatar.margin")).toBe(16);
    expect(s2.get("avatar.lastPosition")).toBe("bottom-right");
    expect(s2.get("ui.lastSettingsTab")).toBe("workspace");
    expect(s2.get("workspace")).toBe("D:\\Test");
  });

  it("returns avatar defaults on a fresh install", () => {
    const s = createSettings();
    expect(s.get("avatar.size")).toBe(80);
    expect(s.get("avatar.lastPosition")).toBe("bottom-right");
    expect(s.get("ui.lastSettingsTab")).toBe("workspace");
  });
});
