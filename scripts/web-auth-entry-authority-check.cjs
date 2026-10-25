/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS source-execution check, matching existing offline test scripts. */
// Actual identity-writer source; deterministic synthetic storage and transport only.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const segment = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
};
const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), data };
};
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function environment() {
  const local = memory(), session = memory(), effects = [], writes = [], calls = [], listeners = [];
  let resolve, reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const window = { localStorage: local, sessionStorage: session, addEventListener: (_, fn) => listeners.push(fn), location: { assign: target => writes.push('navigate:' + target) } };
  const authModule = vm.createContext({ exports: {}, window, document: { cookie: '' }, Math: { ...Math, random: () => 0.25 }, require: () => ({ revokeGuestSession() {} }) });
  vm.runInContext(compile(read('lib/client-auth.ts')), authModule);
  const auth = authModule.exports;
  const identity = id => ({ token: 'synthetic-token-' + id, expiresAt: '2099-01-01T00:00:00Z', user: { id, status: 'ACTIVE' } });
  auth.saveAuth(identity('A'));
  const context = vm.createContext({ ...auth, window, GUEST_MODE_KEY: 'xinqingGuestMode',
    ClientApiError: class extends Error {},
    loginScope: { current: auth.createAuthRequestScope() }, codeScope: { current: auth.createAuthRequestScope() },
    debugLoginScope: { current: auth.createAuthRequestScope() }, logoutScope: { current: auth.createAuthRequestScope() }, cancelScope: { current: auth.createAuthRequestScope() },
    ownerAuthority: auth.captureAuthAuthority(), authRevision: 0,
    useEffect: effect => effects.push(effect), getInitialProfileState: () => 'logged',
    apiRequest: (target, options) => { calls.push({ target, options, token: auth.getAuthToken() }); return pending; },
    router: { push: target => writes.push('navigate:' + target) }, getErrorMessage: error => error.message,
    hasAgreed: true, phone: '13800000000', phoneCode: '123456', phoneCodeSent: true,
    isCancelling: false, storedUser: { id: 'A' }, needsCode: false, cloudCancelled: false,
  });
  for (const name of ['ProfileState', 'CurrentUser', 'IsAuthChecking', 'IsLoggingIn', 'LoginError', 'NeedsEntryChoice', 'PhoneError', 'IsLoginPanelOpen', 'IsSendingCode', 'PhoneCodeSent', 'PhoneCode', 'DevCodeHint', 'IsDebugLoggingIn', 'ErrorMessage', 'IsCancelling', 'Error', 'MediaCleanupPending', 'CloudCancelled', 'Cleared', 'IsConfirming']) {
    context['set' + name] = value => { writes.push(name); context[name[0].toLowerCase() + name.slice(1)] = value; };
  }
  return { auth, identity, context, effects, writes, calls, resolve, reject, listeners, local };
}
const me = read('app/me/page.tsx'), home = read('app/page.tsx'), settings = read('app/me/settings/page.tsx'), cancel = read('app/me/settings/cancel/page.tsx'), chat = read('app/chat/chat-client.tsx');
const cases = [
  { name: 'home login', source: segment(home, '  const loginDirectly = async', '  const actions ='), handler: 'loginDirectly', scope: 'loginScope' },
  { name: 'debug login', source: segment(chat, '  const loginForDebug = async', '  return ('), handler: 'loginForDebug', scope: 'debugLoginScope' },
  { name: 'phone login', source: segment(me, '  const finishLogin =', '  const getErrorMessage =') + segment(me, '  const loginWithPhone = async', '  const loginWithWechat ='), handler: 'loginWithPhone', scope: 'loginScope' },
  { name: 'wechat login', source: segment(me, '  const closeLoginPanel =', '  const getErrorMessage =') + segment(me, '  const loginWithWechat = async', '  const agreeAndContinue ='), handler: 'loginWithWechat', scope: 'loginScope', close: true },
  { name: 'login code', source: segment(me, '  const sendPhoneCode = async', '  const loginWithPhone ='), handler: 'sendPhoneCode', scope: 'codeScope', code: true },
  { name: 'logout', source: segment(settings, '  const logout = async', '  return ('), handler: 'logout', scope: 'logoutScope', clear: true },
  { name: 'cancellation', source: segment(cancel, '  const cancelAccount = async', '  return ('), handler: 'cancelAccount', scope: 'cancelScope', clear: true },
];
let passed = 0;
(async () => {
  for (const outcome of ['success', 'failure']) for (const transition of ['current', 'B', 'renewed']) {
    const e = environment();
    vm.runInContext(compile(segment(me, '  useEffect(() => {\n    const storedAuth', '  const isLogged =')), e.context);
    e.effects[0]();
    if (transition !== 'current') e.auth.saveAuth(e.identity(transition === 'B' ? 'B' : 'A'));
    e.writes.length = 0;
    if (outcome === 'success') e.resolve({ user: e.identity('A').user }); else e.reject(new Error('synthetic failure'));
    await settle();
    if (transition !== 'current') {
      assert.deepEqual(e.writes, [], `profile ${transition}/${outcome}`);
      assert.equal(e.auth.getAuthToken(), e.identity(transition === 'B' ? 'B' : 'A').token);
    } else {
      assert(e.writes.includes('IsAuthChecking'));
      assert.equal(e.auth.getAuthToken(), outcome === 'success' ? 'synthetic-token-A' : null);
    }
    passed++;
  }
  for (const item of cases) for (const transition of ['current', 'B', 'renewed', 'unmount']) for (const outcome of ['success', 'failure']) {
    const e = environment();
    vm.runInContext(compile(item.source + '\nglobalThis.run = ' + item.handler + ';'), e.context);
    const running = e.context.run();
    assert.equal(e.calls.length, 1, item.name + ' dispatch');
    if (transition === 'B' || transition === 'renewed') e.auth.saveAuth(e.identity(transition === 'B' ? 'B' : 'A'));
    if (transition === 'unmount') e.context[item.scope].current.invalidate();
    e.writes.length = 0;
    if (outcome === 'failure') e.reject(new Error('synthetic failure'));
    else e.resolve(item.handler === 'logout' ? { loggedOut: true } : item.handler === 'cancelAccount' ? { cancelled: true, mediaCleanup: 'complete' } : item.code ? { expiresIn: 60 } : e.identity('A'));
    await running;
    if (transition === 'current') {
      assert(e.writes.length > 0, item.name + ' current normal result');
      assert.equal(e.auth.getAuthToken(), item.clear && (outcome === 'success' || item.handler === 'logout') ? null : 'synthetic-token-A');
    } else {
      assert.deepEqual(e.writes, [], `${item.name}/${transition}/${outcome}`);
      assert.equal(e.auth.getAuthToken(), transition === 'B' ? 'synthetic-token-B' : 'synthetic-token-A');
    }
    passed++;
  }
  {
    const e = environment(), item = cases.find(item => item.close);
    vm.runInContext(compile(item.source + '\nglobalThis.run=loginWithWechat;globalThis.close=closeLoginPanel;'), e.context);
    const running = e.context.run(); e.context.close(); e.writes.length = 0;
    e.resolve(e.identity('A')); await running; assert.deepEqual(e.writes, []); passed++;
  }
  {
    const e = environment(), item = cases.find(item => item.handler === 'cancelAccount');
    vm.runInContext(compile(item.source + '\nglobalThis.run=cancelAccount;'), e.context);
    e.auth.saveAuth(e.identity('B')); await e.context.run();
    assert.equal(e.calls.length, 0, 'A UI must not dispatch cancellation with B identity'); passed++;
  }
  {
    const e = environment(), snapshot = e.auth.captureAuthAuthority();
    assert.equal(e.auth.updateAuthUser(snapshot, { ...e.identity('A').user, nickname: 'synthetic updated profile' }), true);
    assert.equal(e.auth.isAuthAuthorityCurrent(snapshot), true, 'profile refresh preserves in-flight chat authority');
    e.listeners.forEach(fn => fn({ key: 'xinqingAuthUser' }));
    assert.equal(e.auth.isAuthAuthorityCurrent(snapshot), true, 'profile event preserves authority');
    for (const key of ['xinqingAuthToken', 'xinqingAuthExpiresAt', 'xinqingAuthRevision']) e.listeners.forEach(fn => fn({ key }));
    assert.equal(e.auth.isAuthAuthorityCurrent(snapshot), true, 'delayed duplicate storage notifications preserve current publication'); passed++;
  }
  console.log(`Web Auth entry authority: ${passed} source-execution controls passed; network/DB/model = 0.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
