import { test } from "node:test";
import assert from "node:assert/strict";
import type { MouseEvent } from "react";
import { openReportFromRow } from "../web/lib/report-row";

const click = (target: object, defaultPrevented = false) => ({ target, defaultPrevented }) as unknown as MouseEvent<HTMLTableRowElement>;

test("clicking ordinary report cells opens the report", () => {
  let opened = false;
  openReportFromRow(click({ closest: () => null }), () => { opened = true; });
  assert.equal(opened, true);
});

test("nested controls and prevented events do not also activate the row", () => {
  let opened = false;
  openReportFromRow(click({ closest: () => ({}) }), () => { opened = true; });
  openReportFromRow(click({ closest: () => null }, true), () => { opened = true; });
  assert.equal(opened, false);
});
