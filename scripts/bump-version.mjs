import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

export function bumpPatch(version) {
  const parts = version.split(".");
  if (parts.length !== 3) throw new Error(`Cannot parse version: ${version}`);
  const [maj, min, pat] = parts.map(Number);
  if ([maj, min, pat].some(Number.isNaN)) {
    throw new Error(`Cannot parse version: ${version}`);
  }
  return `${maj}.${min}.${pat + 1}`;
}

// CLI entry — only runs when invoked directly, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = "package.json";
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = bumpPatch(pkg.version);
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`Version bumped → ${pkg.version}`);
}
