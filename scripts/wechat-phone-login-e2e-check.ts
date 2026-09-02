import assert from "node:assert/strict";

const databaseUrl = process.env.WECHAT_PHONE_LOGIN_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("PREREQUISITE_FAILED: WECHAT_PHONE_LOGIN_TEST_DATABASE_URL is required");
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ""));
if (!/(?:^|[_-])(test|testing|spec|ci)(?:[_-]|$)/iu.test(databaseName)) {
  throw new Error(`PREREQUISITE_FAILED: database must be visibly test-scoped; received ${databaseName}`);
}

const main = async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ENV = "production";
  process.env.ALLOW_WEB_MOCK_LOGIN = "false";
  process.env.SESSION_SECRET = "wechat-phone-e2e-test-secret-32-characters";
  process.env.WECHAT_APP_ID = "wechat-phone-e2e-app";
  process.env.WECHAT_APP_SECRET = "wechat-phone-e2e-secret";

  const openIds = new Map([
    ["wx-new", "wx_e2e_new"],
    ["wx-phone-owner", "wx_e2e_phone_owner"],
    ["wx-openid-owner", "wx_e2e_openid_owner"],
    ["wx-same", "wx_e2e_same"],
    ["wx-conflict", "wx_e2e_conflict"],
    ["wx-other-phone", "wx_e2e_other_phone"],
    ["wx-phone-other-owner", "wx_e2e_phone_other_owner"],
    ["wx-race-a", "wx_e2e_race_a"],
    ["wx-race-b", "wx_e2e_race_b"],
    ["wx-invalid-phone", "wx_e2e_invalid_phone"],
  ]);
  const phones = new Map<string, { purePhoneNumber: string; countryCode: string }>([
    ["phone-new", { purePhoneNumber: "13800000101", countryCode: "86" }],
    ["phone-owner", { purePhoneNumber: "13800000102", countryCode: "86" }],
    ["phone-openid-owner", { purePhoneNumber: "13800000103", countryCode: "86" }],
    ["phone-same", { purePhoneNumber: "13800000104", countryCode: "86" }],
    ["phone-conflict", { purePhoneNumber: "13800000105", countryCode: "86" }],
    ["phone-other", { purePhoneNumber: "13800000106", countryCode: "86" }],
    ["phone-owned", { purePhoneNumber: "13800000107", countryCode: "86" }],
    ["phone-race-a", { purePhoneNumber: "13800000108", countryCode: "86" }],
    ["phone-race-b", { purePhoneNumber: "13800000108", countryCode: "86" }],
    ["phone-invalid", { purePhoneNumber: "2025550123", countryCode: "1" }],
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const json = (value: unknown) => new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    if (url.pathname === "/cgi-bin/token") {
      return json({ access_token: "wechat-phone-e2e-access-token", expires_in: 7200 });
    }
    if (url.pathname === "/sns/jscode2session") {
      const openid = openIds.get(url.searchParams.get("js_code") ?? "");
      return openid ? json({ openid }) : json({ errcode: 40029 });
    }
    if (url.pathname === "/wxa/business/getuserphonenumber") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { code?: string };
      const phoneInfo = phones.get(body.code ?? "");
      return phoneInfo ? json({ errcode: 0, phone_info: phoneInfo }) : json({ errcode: 40029 });
    }
    throw new Error(`unexpected WeChat endpoint: ${url.pathname}`);
  }) as typeof fetch;

  const { prisma } = await import("../lib/prisma");
  const { POST } = await import("../app/api/auth/wechat-phone/route");
  const fixturePhones = [...new Set([...phones.values()].map((value) => value.purePhoneNumber))];
  const fixtureOpenIds = [...openIds.values()];
  const invoke = async (wechatCode: unknown, phoneCode: unknown) => {
    const response = await POST(new Request("http://localhost/api/auth/wechat-phone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wechatCode, phoneCode }),
    }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const dataOf = <T>(result: { body: Record<string, unknown> }) => result.body.data as T;

  try {
    await prisma.user.deleteMany({
      where: { OR: [{ phone: { in: fixturePhones } }, { wechatOpenid: { in: fixtureOpenIds } }] },
    });

    assert.equal((await invoke("", "phone-new")).status, 400);
    assert.equal((await invoke("wx-new", "")).status, 400);
    const invalidBody = await POST(new Request("http://localhost/api/auth/wechat-phone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    }));
    assert.equal(invalidBody.status, 400);

    const created = await invoke("wx-new", "phone-new");
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(dataOf<{ user: { phone: string; wechatOpenid: string } }>(created).user.phone, "13800000101");
    assert.equal(dataOf<{ user: { wechatOpenid: string } }>(created).user.wechatOpenid, "wx_e2e_new");
    assert.equal(dataOf<{ user: { isProvisional: boolean } }>(created).user.isProvisional, false);
    assert.equal(dataOf<{ provider: string }>(created).provider, "wechat_phone");

    const phoneOwner = await prisma.user.create({ data: { phone: "13800000102" } });
    const phoneBound = await invoke("wx-phone-owner", "phone-owner");
    assert.equal(phoneBound.status, 200);
    assert.equal(dataOf<{ user: { id: string } }>(phoneBound).user.id, phoneOwner.id);
    assert.equal(dataOf<{ user: { isProvisional: boolean } }>(phoneBound).user.isProvisional, false);

    const openIdOwner = await prisma.user.create({ data: { wechatOpenid: "wx_e2e_openid_owner" } });
    const openIdBound = await invoke("wx-openid-owner", "phone-openid-owner");
    assert.equal(openIdBound.status, 200);
    assert.equal(dataOf<{ user: { id: string } }>(openIdBound).user.id, openIdOwner.id);

    const sameOwner = await prisma.user.create({
      data: { wechatOpenid: "wx_e2e_same", phone: "13800000104" },
    });
    const sameLogin = await invoke("wx-same", "phone-same");
    assert.equal(sameLogin.status, 200);
    assert.equal(dataOf<{ user: { id: string } }>(sameLogin).user.id, sameOwner.id);

    const conflictWechat = await prisma.user.create({ data: { wechatOpenid: "wx_e2e_conflict" } });
    const conflictPhone = await prisma.user.create({ data: { phone: "13800000105" } });
    assert.equal((await invoke("wx-conflict", "phone-conflict")).status, 409);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: conflictWechat.id } })).phone, null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: conflictPhone.id } })).wechatOpenid, null);

    await prisma.user.create({
      data: { wechatOpenid: "wx_e2e_other_phone", phone: "13800000109" },
    });
    assert.equal((await invoke("wx-other-phone", "phone-other")).status, 409);

    await prisma.user.create({
      data: { wechatOpenid: "wx_e2e_existing_owner", phone: "13800000107" },
    });
    assert.equal((await invoke("wx-phone-other-owner", "phone-owned")).status, 409);

    assert.equal((await invoke("wx-invalid-phone", "phone-invalid")).status, 400);
    assert.equal(await prisma.user.count({ where: { wechatOpenid: "wx_e2e_invalid_phone" } }), 0);

    const race = await Promise.all([
      invoke("wx-race-a", "phone-race-a"),
      invoke("wx-race-b", "phone-race-b"),
    ]);
    assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
    assert.equal(await prisma.user.count({ where: { phone: "13800000108" } }), 1);

    console.log("WeChat phone login end-to-end checks passed.");
  } finally {
    await prisma.user.deleteMany({
      where: { OR: [{ phone: { in: fixturePhones } }, { wechatOpenid: { in: fixtureOpenIds } }] },
    }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { wechatOpenid: "wx_e2e_existing_owner" } }).catch(() => undefined);
    await prisma.$disconnect();
    globalThis.fetch = originalFetch;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
