import { describe, it, expect } from "vitest";
import { validateConfig } from "../../electron/renderer/components/validation.js";

const ok = { exists: true, isFolder: true, isFile: false };
const okFile = { exists: true, isFolder: false, isFile: true };
const missing = { exists: false };

describe("validateConfig", () => {
  it("returns no errors when all required fields present and paths exist", async () => {
    const fields = [
      { path: "input",  label: "Folder input",  required: true, mustExist: "folder" },
      { path: "output", label: "Folder output", required: true },
    ];
    const config = { input: "C:/in", output: "C:/out" };
    const fsExists = async () => ok;
    expect(await validateConfig({ fields, config, fsExists })).toEqual([]);
  });

  it("flags empty required field with reason 'trống'", async () => {
    const fields = [{ path: "input", label: "Folder input", required: true, mustExist: "folder" }];
    const config = { input: "" };
    const fsExists = async () => ok;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Folder input", reason: "trống" }]);
  });

  it("flags missing path with reason 'không tồn tại'", async () => {
    const fields = [{ path: "input", label: "Folder input", required: true, mustExist: "folder" }];
    const config = { input: "C:/nope" };
    const fsExists = async () => missing;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Folder input", reason: "không tồn tại" }]);
  });

  it("flags wrong kind (file when folder expected) with reason 'sai loại'", async () => {
    const fields = [{ path: "input", label: "Folder input", mustExist: "folder" }];
    const config = { input: "C:/some.txt" };
    const fsExists = async () => okFile;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Folder input", reason: "sai loại" }]);
  });

  it("flags wrong kind (folder when file expected) with reason 'sai loại'", async () => {
    const fields = [{ path: "snowAsset", label: "Snow", mustExist: "file" }];
    const config = { snowAsset: "C:/folder" };
    const fsExists = async () => ok;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Snow", reason: "sai loại" }]);
  });

  it("skips mustExist check when value is empty (required handles that)", async () => {
    const fields = [{ path: "snowAsset", label: "Snow", mustExist: "file" }];
    const config = { snowAsset: "" };
    let called = false;
    const fsExists = async () => { called = true; return missing; };
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([]);
    expect(called).toBe(false);
  });

  it("supports nested paths (e.g. inputs.overlays)", async () => {
    const fields = [{ path: "inputs.overlays", label: "Overlays", required: true, mustExist: "folder" }];
    const config = { inputs: { overlays: "" } };
    const fsExists = async () => ok;
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs).toEqual([{ label: "Overlays", reason: "trống" }]);
  });

  it("ignores fields without required/mustExist markers", async () => {
    const fields = [{ path: "duration", label: "Duration", type: "number" }];
    const config = { duration: 5 };
    const fsExists = async () => missing;
    expect(await validateConfig({ fields, config, fsExists: async () => missing })).toEqual([]);
  });

  it("trims whitespace before treating value as empty", async () => {
    const fields = [{ path: "input", label: "Folder input", required: true }];
    const config = { input: "   " };
    const errs = await validateConfig({ fields, config, fsExists: async () => ok });
    expect(errs).toEqual([{ label: "Folder input", reason: "trống" }]);
  });

  it("returns [] for empty fields array", async () => {
    expect(await validateConfig({ fields: [], config: {}, fsExists: async () => ok })).toEqual([]);
  });

  it("preserves field-declaration order even when fsExists resolves out of order", async () => {
    const fields = [
      { path: "a", label: "A", mustExist: "folder" },
      { path: "b", label: "B", mustExist: "folder" },
    ];
    const config = { a: "/a", b: "/b" };
    const fsExists = async (p) => {
      if (p === "/a") {
        await new Promise((r) => setTimeout(r, 20));
        return missing;
      }
      return missing;
    };
    const errs = await validateConfig({ fields, config, fsExists });
    expect(errs.map((e) => e.label)).toEqual(["A", "B"]);
  });
});
