import assert from "node:assert/strict";
import test from "node:test";
import { reportScheduleDayReached, scheduledManilaDayReached } from "../shared/index";

test("scheduled work actions unlock on the scheduled Philippine calendar day", () => {
  const scheduledAt = "2026-11-15T23:59:00+08:00";
  assert.equal(reportScheduleDayReached(scheduledAt, new Date("2026-11-14T15:59:00Z")), false);
  assert.equal(reportScheduleDayReached(scheduledAt, new Date("2026-11-14T16:00:00Z")), true);
});

test("missing or invalid schedule dates never unlock work actions", () => {
  const now = new Date("2026-11-14T16:00:00Z");
  assert.equal(reportScheduleDayReached(null, now), false);
  assert.equal(reportScheduleDayReached("not-a-date", now), false);
});

test("meeting participation can no longer be left from the start of its Philippine calendar day", () => {
  const scheduledAt = "2026-11-15T15:00:00+08:00";
  assert.equal(scheduledManilaDayReached(scheduledAt, new Date("2026-11-14T15:59:59Z")), false);
  assert.equal(scheduledManilaDayReached(scheduledAt, new Date("2026-11-14T16:00:00Z")), true);
  assert.equal(scheduledManilaDayReached(scheduledAt, new Date("2026-11-15T00:00:00Z")), true);
});
