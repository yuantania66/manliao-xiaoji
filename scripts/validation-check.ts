import assert from "node:assert/strict";

import { isValidDateOnly } from "../lib/validation";

assert.equal(isValidDateOnly("2026-08-28"), true, "a normal calendar date should be accepted");
assert.equal(isValidDateOnly("2028-02-29"), true, "a leap day should be accepted in a leap year");
assert.equal(isValidDateOnly("2026-02-29"), false, "a leap day should be rejected outside a leap year");
assert.equal(isValidDateOnly("2026-02-31"), false, "an overflowing day should be rejected");
assert.equal(isValidDateOnly("2026-13-01"), false, "an overflowing month should be rejected");
assert.equal(isValidDateOnly("2026-2-01"), false, "a non-canonical date should be rejected");

console.log("Date-only validation checks passed.");
