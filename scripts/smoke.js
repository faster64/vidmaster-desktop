// One-shot manual smoke: invokes runRename on a tmp dir to confirm modules load from CLI Node.
import { runRename } from "../src/rename.js";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-smoke-"));
fs.writeFileSync(path.join(tmp, "Việt".normalize("NFD") + ".txt"), "x");
const r = await runRename({ folder: tmp, onLog: (l, m) => console.log(`[${l}] ${m}`) });
console.log("Result:", r);
fs.rmSync(tmp, { recursive: true, force: true });
