import { test } from "node:test";
import assert from "node:assert/strict";
import { properCaseTitle } from "../shared";

test("report titles use Proper Case", () => {
  assert.equal(properCaseTitle("drainage problem"), "Drainage Problem");
  assert.equal(properCaseTitle("cracked pavement at the market approach"), "Cracked Pavement at the Market Approach");
  assert.equal(properCaseTitle("non-working traffic lights"), "Non-Working Traffic Lights");
  assert.equal(properCaseTitle("the drainage is damage"), "The Drainage Is Damage");
  assert.equal(properCaseTitle("road issue near DPWH office"), "Road Issue Near DPWH Office");
  assert.equal(properCaseTitle("BROKEN STREETLIGHT ON THE HIGHWAY"), "Broken Streetlight on the Highway");
  assert.equal(properCaseTitle("  waste   bags in purok 2 "), "Waste Bags in Purok 2");
  assert.equal(properCaseTitle("tttttttt"), "Tttttttt");
  assert.equal(properCaseTitle(""), "");
});
