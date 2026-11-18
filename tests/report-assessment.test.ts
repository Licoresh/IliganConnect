import { test } from "node:test";
import assert from "node:assert/strict";
import { reportAssessmentSchema, reportSchema, SEVERITY_OPTIONS, URGENCY_OPTIONS } from "../shared/index";

test("staff assessment accepts explicit impact and time-sensitivity with a trimmed note", () => {
  for (const severity of SEVERITY_OPTIONS) for (const urgency of URGENCY_OPTIONS) {
    const assessment = reportAssessmentSchema.parse({ severity: severity.value, urgency: urgency.value, note: "  Observed disruption beside the covered court.  " });
    assert.equal(assessment.severity, severity.value);
    assert.equal(assessment.urgency, urgency.value);
    assert.equal(assessment.note, "Observed disruption beside the covered court.");
  }
});

test("assessment rejects missing, coerced, fractional and out-of-range ratings", () => {
  const valid = { severity: 3, urgency: 4, note: "Observed service disruption." };
  for (const field of ["severity", "urgency"] as const) {
    for (const value of [undefined, null, "3", "", true, 0, 6, -1, 2.5, NaN, Infinity, -Infinity]) {
      assert.equal(reportAssessmentSchema.safeParse({ ...valid, [field]: value }).success, false, `${field}: ${String(value)}`);
    }
  }
});

test("assessment evidence follows existing bounded multilingual text validation", () => {
  const valid = { severity: 2, urgency: 3 };
  for (const note of ["", "    ", "\u200b".repeat(10), "abcd", "x".repeat(4001), "Observed\u0000 damage"]) {
    assert.equal(reportAssessmentSchema.safeParse({ ...valid, note }).success, false);
  }
  const maximumNote = "Observed the reported issue and recorded the next assessment step. ".repeat(64).slice(0, 4000);
  assert.equal(maximumNote.length, 4000);
  for (const note of [maximumNote, "Naobserbahan ang kadaot.\nFollow-up: inspect the drain.", "Literal <inspection> & source evidence."]) {
    assert.equal(reportAssessmentSchema.safeParse({ ...valid, note }).success, true);
  }
});

test("resident report input cannot supply official severity or urgency", () => {
  const report = reportSchema.parse({ category_id: "ed50652a-ce04-4a3d-97c0-bb7837cd2893", barangay_id: "5c5cd6d8-1af8-4c17-bdd5-2065176644d6",
    title: "Drainage beside the covered court", description: "The drain is obstructed beside the covered court.", latitude: 8.22947578, longitude: 124.23688253,
    severity: 5, urgency: 5, assessed_by: "spoofed" });
  assert.equal("severity" in report, false);
  assert.equal("urgency" in report, false);
  assert.equal("assessed_by" in report, false);
});
