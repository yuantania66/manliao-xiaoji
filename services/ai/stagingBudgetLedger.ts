import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const STAGING_BUDGET_ID = "staging-first-wechat-trial-20261029";
export const STAGING_BUDGET_CAP_MICRO_CNY = 20_000_000;
export const STAGING_BUDGET_REQUEST_LIMIT = 100;

type Reservation = { id: string; upperMicroCny: number; actualMicroCny: number | null };
export type StagingBudgetLedger = {
  version: 1;
  budgetId: typeof STAGING_BUDGET_ID;
  capMicroCny: typeof STAGING_BUDGET_CAP_MICRO_CNY;
  requestLimit: 29 | typeof STAGING_BUDGET_REQUEST_LIMIT;
  halted: boolean;
  haltReason: "budget_exhausted" | "request_limit" | "unknown_result" | "reservation_overrun" | null;
  reservations: Reservation[];
};

// Only an explicit, one-time operator initialization may write this value.
// Runtime operations never create, reset, or recover a missing ledger.
export const INITIAL_STAGING_BUDGET_LEDGER = Object.freeze({
  version: 1 as const,
  budgetId: STAGING_BUDGET_ID,
  capMicroCny: STAGING_BUDGET_CAP_MICRO_CNY,
  requestLimit: STAGING_BUDGET_REQUEST_LIMIT,
  halted: false,
  haltReason: null,
  reservations: Object.freeze([] as Reservation[]),
});

export class StagingBudgetError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "StagingBudgetError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const money = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const hasKeys = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const invalidLedger = () => new StagingBudgetError("ledger_invalid", "Invalid staging budget ledger; operator review required.");

function validateLedger(value: unknown, expectedRequestLimit: 29 | 100 = STAGING_BUDGET_REQUEST_LIMIT): { ledger: StagingBudgetLedger; committedMicroCny: number } {
  if (!hasKeys(value, ["version", "budgetId", "capMicroCny", "requestLimit", "halted", "haltReason", "reservations"]) ||
      value.version !== 1 || value.budgetId !== STAGING_BUDGET_ID ||
      value.capMicroCny !== STAGING_BUDGET_CAP_MICRO_CNY || value.requestLimit !== expectedRequestLimit ||
      !Array.isArray(value.reservations) || value.reservations.length > expectedRequestLimit ||
      !((value.halted === false && value.haltReason === null) ||
        (value.halted === true && ["budget_exhausted", "request_limit", "unknown_result", "reservation_overrun"].includes(String(value.haltReason))))) {
    throw invalidLedger();
  }
  const ids = new Set<string>();
  let committedMicroCny = 0;
  for (const entry of value.reservations) {
    if (!hasKeys(entry, ["id", "upperMicroCny", "actualMicroCny"]) ||
        typeof entry.id !== "string" || !uuidPattern.test(entry.id) || ids.has(entry.id) ||
        !money(entry.upperMicroCny) || entry.upperMicroCny === 0 ||
        entry.upperMicroCny > STAGING_BUDGET_CAP_MICRO_CNY ||
        (entry.actualMicroCny !== null && (!money(entry.actualMicroCny) || entry.actualMicroCny > entry.upperMicroCny))) {
      throw invalidLedger();
    }
    ids.add(entry.id);
    committedMicroCny += entry.actualMicroCny === null ? entry.upperMicroCny : entry.actualMicroCny;
    if (!Number.isSafeInteger(committedMicroCny) || committedMicroCny > STAGING_BUDGET_CAP_MICRO_CNY) throw invalidLedger();
  }
  return { ledger: value as StagingBudgetLedger, committedMicroCny };
}

/** Pure operator-only migration for the explicitly approved 2026-11-12 increase.
 * Never called by runtime reads/reservations. Caller must stop the service, reject
 * existing locks, retain exact old bytes, and atomically replace the same ledger.
 */
export function prepareApproved100CallLedger(value: unknown): StagingBudgetLedger {
  const { ledger, committedMicroCny } = validateLedger(value, 29);
  if (ledger.reservations.length !== 29 || committedMicroCny !== 558_684 ||
      ledger.reservations.some(entry => entry.actualMicroCny === null) ||
      !ledger.halted || ledger.haltReason !== "request_limit") {
    throw new StagingBudgetError("approval_snapshot_mismatch", "The approved budget snapshot changed; operator review required.");
  }
  const upgraded: StagingBudgetLedger = {
    ...ledger, requestLimit: 100, halted: false, haltReason: null,
    reservations: ledger.reservations.map(entry => ({ ...entry })),
  };
  validateLedger(upgraded);
  return upgraded;
}

async function readLedger(path: string) {
  // Reject FIFO/device/directory paths before opening; O_NOFOLLOW also closes
  // the ordinary lstat/open symlink race. Hard links cannot share one lock.
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1) throw invalidLedger();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino) throw invalidLedger();
    return validateLedger(JSON.parse(await file.readFile("utf8")) as unknown);
  } finally {
    await file.close();
  }
}

async function writeLedger(path: string, ledger: StagingBudgetLedger) {
  validateLedger(ledger);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(ledger)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    // The caller holds the exclusive lock until the directory entry is synced.
    const existing = await lstat(path);
    if (!existing.isFile() || existing.nlink !== 1) throw invalidLedger();
    await rename(temporaryPath, path);
  } finally {
    // A failed mutation leaves the lock in place, including when this cleanup fails.
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function accessLedger<T>(path: string, mutate: boolean, action: (ledger: StagingBudgetLedger, committed: number) => T): Promise<T> {
  let acquired = false;
  let retainLock = false;
  // Resolve directory aliases so every process addressing the same file uses
  // the same lock. All staging processes must use this one persistent path.
  const absolute = resolve(path);
  const directoryPath = await realpath(dirname(absolute));
  const ledgerPath = join(directoryPath, basename(absolute));
  const lockPath = `${ledgerPath}.lock`;
  const directory = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (attempt >= 100) throw new StagingBudgetError("ledger_locked", "Staging budget ledger is locked; no stale lock takeover is permitted.");
        await delay(20);
      }
    }
    retainLock = true;
    await directory.sync();
    retainLock = false;
    const { ledger, committedMicroCny } = await readLedger(ledgerPath);
    const result = action(ledger, committedMicroCny);
    if (mutate) {
      // Any uncertain persistence failure blocks further spending until review.
      retainLock = true;
      await writeLedger(ledgerPath, ledger);
      await directory.sync();
      retainLock = false;
    }
    return result;
  } catch (error) {
    if (error instanceof StagingBudgetError) throw error;
    throw new StagingBudgetError("ledger_unavailable", "Staging budget ledger is unavailable; no provider call is permitted.");
  } finally {
    try {
      if (acquired && !retainLock) {
        await rmdir(lockPath);
        await directory.sync();
      }
    } finally {
      await directory.close();
    }
  }
}

export async function reserveBudget(path: string, upperMicroCny: number): Promise<{ id: string }> {
  if (!money(upperMicroCny) || upperMicroCny === 0) {
    throw new StagingBudgetError("invalid_amount", "Reservation must be a positive safe integer in micro-CNY.");
  }
  const result = await accessLedger(path, true, (ledger, committed) => {
    if (ledger.halted) throw new StagingBudgetError("ledger_halted", "The first staging trial budget is halted; automatic continuation is prohibited.");
    if (ledger.reservations.some((entry) => entry.actualMicroCny === null)) {
      ledger.halted = true;
      ledger.haltReason = "unknown_result";
      return { rejected: "unknown_result" };
    }
    if (ledger.reservations.length >= STAGING_BUDGET_REQUEST_LIMIT) {
      ledger.halted = true;
      ledger.haltReason = "request_limit";
      return { rejected: "request_limit" };
    }
    if (upperMicroCny > STAGING_BUDGET_CAP_MICRO_CNY - committed) {
      ledger.halted = true;
      ledger.haltReason = "budget_exhausted";
      return { rejected: "budget_exhausted" };
    }
    const id = randomUUID();
    ledger.reservations.push({ id, upperMicroCny, actualMicroCny: null });
    return { id };
  });
  if ("rejected" in result) throw new StagingBudgetError(result.rejected!, "The first staging trial is now halted; no further provider call is permitted.");
  return result;
}

export async function settleBudget(path: string, id: string, actualMicroCny: number): Promise<void> {
  if (!uuidPattern.test(id) || !money(actualMicroCny)) {
    throw new StagingBudgetError("invalid_amount", "Settlement requires a reservation UUID and a nonnegative safe integer in micro-CNY.");
  }
  const overrun = await accessLedger(path, true, (ledger) => {
    const reservation = ledger.reservations.find((entry) => entry.id === id);
    if (!reservation) throw new StagingBudgetError("reservation_missing", "Staging budget reservation was not found.");
    if (reservation.actualMicroCny !== null) throw new StagingBudgetError("reservation_settled", "Staging budget reservation was already settled.");
    if (actualMicroCny > reservation.upperMicroCny) {
      ledger.halted = true;
      ledger.haltReason ??= "reservation_overrun";
      return true;
    }
    reservation.actualMicroCny = actualMicroCny;
    return false;
  });
  if (overrun) throw new StagingBudgetError("reservation_overrun", "Actual charge exceeds the reserved bound; the full reservation remains held and the trial is halted.");
}

export async function readBudgetSnapshot(path: string) {
  return accessLedger(path, false, (ledger, committedMicroCny) => ({
    ledger,
    committedMicroCny,
    availableMicroCny: STAGING_BUDGET_CAP_MICRO_CNY - committedMicroCny,
    remainingRequests: STAGING_BUDGET_REQUEST_LIMIT - ledger.reservations.length,
  }));
}

// A separate, durable lock covers the whole provider request, not just ledger
// writes. It has no stale takeover: a crashed owner requires operator review.
// The optional timeout can only shorten the queue wait, including in fixtures.
export async function withBudgetReservation<T>(
  path: string,
  upperMicroCny: number,
  callback: (reservationId: string) => Promise<T>,
  queueTimeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<T> {
  if (!Number.isSafeInteger(queueTimeoutMs) || queueTimeoutMs < 1 || queueTimeoutMs > 60_000) {
    throw new StagingBudgetError("invalid_queue_timeout", "Queue timeout must be between 1 and 60000 ms.");
  }
  const absolute = resolve(path);
  const directoryPath = await realpath(dirname(absolute));
  const ledgerPath = join(directoryPath, basename(absolute));
  const flightPath = `${ledgerPath}.flight`;
  const directory = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let acquired = false;
  let retainFlight = false;
  let reservationId: string | undefined;
  const started = process.hrtime.bigint();
  try {
    for (;;) {
      signal?.throwIfAborted();
      try {
        await mkdir(flightPath, { mode: 0o700 });
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Number(process.hrtime.bigint() - started) / 1_000_000 >= queueTimeoutMs) {
          throw new StagingBudgetError("queue_timeout", "The staging model queue is occupied; no provider call was sent and no stale lock is taken over.");
        }
        await delay(20, undefined, { signal });
      }
    }
    retainFlight = true;
    await directory.sync();
    retainFlight = false;
    signal?.throwIfAborted();
    reservationId = (await reserveBudget(ledgerPath, upperMicroCny)).id;
    try {
      const result = await callback(reservationId);
      const pending = await stopIfUnsettled(ledgerPath, reservationId);
      if (pending) throw new StagingBudgetError("unknown_result", "Provider cost is unknown; the reservation remains held and the trial is halted.");
      return result;
    } catch (error) {
      // A known, already settled response can still fail business validation.
      // Only an unsettled request must stop all later spending.
      retainFlight = true;
      await stopIfUnsettled(ledgerPath, reservationId);
      retainFlight = false;
      throw error;
    }
  } finally {
    try {
      if (acquired && !retainFlight) {
        await rmdir(flightPath);
        await directory.sync();
      }
    } finally {
      await directory.close();
    }
  }
}

async function stopIfUnsettled(path: string, id: string): Promise<boolean> {
  return accessLedger(path, true, (ledger) => {
    const reservation = ledger.reservations.find((entry) => entry.id === id);
    if (!reservation) throw new StagingBudgetError("reservation_missing", "Staging budget reservation was not found.");
    if (reservation.actualMicroCny !== null) return false;
    ledger.halted = true;
    ledger.haltReason ??= "unknown_result";
    return true;
  });
}
