import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

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
  /trial:\s*"https:\/\/manliaoxiaoji\.com"/.test(apiConfig) &&
    /prod:\s*"https:\/\/manliaoxiaoji\.com"/.test(apiConfig),
  "miniprogram trial/prod API URLs must point to https://manliaoxiaoji.com"
);

const loadApiConfig = ({
  envVersion,
  storage = {},
  accountInfoThrows = false,
  storageThrows = false,
}) => {
  const sandbox = {
    module: { exports: {} },
    wx: {
      getAccountInfoSync: () => {
        if (accountInfoThrows) throw new Error("account info unavailable");
        return { miniProgram: { envVersion } };
      },
      getStorageSync: (key) => {
        if (storageThrows) throw new Error("storage unavailable");
        return storage[key] || "";
      },
    },
  };
  runInNewContext(apiConfig, sandbox, { filename: "miniprogram-project/config/api.js" });
  return sandbox.module.exports;
};

const productionUrl = "https://manliaoxiaoji.com";
const developApi = loadApiConfig({ envVersion: "develop" });
assert(developApi.getApiEnv() === "lan", "develop miniapp must default to lan API");
const developWithoutStorage = loadApiConfig({ envVersion: "develop", storageThrows: true });
assert(
  developWithoutStorage.getApiEnv() === "lan" &&
    developWithoutStorage.getApiBaseUrl() === developWithoutStorage.API_BASE_URLS.lan,
  "develop miniapp must fall back to lan when storage is unavailable"
);
const overriddenDevelopApi = loadApiConfig({
  envVersion: "develop",
  storage: {
    xinqing_api_env: "local",
    xinqing_api_base_url: "http://127.0.0.1:3999",
  },
});
assert(
  overriddenDevelopApi.getApiEnv() === "local" &&
    overriddenDevelopApi.getApiBaseUrl() === "http://127.0.0.1:3999",
  "develop miniapp must allow stored API overrides"
);
for (const envVersion of ["trial", "release"]) {
  const api = loadApiConfig({
    envVersion,
    storage: {
      xinqing_api_env: "local",
      xinqing_api_base_url: "http://127.0.0.1:3999",
    },
  });
  assert(
    api.getApiEnv() === "prod" && api.getApiBaseUrl() === productionUrl,
    `${envVersion} miniapp must ignore stored API overrides and use production`
  );
}
const failClosedApi = loadApiConfig({
  envVersion: "develop",
  storage: { xinqing_api_base_url: "http://127.0.0.1:3999" },
  accountInfoThrows: true,
});
assert(
  failClosedApi.getApiEnv() === "prod" && failClosedApi.getApiBaseUrl() === productionUrl,
  "miniapp must fail closed to production when runtime version is unavailable"
);
const unknownRuntimeApi = loadApiConfig({
  envVersion: "unknown",
  storage: { xinqing_api_base_url: "http://127.0.0.1:3999" },
});
assert(
  unknownRuntimeApi.getApiEnv() === "prod" && unknownRuntimeApi.getApiBaseUrl() === productionUrl,
  "unknown miniapp runtime must ignore stored API overrides and use production"
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

const homePage = await readText("app/page.tsx");
const notePage = await readText("app/note/page.tsx");
const chatCalendarPage = await readText("app/chat/calendar/page.tsx");
assert(
  !homePage.includes("useState(formatLocalDate(new Date()))") &&
    !notePage.includes("useState(formatLocalDate(new Date()))"),
  "static web pages must not render a runtime date during their first hydration pass"
);
assert(
  chatCalendarPage.includes('const [month, setMonth] = useState("")') &&
    chatCalendarPage.includes("setMonth(getCurrentMonth())"),
  "chat calendar month must be resolved after hydration"
);
assert(
  chatCalendarPage.includes("gap-y-[10px]") &&
    chatCalendarPage.includes("top-[386px]"),
  "chat calendar must reserve a separate status row below all six date rows"
);

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
