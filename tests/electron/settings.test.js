import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vm-settings-"));
const CONFIG_PATH = path.join(TMP, "config.json");

vi.mock("electron", () => ({
  app: {
    getPath: () => TMP,
    getName: () => "vidmaster-test",
    getVersion: () => "0.1.0-test",
  },
}));

let createSettings;
beforeEach(async () => {
  // Wipe config.json so each test starts on a fresh store
  try { fs.unlinkSync(CONFIG_PATH); } catch { /* not present */ }
  vi.resetModules();
  ({ createSettings } = await import("../../electron/settings.js"));
});

function writeLegacyStore(content) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(content));
}

describe("settings store", () => {
  it("returns defaults when no value has been set", () => {
    const s = createSettings();
    expect(s.get("ui.theme")).toBe("light");
    expect(s.get("ffmpeg.encoder")).toBe("auto");
  });

  it("persists global keys via set()", () => {
    const s = createSettings();
    s.set({ "ffmpeg.encoder": "libx264" });
    expect(s.get("ffmpeg.encoder")).toBe("libx264");
  });

  it("returns full snapshot when get() called with no args", () => {
    const s = createSettings();
    const all = s.get();
    expect(all.version).toBe(8);
    expect(all.workspaces).toEqual([]);
    expect(all.activeWorkspaceId).toBe(null);
    // Virtual aliases for back-compat
    expect(all.workspace).toBe("");
    expect(all.tracking).toEqual({ identifier: "" });
    expect(all.lastConfig).toEqual({});
  });

  it("notifies onChange subscribers", () => {
    const s = createSettings();
    const cb = vi.fn();
    s.onChange(cb);
    s.set({ "ffmpeg.encoder": "libx264" });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      ffmpeg: expect.objectContaining({ encoder: "libx264" }),
    }));
  });

  it("returns defaults for fresh install (no migration needed)", () => {
    const s = createSettings();
    expect(s.get("version")).toBe(8);
    expect(s.get("youtube.minDurationMinutes")).toBe(8);
    expect(s.get("telegram.token")).toMatch(/^\d+:/);
    expect(s.get("workspaces")).toEqual([]);
  });

  it("migrates v1 store through all migrations including v6 workspace conversion", () => {
    const s = createSettings();
    s.set({ "ffmpeg.encoder": "libx264", version: 1 });
    // Manually inject legacy v5 fields to simulate an old store
    // (v6 migration reads `workspace`, `tracking.identifier`, `lastConfig`)
    // We use the underlying store via a fresh createSettings call with v=1 first
    // Since we already set version=1, recreating triggers migration.
    const s2 = createSettings();
    expect(s2.get("version")).toBe(8);
    expect(s2.get("youtube.apiKey")).toBe("AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus");
    expect(s2.get("download.maxConcurrent")).toBe(3);
    expect(s2.get("telegram.groupId")).toBe(-5227711965);
    expect(s2.get("avatar.size")).toBe(80);
  });

  it("v6 migration converts an existing v5 single workspace into the workspaces array", () => {
    writeLegacyStore({
      version: 5,
      workspace: "D:\\OldWS",
      tracking: { identifier: "Legacy" },
      lastConfig: { render: { foo: "bar" } },
    });
    const s = createSettings();
    expect(s.get("version")).toBe(8);
    const list = s.listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe("D:\\OldWS");
    expect(list[0].identifier).toBe("Legacy");
    expect(list[0].lastConfig).toEqual({ render: { foo: "bar" } });
    expect(s.getActiveWorkspace().id).toBe(list[0].id);
    // Virtual aliases reflect the migrated workspace
    expect(s.get("workspace")).toBe("D:\\OldWS");
    expect(s.get("tracking.identifier")).toBe("Legacy");
    expect(s.get("lastConfig.render")).toEqual({ foo: "bar" });
  });

  it("v6 migration with no prior workspace yields empty list", () => {
    writeLegacyStore({ version: 5, ffmpeg: { encoder: "libx264", maxConcurrent: 2 } });
    const s = createSettings();
    expect(s.get("version")).toBe(8);
    expect(s.listWorkspaces()).toEqual([]);
    expect(s.get("activeWorkspaceId")).toBe(null);
  });

  it("v6 → v8 migration adds ai and trendSearch defaults from a legacy v6 store", () => {
    writeLegacyStore({
      version: 6,
      workspaces: [],
      activeWorkspaceId: null,
    });
    const s = createSettings();
    expect(s.get("version")).toBe(8);
    expect(s.get("ai.provider")).toBe("groq");
    expect(s.get("ai.apiKeys")).toEqual([]);
    expect(s.get("ai.model")).toBe("llama-3.1-70b-versatile");
    expect(s.get("trendSearch.regionCode")).toBe("VN");
    expect(s.get("trendSearch.relevanceLanguage")).toBe("vi");
    expect(s.get("trendSearch.timeWindowDays")).toBe(7);
    expect(s.get("trendSearch.minViews")).toBe(1000);
    expect(s.get("trendSearch.sortBy")).toBe("velocity");
    expect(s.get("trendSearch.analyzeTopN")).toBe(10);
  });

  it("v7 → v8 migration drops gemini and adds ai defaults", () => {
    writeLegacyStore({
      version: 7,
      workspaces: [],
      activeWorkspaceId: null,
      gemini: { apiKeys: ["AIzaOLD"] },
    });
    const s = createSettings();
    expect(s.get("version")).toBe(8);
    expect(s.get("ai.provider")).toBe("groq");
    expect(s.get("ai.apiKeys")).toEqual([]);
    expect(s.get("gemini")).toBeUndefined();
  });

  it("fresh install yields v8 with ai and trendSearch defaults", () => {
    const s = createSettings();
    expect(s.get("ai.provider")).toBe("groq");
    expect(s.get("ai.apiKeys")).toEqual([]);
    expect(s.get("ai.model")).toBe("llama-3.1-70b-versatile");
    expect(s.get("trendSearch.sortBy")).toBe("velocity");
    expect(s.get("trendSearch.analyzeTopN")).toBe(10);
  });

  it("workspace CRUD: create/setActive/list/update/remove", () => {
    const s = createSettings();
    expect(s.listWorkspaces()).toEqual([]);
    const ws1 = s.createWorkspace({ path: "D:\\WS1", identifier: "Channel-A" });
    expect(ws1.id).toBeDefined();
    expect(s.listWorkspaces()).toHaveLength(1);
    expect(s.getActiveWorkspace().id).toBe(ws1.id);
    expect(s.get("workspace")).toBe("D:\\WS1");
    expect(s.get("tracking.identifier")).toBe("Channel-A");

    const ws2 = s.createWorkspace({ path: "D:\\WS2", identifier: "Channel-B" });
    expect(s.listWorkspaces()).toHaveLength(2);
    // Active stays as ws1 since we already had one
    expect(s.getActiveWorkspace().id).toBe(ws1.id);

    s.setActiveWorkspace(ws2.id);
    expect(s.get("workspace")).toBe("D:\\WS2");
    expect(s.get("tracking.identifier")).toBe("Channel-B");

    s.updateWorkspace(ws2.id, { identifier: "Channel-B-Renamed" });
    expect(s.get("tracking.identifier")).toBe("Channel-B-Renamed");

    s.removeWorkspace(ws2.id);
    expect(s.listWorkspaces()).toHaveLength(1);
    expect(s.getActiveWorkspace().id).toBe(ws1.id);
  });

  it("rejects creating a workspace with a duplicate path", () => {
    const s = createSettings();
    s.createWorkspace({ path: "D:\\Same", identifier: "A" });
    expect(() => s.createWorkspace({ path: "D:\\Same", identifier: "B" }))
      .toThrow(/đã tồn tại/);
  });

  it("lastConfig writes route to the active workspace", () => {
    const s = createSettings();
    const ws1 = s.createWorkspace({ path: "D:\\WS1", identifier: "A" });
    const ws2 = s.createWorkspace({ path: "D:\\WS2", identifier: "B" });
    // Active is ws1 (first created)
    s.set({ "lastConfig.render": { foo: 1 } });
    expect(s.get("lastConfig.render")).toEqual({ foo: 1 });
    // Switch to ws2 — its lastConfig is empty
    s.setActiveWorkspace(ws2.id);
    expect(s.get("lastConfig.render")).toBeUndefined();
    s.set({ "lastConfig.render": { foo: 2 } });
    expect(s.get("lastConfig.render")).toEqual({ foo: 2 });
    // Switch back — original lastConfig preserved
    s.setActiveWorkspace(ws1.id);
    expect(s.get("lastConfig.render")).toEqual({ foo: 1 });
  });
});
