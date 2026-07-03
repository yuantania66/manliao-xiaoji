import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const failures = [];
const warnings = [];

const readText = (path) => readFile(path, "utf8");

const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const warn = (condition, message) => {
  if (!condition) warnings.push(message);
};

const walkFiles = async (dir, predicate) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath, predicate)));
      continue;
    }
    if (entry.isFile() && predicate(fullPath)) files.push(fullPath);
  }

  return files;
};

const apiConfig = await readText("miniprogram-project/config/api.js");
assert(
  /const DEFAULT_API_ENV = "prod";/.test(apiConfig),
  "miniprogram default API environment must be prod before release"
);
assert(
  /trial:\s*"https:\/\/manliaoxiaoji\.com"/.test(apiConfig) &&
    /prod:\s*"https:\/\/manliaoxiaoji\.com"/.test(apiConfig),
  "miniprogram trial/prod API URLs must point to https://manliaoxiaoji.com"
);

const envExample = await readText(".env.example");
assert(
  /ALLOW_WEB_MOCK_LOGIN="false"/.test(envExample),
  ".env.example must keep ALLOW_WEB_MOCK_LOGIN disabled by default"
);

const miniappPageFiles = await walkFiles("miniprogram-project/pages", (path) =>
  /\.(js|wxml|wxss|json)$/.test(path)
);
for (const file of miniappPageFiles) {
  const text = await readText(file);
  assert(!text.includes("local_demo_"), `miniapp page must not reference local_demo_ token: ${file}`);
}

const webAppFiles = await walkFiles("app", (path) => /\.(ts|tsx)$/.test(path));
const allowedLegacyDemoFiles = new Set(["app/chat/page.tsx", "app/chat/chat-client.tsx"]);
for (const file of webAppFiles) {
  if (allowedLegacyDemoFiles.has(file)) continue;
  const text = await readText(file);
  assert(!text.includes("local_demo_"), `web app page must not create local_demo_ token: ${file}`);
}

const notePageWxml = await readText("miniprogram-project/pages/note/note.wxml");
warn(
  notePageWxml.includes('wx:if="{{isDevRuntime}}"') &&
    notePageWxml.includes("fillMediaLimitTest"),
  "miniapp media test button guard was not recognized"
);

const noteHistoryJs = await readText("miniprogram-project/pages/note-history/note-history.js");
warn(
  noteHistoryJs.includes('envVersion !== "release"') &&
    noteHistoryJs.includes("seedMediaNotesIfNeeded"),
  "miniapp media seed guard was not recognized"
);

if (warnings.length > 0) {
  console.warn("Prelaunch audit warnings:");
  for (const item of warnings) console.warn(`WARN ${item}`);
}

if (failures.length > 0) {
  console.error("Prelaunch audit failed:");
  for (const item of failures) console.error(`FAIL ${item}`);
  process.exit(1);
}

console.log("Prelaunch audit passed.");
