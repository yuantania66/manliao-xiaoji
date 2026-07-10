const DEFAULT_BASE_URL = "https://manliaoxiaoji.com";
const baseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

const request = async (path, init = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { response, text, data };
  } finally {
    clearTimeout(timer);
  }
};

const checks = [];
const addCheck = (name, fn) => checks.push({ name, fn });

const describeError = (error) => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause && typeof cause === "object") {
    const details = [];
    if ("code" in cause) details.push(`code=${cause.code}`);
    if ("hostname" in cause) details.push(`hostname=${cause.hostname}`);
    if ("address" in cause) details.push(`address=${cause.address}`);
    if ("port" in cause) details.push(`port=${cause.port}`);
    if ("message" in cause) details.push(`cause=${cause.message}`);
    if (details.length > 0) return `${error.message} (${details.join(", ")})`;
  }
  return error.message;
};

addCheck("health returns ok", async () => {
  const { response, data, text } = await request("/api/health");
  if (!response.ok) throw new Error(`expected 2xx, got ${response.status}: ${text.slice(0, 160)}`);
  if (!data?.ok) throw new Error(`expected ok=true, got ${text.slice(0, 160)}`);
});

addCheck("protected notes reject anonymous", async () => {
  const { response, text } = await request("/api/notes");
  if (response.status !== 401) throw new Error(`expected 401, got ${response.status}: ${text.slice(0, 160)}`);
});

addCheck("wechat login validates empty body", async () => {
  const { response, text } = await request("/api/auth/wechat", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (response.status !== 400) throw new Error(`expected 400, got ${response.status}: ${text.slice(0, 160)}`);
});

const failures = [];

console.log(`Running production smoke checks against ${baseUrl}`);

for (const check of checks) {
  try {
    await check.fn();
    console.log(`PASS ${check.name}`);
  } catch (error) {
    const message = describeError(error);
    failures.push(`${check.name}: ${message}`);
    console.error(`FAIL ${check.name}: ${message}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length}/${checks.length} production smoke checks failed.`);
  process.exit(1);
}

console.log(`All ${checks.length} production smoke checks passed.`);
