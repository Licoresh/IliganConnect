import { test } from "node:test";
import assert from "node:assert/strict";
import { createReportSchema, hasReportCoordinates, reportSchema } from "../shared/index";

const valid = {
  category_id: "ed50652a-ce04-4a3d-97c0-bb7837cd2893", barangay_id: "5c5cd6d8-1af8-4c17-bdd5-2065176644d6",
  title: "Drainage beside the covered court", description: "Please inspect the blocked drain beside the covered court.",
  latitude: 8.22947578, longitude: 124.23688253,
};
const manual = { ...valid, latitude: null, longitude: null, location_source: "manual", purok: "Purok 3" };

test("written addresses supplement the mandatory pin and cannot replace it", () => {
  const output = reportSchema.parse({ ...valid, location_source: "pin", purok: "Purok 3", zone: "  Zone 2  ", landmark: "Beside the covered court" });
  assert.equal(output.latitude, valid.latitude);
  assert.equal(output.longitude, valid.longitude);
  assert.equal(output.zone, "Zone 2");
  assert.equal(output.purok, "Purok 3");
  for (const details of [{ purok: "" }, { purok: "", zone: " " }, { purok: "\u200b" }]) {
    assert.equal(reportSchema.safeParse({ ...manual, ...details }).success, false);
  }
  assert.equal(reportSchema.safeParse({ ...manual, zone: "Zone 2", landmark: "House 12, beside the clinic" }).success, false);
  assert.equal(reportSchema.safeParse({ ...valid, location_source: "pin", purok: "", zone: "", landmark: "" }).success, true);
});

test("GPS preserves confirmed coordinates, device accuracy and written directions", () => {
  const output = reportSchema.parse({ ...valid, location_source: "gps", location_accuracy: 12.5,
    location_address: "Poblacion, Iligan City", purok: "Purok 1", zone: "Zone 2", landmark: "Beside the clinic" });
  assert.equal(output.latitude, valid.latitude);
  assert.equal(output.longitude, valid.longitude);
  assert.equal(output.location_accuracy, 12.5);
  assert.equal(output.landmark, "Beside the clinic");
  assert.equal(reportSchema.safeParse({ ...valid, location_source: "gps", location_accuracy: null }).success, true);
  assert.equal(reportSchema.safeParse(valid).success, true); // Previous client call shape.
});

test("location validation rejects partial pairs, missing pins and invalid metadata", () => {
  for (const change of [
    { longitude: null }, { latitude: null }, { latitude: null, longitude: null },
    { location_source: "gps", latitude: null, longitude: null },
    { location_source: "pin", location_accuracy: 5 }, { location_source: "fake" },
    { location_source: "gps", location_accuracy: Infinity }, { location_source: "gps", location_accuracy: NaN },
    { location_source: "gps", location_accuracy: -1 }, { location_source: "gps", location_accuracy: 100001 },
    { purok: "x".repeat(81) }, { zone: "x".repeat(81) }, { location_address: "x".repeat(501) },
    { purok: "Purok\u0001 3" },
  ]) assert.equal(reportSchema.safeParse({ ...valid, ...change }).success, false, JSON.stringify(change));
  assert.equal(reportSchema.safeParse({ ...manual, latitude: valid.latitude, longitude: null }).success, false);
});

test("category and problem rules still apply to pinned reports", () => {
  const schema = createReportSchema([{ id: valid.category_id, name: "Drainage", problem_types: [
    { code: "blocked", label: "Blocked drain", sort_order: 1 },
  ] }]);
  assert.equal(schema.safeParse(valid).success, false);
  assert.equal(schema.safeParse({ ...valid, problem_type: "blocked" }).success, true);
  assert.equal(schema.safeParse({ ...manual, problem_type: "blocked" }).success, false);
});

test("map coordinate guard excludes missing and invalid locations without coercion", () => {
  assert.equal(hasReportCoordinates(valid), true);
  assert.equal(hasReportCoordinates({ latitude: 0, longitude: 0 }), true);
  for (const point of [
    { latitude: null, longitude: null }, { latitude: undefined, longitude: 124.2 },
    { latitude: NaN, longitude: 124.2 }, { latitude: 8.2, longitude: Infinity },
    { latitude: 91, longitude: 124.2 }, { latitude: 8.2, longitude: -181 },
  ]) assert.equal(hasReportCoordinates(point), false);
});
