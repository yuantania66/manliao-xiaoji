import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT_DIR = "miniprogram-project";
const SKIPPED_DIRS = new Set(["miniprogram_npm", "node_modules"]);

const collectJsFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      files.push(...(await collectJsFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
  }

  return files;
};

const checkFile = (filePath) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${filePath}\n${stderr.trim()}`));
    });
  });

const files = await collectJsFiles(ROOT_DIR);
const failures = [];

for (const file of files) {
  try {
    await checkFile(file);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

if (failures.length > 0) {
  console.error(`Miniapp JS syntax check failed for ${failures.length} file(s):`);
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(`Miniapp JS syntax check passed for ${files.length} file(s).`);
