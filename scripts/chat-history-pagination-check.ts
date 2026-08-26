import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Item = {
  id: string;
  createdAt: number;
};

const PAGE_SIZE = 50;

const compareNewestFirst = (left: Item, right: Item) =>
  right.createdAt - left.createdAt || right.id.localeCompare(left.id);

const readPage = (items: Item[], before: string | null) => {
  const ordered = [...items].sort(compareNewestFirst);
  const cursorIndex = before ? ordered.findIndex((item) => item.id === before) : -1;
  assert(!before || cursorIndex >= 0, `unknown cursor: ${before}`);
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const window = ordered.slice(start, start + PAGE_SIZE + 1);
  const hasMore = window.length > PAGE_SIZE;
  const page = window.slice(0, PAGE_SIZE).reverse();
  return {
    items: page,
    hasMore,
    nextCursor: hasMore ? page[0]?.id ?? null : null,
  };
};

const collectAll = (items: Item[]) => {
  const collected: Item[] = [];
  let before: string | null = null;
  let iterations = 0;

  do {
    const page = readPage(items, before);
    collected.unshift(...page.items);
    before = page.nextCursor;
    iterations += 1;
    assert(iterations <= Math.ceil(items.length / PAGE_SIZE) + 1, "pagination must terminate");
  } while (before);

  return collected;
};

const makeItems = (count: number, sameTimestampEvery = 0): Item[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `message-${String(index).padStart(4, "0")}`,
    createdAt: sameTimestampEvery > 0 ? Math.floor(index / sameTimestampEvery) : index,
  }));

const counterexampleSizes = [
  0, 1, 2, 3, 10, 49, 50, 51, 52, 75, 99, 100, 101, 149, 150, 151, 199, 200, 201, 251,
];

for (const size of counterexampleSizes) {
  const source = makeItems(size);
  const collected = collectAll(source);
  assert.equal(collected.length, source.length, `all messages must be reachable for size=${size}`);
  assert.equal(new Set(collected.map((item) => item.id)).size, source.length, `no duplicates for size=${size}`);
  assert.deepEqual(
    collected.map((item) => item.id),
    [...source].sort((left, right) => -compareNewestFirst(left, right)).map((item) => item.id),
    `messages remain chronological for size=${size}`
  );
}

const sameTimestampItems = makeItems(137, 7);
const sameTimestampCollected = collectAll(sameTimestampItems);
assert.equal(sameTimestampCollected.length, 137);
assert.equal(new Set(sameTimestampCollected.map((item) => item.id)).size, 137);

const original = makeItems(120);
const firstPage = readPage(original, null);
assert.equal(firstPage.items.length, 50);
const inserted = [
  { id: "new-1", createdAt: 1001 },
  { id: "new-2", createdAt: 1002 },
  { id: "new-3", createdAt: 1003 },
];
const olderAfterInsert: Item[] = [];
let insertCursor = firstPage.nextCursor;
while (insertCursor) {
  const page = readPage([...original, ...inserted], insertCursor);
  olderAfterInsert.unshift(...page.items);
  insertCursor = page.nextCursor;
}
assert.equal(olderAfterInsert.length, 70, "newer inserts must not shift or skip the older cursor window");
assert.equal(new Set(olderAfterInsert.map((item) => item.id)).size, 70);
assert(olderAfterInsert.every((item) => !item.id.startsWith("new-")));

const pageSource = readFileSync("app/chat/page.tsx", "utf8");
const routeSource = readFileSync("app/api/chat/sessions/[sessionId]/messages/route.ts", "utf8");
const clientSource = readFileSync("app/chat/chat-client.tsx", "utf8");

assert(pageSource.includes('orderBy: [{ createdAt: "desc" }, { id: "desc" }]'));
assert(pageSource.includes("take: 51"));
assert(pageSource.includes("newestItems.slice(0, 50).reverse()"));
assert(routeSource.includes('searchParams.get("before")'));
assert(routeSource.includes("take: pagination.take + 1"));
assert(routeSource.includes("nextCursor"));
assert(clientSource.includes("onScroll={handleMessagesScroll}"));
assert(clientSource.includes("prependScrollRef"));
assert(clientSource.includes("shouldAutoScrollToBottomRef"));

console.log(
  JSON.stringify(
    {
      counterexampleSizes: counterexampleSizes.length,
      sameTimestampMessages: sameTimestampItems.length,
      insertionStability: "pass",
      latestPage: "pass",
      upwardCursorLoading: "pass",
      chronologicalOrder: "pass",
      duplicatePrevention: "pass",
      scrollPreservationContract: "present",
    },
    null,
    2
  )
);
