import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let getStatus, ensureBinary, updateBinary;
let tmpDir;
let savedFetch;

beforeEach(async () => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-ytdlp-"));
  savedFetch = global.fetch;
  ({ getStatus, ensureBinary, updateBinary } = await import("../../src/_lib/ytdlp.js"));
});

afterEach(() => {
  global.fetch = savedFetch;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fakeBinaryStream(bytes) {
  return {
    ok: true,
    headers: new Map([["content-length", String(bytes.length)]]),
    body: ReadableStream.from([bytes]),
  };
}

describe("getStatus", () => {
  it("returns exists=false when file missing", async () => {
    const res = await getStatus(path.join(tmpDir, "yt-dlp.exe"));
    expect(res.exists).toBe(false);
    expect(res.version).toBeNull();
  });

  it("returns exists=true and lastModified when file present", async () => {
    const p = path.join(tmpDir, "yt-dlp.exe");
    fs.writeFileSync(p, "stub");
    const res = await getStatus(p);
    expect(res.exists).toBe(true);
    expect(res.lastModified).toBeInstanceOf(Date);
    expect(res.path).toBe(p);
  });
});

describe("ensureBinary", () => {
  it("downloads when binary is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeBinaryStream(Buffer.from("FAKE_BINARY_DATA")));
    const target = path.join(tmpDir, "yt-dlp.exe");
    const ticks = [];
    const out = await ensureBinary({ targetPath: target, onProgress: (p) => ticks.push(p) });
    expect(out).toBe(target);
    expect(fs.readFileSync(target, "utf8")).toBe("FAKE_BINARY_DATA");
    expect(ticks.at(-1)).toBe(100);
  });

  it("does nothing when binary already exists", async () => {
    const target = path.join(tmpDir, "yt-dlp.exe");
    fs.writeFileSync(target, "ALREADY_THERE");
    global.fetch = vi.fn();
    const out = await ensureBinary({ targetPath: target });
    expect(out).toBe(target);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(fs.readFileSync(target, "utf8")).toBe("ALREADY_THERE");
  });

  it("writes to .tmp and renames atomically", async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeBinaryStream(Buffer.from("ABC")));
    const target = path.join(tmpDir, "yt-dlp.exe");
    await ensureBinary({ targetPath: target });
    expect(fs.existsSync(target + ".tmp")).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("ABC");
  });

  it("aborts and cleans up .tmp when signal fires", async () => {
    const ctrl = new AbortController();
    let pulled = false;
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      headers: new Map([["content-length", "1000"]]),
      body: new ReadableStream({
        async pull(controller) {
          if (!pulled) {
            controller.enqueue(Buffer.from("first"));
            pulled = true;
            ctrl.abort();
            await new Promise((r) => setTimeout(r, 30));
          }
          controller.close();
        },
      }),
    }));
    const target = path.join(tmpDir, "yt-dlp.exe");
    await expect(ensureBinary({ targetPath: target, signal: ctrl.signal }))
      .rejects.toThrow(/Aborted/);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(target + ".tmp")).toBe(false);
  });
});

describe("updateBinary", () => {
  it("forces redownload even if file exists", async () => {
    const target = path.join(tmpDir, "yt-dlp.exe");
    fs.writeFileSync(target, "OLD");
    global.fetch = vi.fn().mockResolvedValue(fakeBinaryStream(Buffer.from("NEW")));
    await updateBinary({ targetPath: target });
    expect(fs.readFileSync(target, "utf8")).toBe("NEW");
  });
});
