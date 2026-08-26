import assert from "node:assert/strict";

import { createClientTurnId } from "../lib/client-turn-id";

let nativeCalls = 0;
assert.equal(
  createClientTurnId({
    randomUUID: () => {
      nativeCalls += 1;
      return "00000000-0000-4000-8000-000000000001";
    },
  }),
  "turn-00000000-0000-4000-8000-000000000001"
);
assert.equal(nativeCalls, 1, "native randomUUID should remain the preferred path");

const fallbackId = createClientTurnId({
  getRandomValues: (bytes) => {
    bytes.set(Array.from({ length: 16 }, (_, index) => index));
    return bytes;
  },
});
assert.match(
  fallbackId,
  /^turn-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
  "getRandomValues fallback must produce an RFC 4122 UUID v4 shape"
);
assert.equal(fallbackId, "turn-00010203-0405-4607-8809-0a0b0c0d0e0f");

assert.throws(
  () => createClientTurnId({}),
  /secure browser random source/,
  "missing secure randomness must fail closed"
);

console.log("client turn id checks passed");
