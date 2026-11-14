import { test } from "node:test";
import assert from "node:assert/strict";
import { csvText, philippineDateBoundary } from "../web/lib/export";

test("research CSV preserves Unicode, quotes, commas and multiline notes", () => {
  assert.equal(csvText([["Iligan", 'A, "B"', "line\nnext", "ñ", null]]),
    '\uFEFF"Iligan","A, ""B""","line\nnext","ñ",""');
});
test("CSV neutralizes formula payloads while preserving numeric measures", () => {
  for (const text of ["=1+1", "+cmd", "-cmd", "@SUM(A1)", " \t=cmd", "\r@cmd"])
    assert.ok(csvText([[text]]).startsWith('\uFEFF"\''));
  assert.equal(csvText([[-2, 0, 12]]), '\uFEFF"-2","0","12"');
});
test("inclusive Philippine day filters use an exclusive next-day boundary", () => {
  assert.equal(philippineDateBoundary("2026-10-24"), "2026-10-23T16:00:00.000Z");
  assert.equal(philippineDateBoundary("2026-12-31", true), "2026-12-31T16:00:00.000Z");
  assert.equal(philippineDateBoundary("2028-02-29", true), "2028-02-29T16:00:00.000Z");
  assert.equal(philippineDateBoundary(""), null);
});
