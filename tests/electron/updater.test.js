import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll mock electron-updater. The wrapper imports autoUpdater from it.
const autoUpdaterMock = {
  on: vi.fn(),
  removeAllListeners: vi.fn(),
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  autoDownload: true,
  autoInstallOnAppQuit: true,
};

vi.mock("electron-updater", () => ({ autoUpdater: autoUpdaterMock }));
vi.mock("electron", () => ({ app: { getVersion: () => "0.1.0" } }));

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

async function loadFresh() {
  vi.resetModules();
  return (await import("../../electron/updater.js")).createUpdater;
}

beforeEach(() => {
  Object.values(autoUpdaterMock).forEach((v) => typeof v === "function" && v.mockReset?.());
  autoUpdaterMock.on.mockImplementation(() => {});
});

describe("createUpdater", () => {
  it("short-circuits in dev mode (isPackaged=false)", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const updater = create({ send, log: silentLog, isPackaged: false });
    await updater.check();
    expect(send).toHaveBeenCalledWith({ type: "not-available", currentVersion: expect.any(String) });
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
  });

  it("emits checking then forwards update-not-available", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const handlers = {};
    autoUpdaterMock.on.mockImplementation((event, cb) => { handlers[event] = cb; });
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    expect(send).toHaveBeenCalledWith({ type: "checking" });
    handlers["update-not-available"]({ version: "0.1.0" });
    expect(send).toHaveBeenCalledWith({ type: "not-available", currentVersion: expect.any(String) });
  });

  it("forwards update-available, download-progress, and downloaded events", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const handlers = {};
    autoUpdaterMock.on.mockImplementation((event, cb) => { handlers[event] = cb; });
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();

    handlers["update-available"]({ version: "0.1.5" });
    expect(send).toHaveBeenCalledWith({ type: "available", currentVersion: expect.any(String), nextVersion: "0.1.5" });

    handlers["download-progress"]({ percent: 42.7, bytesPerSecond: 1500000, transferred: 500, total: 1000 });
    expect(send).toHaveBeenCalledWith({
      type: "download-progress",
      percent: 42.7,
      bytesPerSecond: 1500000,
      transferred: 500,
      total: 1000,
    });

    handlers["update-downloaded"]({ version: "0.1.5" });
    expect(send).toHaveBeenCalledWith({ type: "downloaded", nextVersion: "0.1.5" });
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalled();
  });

  it("emits timeout error when no event arrives within 10s", async () => {
    vi.useFakeTimers();
    const create = await loadFresh();
    const send = vi.fn();
    autoUpdaterMock.on.mockImplementation(() => {});
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    vi.advanceTimersByTime(10_000);
    expect(send).toHaveBeenCalledWith({ type: "error", code: "timeout", message: expect.any(String) });
    vi.useRealTimers();
  });

  it("forwards autoUpdater error event with code: unknown by default", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const handlers = {};
    autoUpdaterMock.on.mockImplementation((event, cb) => { handlers[event] = cb; });
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    handlers["error"](new Error("boom"));
    expect(send).toHaveBeenCalledWith({ type: "error", code: "unknown", message: "boom" });
  });

  it("classifies network errors", async () => {
    const create = await loadFresh();
    const send = vi.fn();
    const handlers = {};
    autoUpdaterMock.on.mockImplementation((event, cb) => { handlers[event] = cb; });
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    const err = new Error("getaddrinfo ENOTFOUND github.com");
    err.code = "ENOTFOUND";
    handlers["error"](err);
    expect(send).toHaveBeenCalledWith({ type: "error", code: "network", message: expect.stringContaining("ENOTFOUND") });
  });

  it("dispose() cancels the pending timeout", async () => {
    vi.useFakeTimers();
    const create = await loadFresh();
    const send = vi.fn();
    autoUpdaterMock.on.mockImplementation(() => {});
    autoUpdaterMock.checkForUpdates.mockResolvedValue({});
    const updater = create({ send, log: silentLog, isPackaged: true });
    await updater.check();
    updater.dispose();
    vi.advanceTimersByTime(15_000);
    const errorCalls = send.mock.calls.filter(([e]) => e.type === "error");
    expect(errorCalls).toHaveLength(0);
    vi.useRealTimers();
  });
});
