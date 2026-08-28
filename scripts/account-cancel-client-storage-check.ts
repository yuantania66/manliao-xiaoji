import assert from "node:assert/strict";
import {
  clearCancelledAccount,
  getCancellationUserSnapshot,
  shouldRequestCloudAccountCancellation,
} from "../lib/client-auth";

class StorageDouble {
  private values = new Map<string, string>();
  failOnRemove: string | null = null;

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
    Object.defineProperty(this, key, { configurable: true, enumerable: true, value: String(value) });
  }
  removeItem(key: string) {
    if (key === this.failOnRemove) throw new Error("injected storage failure");
    this.values.delete(key);
    delete (this as unknown as Record<string, unknown>)[key];
  }
  clear() { for (const key of [...this.values.keys()]) this.removeItem(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

const localStorage = new StorageDouble();
const sessionStorage = new StorageDouble();
Object.assign(globalThis, {
  window: { localStorage, sessionStorage },
  document: { cookie: "" },
});

const currentUserId = "current-user";
for (const [key, value] of [
  ["xinqingAuthToken", "token"],
  ["xinqingAuthExpiresAt", "expiry"],
  ["xinqingAuthUser", "user"],
  ["xinqingLoggedIn", "true"],
  [`xinqingInsightsAnalysisAuthorized:${currentUserId}`, "true"],
  ["xinqingInsightsAnalysisAuthorized:other-user", "true"],
  ["xinqingGuestRecentGreetings:v2", "guest"],
]) localStorage.setItem(key, value);
for (const [key, value] of [
  [`xinqingChatCache:${currentUserId}`, "chat"],
  [`xinqingChatCalendarCache:${currentUserId}:2026-08`, "calendar"],
  ["xinqingChatCache:other-user", "other"],
  ["xinqingGuestChatCache:v2", "guest"],
]) sessionStorage.setItem(key, value);

clearCancelledAccount(currentUserId);
assert.equal(localStorage.getItem(`xinqingInsightsAnalysisAuthorized:${currentUserId}`), null);
assert.equal(sessionStorage.getItem(`xinqingChatCache:${currentUserId}`), null);
assert.equal(sessionStorage.getItem(`xinqingChatCalendarCache:${currentUserId}:2026-08`), null);
assert.equal(localStorage.getItem("xinqingInsightsAnalysisAuthorized:other-user"), "true");
assert.equal(localStorage.getItem("xinqingGuestRecentGreetings:v2"), "guest");
assert.equal(sessionStorage.getItem("xinqingChatCache:other-user"), "other");
assert.equal(sessionStorage.getItem("xinqingGuestChatCache:v2"), "guest");

assert.throws(() => clearCancelledAccount(""), /账号标识/u);
localStorage.setItem("xinqingAuthToken", "retry-token");
localStorage.setItem("xinqingAuthUser", JSON.stringify({ id: currentUserId }));
sessionStorage.setItem(`xinqingChatCache:${currentUserId}`, "retry-chat");
const capturedUser = getCancellationUserSnapshot();
assert.equal(capturedUser?.id, currentUserId);
sessionStorage.failOnRemove = `xinqingChatCache:${currentUserId}`;
assert.throws(() => clearCancelledAccount(currentUserId), /injected storage failure/u);
assert.equal(getCancellationUserSnapshot(), null, "auth removal must reproduce the rerender counterexample");
assert.equal(capturedUser?.id, currentUserId, "first-render user snapshot must survive partial cleanup");
sessionStorage.failOnRemove = null;
assert.equal(shouldRequestCloudAccountCancellation(true), false, "local retry must not repeat cloud deletion");
clearCancelledAccount(capturedUser!.id);
assert.equal(localStorage.getItem("xinqingAuthToken"), null, "local cleanup must be retryable without another API call");

console.log("Account cancellation client storage checks passed.");
