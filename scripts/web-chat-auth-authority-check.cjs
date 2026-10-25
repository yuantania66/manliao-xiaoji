/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS source-execution check, matching existing offline test scripts. */
// Read-only actual-source probe. Identities, transport and replies are synthetic.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const read = (name) => fs.readFileSync(root + '/' + name, 'utf8');
const chat = read('app/chat/chat-client.tsx');
const authorityContext = vm.createContext({ exports: {} });
vm.runInContext(compile(read('lib/chat-turn-result-authority.ts')), authorityContext);
const authority = authorityContext.exports;
const memory = () => { const data = new Map(); return { data, getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }; };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const success = (data) => new Response(JSON.stringify({ ok: true, data }));
const cacheSource = chat.slice(chat.indexOf('const readChatCache ='), chat.indexOf('const getInitialGuestMode ='));
function environment() {
  const local = memory(), session = memory(), requests = [], writes = [], pending = deferred();
  const document = { cookie: '' }, window = { localStorage: local, sessionStorage: session, addEventListener() {} };
  const authModule = vm.createContext({ exports: {}, window, document, require: () => ({ revokeGuestSession() {} }) });
  vm.runInContext(compile(read('lib/client-auth.ts')), authModule);
  const auth = authModule.exports;
  const user = id => ({ id, nickname: id, status: 'active' });
  const login = (id, token = 'synthetic-token-' + id) => auth.saveAuth({ token, expiresAt: '2099-01-01T00:00:00.000Z', user: user(id) });
  login('A');
  const apiModule = vm.createContext({ exports: {}, Headers, Response, fetch: async (path, options) => {
    requests.push({ path, token: options.headers.get('Authorization') });
    return requests.length === 1 ? pending.promise : success({ items: [], hasMore: false, nextCursor: null });
  }, require: () => auth });
  vm.runInContext(compile(read('lib/client-api.ts')), apiModule);
  const authAuthority = auth.captureAuthAuthority();
  const state = authority.createChatTurnAuthorityState('synthetic-session-A');
  const submitted = authority.submitChatTurnAuthority(state, 'synthetic-original-turn');
  const context = vm.createContext({ ...authority, ...auth, apiRequest: apiModule.exports.apiRequest,
    window, chatAuthRef: { current: authAuthority }, retryScopeRef: { current: 0 }, authRetryInFlightRef: { current: null }, olderRequestRef: { current: null }, pageGenerationRef: { current: 0 }, pageGeneration: 0, CHAT_CACHE_PREFIX: 'synthetic-chat-cache', cancelled: false,
    getInitialGuestMode: () => false, LOCAL_DEMO_TOKEN_PREFIX: 'local_demo_', isGuestMode: false,
    sessionId: 'synthetic-session-A', requestedSessionId: null, initialChat: null, canUseInitialChat: false,
    hydratedFromCacheRef: { current: false }, shouldAutoScrollToBottomRef: { current: false },
    sessionContextRef: { current: { authority: submitted.state } },
    messagesScrollRef: { current: { scrollHeight: 100, scrollTop: 0 } }, prependScrollRef: { current: null },
    isLoadingOlderMessagesRef: { current: false }, isLoadingMessages: false, hasMoreOlderMessages: true,
    olderMessagesCursor: 'synthetic-cursor', getErrorMessage: e => e.message,
    messages: [], input: '合成输入', createClientTurnId: () => 'synthetic-submit', showAiDebugTrace: false,
    useCallback: fn => fn, toMessages: items => items,
    revealAssistantReply: async () => writes.push('animation'),
    applyTurnCompletionResult: (_path, _result, completion) => { if (!completion.isCurrent || completion.isCurrent()) writes.push('completion'); },
    executionStatus: { retryable: true, isGuest: false, inputText: '合成旧输入', turnId: 'synthetic-original-turn', authority: submitted.result, authAuthority },
    greetingStatus: null, guestRetryInFlightRef: { current: undefined },
  });
  let visible = [];
  context.setMessages = value => { const next = typeof value === 'function' ? value(visible) : value; if (next !== visible) writes.push('messages'); visible = next; };
  for (const name of ['IsGuestMode','SessionId','HasMoreOlderMessages','OlderMessagesCursor','IsLoadingMessages','GreetingStatus','ErrorMessage','IsLoadingOlderMessages','TypingMessageIds','Input','ExecutionStatus']) {
    let previous = name === 'TypingMessageIds' ? [] : null;
    context['set' + name] = value => {
      const next = typeof value === 'function' ? value(previous) : value;
      if (next !== previous) writes.push(name);
      previous = next;
    };
  }
  vm.runInContext(compile(cacheSource), context);
  return { context, auth, login, pending, requests, writes, session, api: apiModule.exports, visible: () => visible };
}
const rows = [];
(async () => {
  for (const path of ['load', 'older', 'submit', 'retry']) for (const transition of ['current', 'B', 'renewed', 'session-back', 'unmount']) {
    const e = environment();
    if (path === 'load') e.context.requestedSessionId = 'synthetic-session-A';
    let source, name;
    if (path === 'load') { source = chat.slice(chat.indexOf('    const loadChat = async'), chat.indexOf('\n\n    loadChat();')); name = 'loadChat'; }
    if (path === 'older') { source = chat.slice(chat.indexOf('  const loadOlderMessages ='), chat.indexOf('  const handleMessagesScroll =')); name = 'loadOlderMessages'; }
    if (path === 'submit') { source = chat.slice(chat.indexOf('  const handleSubmit = async'), chat.indexOf('  const handleExecutionRetry =')); name = 'handleSubmit'; }
    if (path === 'retry') { source = chat.slice(chat.indexOf('  const handleExecutionRetry = async'), chat.indexOf('  const loginForDebug =')); name = 'handleExecutionRetry'; }
    vm.runInContext(compile(source + '\nglobalThis.run = ' + name + ';'), e.context);
    const running = e.context.run({ preventDefault() {} });
    assert.equal(e.requests.length, 1);
    if (transition === 'B') e.login('B');
    if (transition === 'renewed') e.login('A');
    if (transition === 'session-back' || transition === 'unmount') {
      e.context.cancelled = true; e.context.pageGenerationRef.current++;
      e.context.sessionContextRef.current.authority = authority.advanceChatSessionAuthority(e.context.sessionContextRef.current.authority, 'synthetic-session-A');
    }
    e.writes.length = 0;
    const result = path === 'load' || path === 'older' ? {
      items: [{ id: 'synthetic-A-history', role: 'assistant', content: '合成A旧历史' }], hasMore: false, nextCursor: null,
    } : { status: 'committed', userMessage: { id: 'synthetic-A-user', content: '合成A输入' }, assistantMessage: { id: 'synthetic-A-reply', content: '合成A回复' } };
    e.pending.resolve(success(result)); await running;
    const contaminatedCache = [...e.session.data.entries()].some(([key, value]) => key.endsWith(':B') && value.includes('synthetic-A'));
    if (transition === 'current') assert(e.writes.includes('messages'), path + ' current success remains visible');
    else {
      assert.equal(e.writes.includes('messages'), false, path + '/' + transition + ' old result must not enter UI');
      assert.equal(e.writes.includes('animation'), false, path + '/' + transition + ' must not animate');
      assert.equal(e.requests.length, 1, path + '/' + transition + ' no follow-up request');
    }
    assert.equal(contaminatedCache, false, path + ' cache owner');
    rows.push({ path, transition, isolation: 'PASS' });
  }
  {
    const e = environment();
    const running = e.api.apiRequest('/synthetic-old-request');
    const rejected = assert.rejects(running);
    e.login('B'); e.login('A');
    e.pending.resolve(new Response(JSON.stringify({ ok: false, error: { message: 'synthetic 401' } }), { status: 401 }));
    await rejected;
    assert.equal(e.auth.getAuthToken(), 'synthetic-token-A', 'reused-token A-B-A old 401 must preserve current A');
    rows.push({ path: 'api-401', transition: 'A(token-A) -> B -> A(same token-A)', isolation: 'PASS' });
  }
  {
    const e = environment(), captured = e.auth.captureAuthAuthority();
    e.session.setItem('synthetic-chat-cache:A', JSON.stringify({ sessionId: 'synthetic-session-A', messages: [{ id: 'unowned' }] }));
    e.context.captured = captured;
    assert.equal(vm.runInContext('readChatCache(captured)', e.context), null, 'ownerless cache is a miss');
    e.session.setItem('synthetic-chat-cache:A', JSON.stringify({ ownerId: 'B', sessionId: 'synthetic-session-A', messages: [] }));
    assert.equal(vm.runInContext('readChatCache(captured)', e.context), null, 'mismatched owner is a miss');
    e.session.setItem('synthetic-chat-cache:A', JSON.stringify({ ownerId: 'A', sessionId: 'synthetic-session-A', messages: [] }));
    assert(vm.runInContext('readChatCache(captured)', e.context), 'current owner cache remains usable');
    rows.push({ path: 'cache owner', isolation: 'PASS' });
  }
  console.log(JSON.stringify({ evidence: 'actual Web source branches + actual client auth/API with fake fetch; no browser/device', rows,
    networkCalls: 0, databaseCalls: 0, modelCalls: 0, runtimeWrites: 0 }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
