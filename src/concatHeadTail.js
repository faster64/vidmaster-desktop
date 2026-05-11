import fs from "fs";
import path from "path";
import { TaskRunner } from "./_lib/runner.js";
import { concatVideos } from "./_lib/concatVideos.js";

export async function runConcatHeadTail(config) {
  const runner = new TaskRunner(config);
  const { folderA, folderB = "", folderC = "", output, signal } = config;
  runner.checkAborted();

  if (!folderA) throw new Error("Cần chọn folder A (video gốc)");
  if (!fs.existsSync(folderA)) throw new Error(`Folder A không tồn tại: ${folderA}`);
  if (!folderB && !folderC) throw new Error("Cần chọn ít nhất 1 trong 2 folder: nối đầu (B) hoặc nối cuối (C)");
  if (folderB && !fs.existsSync(folderB)) throw new Error(`Folder B không tồn tại: ${folderB}`);
  if (folderC && !fs.existsSync(folderC)) throw new Error(`Folder C không tồn tại: ${folderC}`);
  if (!output) throw new Error("Cần chọn folder output");

  const filesA = listMp4(folderA);
  if (filesA.length === 0) throw new Error(`Folder A trống: ${folderA}`);
  const filesB = folderB ? listMp4(folderB) : [];
  const filesC = folderC ? listMp4(folderC) : [];
  if (folderB && filesB.length === 0) throw new Error(`Folder B trống: ${folderB}`);
  if (folderC && filesC.length === 0) throw new Error(`Folder C trống: ${folderC}`);

  fs.mkdirSync(output, { recursive: true });

  const total = filesA.length;
  const outputs = [];
  const errors = [];

  for (let i = 0; i < total; i++) {
    runner.checkAborted();
    const a = filesA[i];
    const b = filesB.length ? filesB[i % filesB.length] : null;
    const c = filesC.length ? filesC[i % filesC.length] : null;
    const stageOffset = (i / total) * 100;
    const stageWeight = 1 / total;
    const aName = path.basename(a);
    const message = `${i + 1}/${total} ${aName}`;
    runner.setProgress(stageOffset, message);

    try {
      const inputs = [b, a, c].filter(Boolean);
      const outPath = path.join(output, aName);
      runner.log("info", `${message} ← ${inputs.map((p) => path.basename(p)).join(" + ")}`);
      await concatVideos({ inputs, output: outPath, signal, runner, stageOffset, stageWeight, message });
      outputs.push(outPath);
      runner.log("info", `Saved: ${aName}`);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      errors.push({ file: aName, message: err.message, stack: err.stack });
      runner.log("error", `${aName} failed: ${err.message}`);
    }
    runner.setProgress(((i + 1) / total) * 100, message);
  }

  runner.setProgress(100, "Done");
  return { ok: errors.length === 0, outputs, errors };
}

function listMp4(folder) {
  return fs.readdirSync(folder)
    .filter((f) => /\.mp4$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((f) => path.join(folder, f));
}
