import fs from "fs";
import path from "path";
import { TaskRunner } from "./_lib/runner.js";

/**
 * Recursively rename files in `folder` to NFC unicode form.
 */
export async function runRename(config) {
  const runner = new TaskRunner(config);
  const { folder } = config;
  runner.checkAborted();

  const renamed = [];
  walk(folder, runner, renamed);
  return { ok: true, outputs: renamed, errors: [] };
}

function walk(folderPath, runner, renamed) {
  runner.checkAborted();
  const items = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const item of items) {
    runner.checkAborted();
    const oldPath = path.join(folderPath, item.name);
    const normalized = item.name.normalize("NFC");
    const newPath = path.join(folderPath, normalized);
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
      renamed.push(newPath);
      runner.log("info", `Đã đổi tên: ${item.name} → ${normalized}`);
    }
    if (item.isDirectory()) {
      walk(newPath, runner, renamed);
    }
  }
}
