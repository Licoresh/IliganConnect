import { test } from "node:test";
import assert from "node:assert/strict";
import { reportSchema, createReportSchema, transitions, statuses, aggregateReportCells, reportCellColor, clusterMapPoints, consultationPhase, distanceMeters, parseReportCoordinates, reportStatusLabel, reportStatusDescription } from "../shared/index";
const valid = {
  category_id: "ed50652a-ce04-4a3d-97c0-bb7837cd2893",
  barangay_id: "5c5cd6d8-1af8-4c17-bdd5-2065176644d6",
  title: "Pothole near intersection",
  description: "A large pothole obstructs the approach to the intersection.",
  latitude: 8.228,
  longitude: 124.2452,
  landmark: "",
};
test("consultation participation respects opening and closing boundaries", () => {
  const row = { status: "open", opens_at: "2026-10-24T01:00:00Z", closes_at: "2026-10-25T01:00:00Z" };
  assert.equal(consultationPhase(row, Date.parse(row.opens_at) - 1), "scheduled");
  assert.equal(consultationPhase(row, Date.parse(row.opens_at)), "open");
  assert.equal(consultationPhase(row, Date.parse(row.closes_at)), "open");
  assert.equal(consultationPhase(row, Date.parse(row.closes_at) + 1), "closed");
  assert.equal(consultationPhase({ ...row, status: "closed" }, Date.parse(row.opens_at)), "closed");
  assert.equal(consultationPhase({ ...row, closes_at: "invalid" }), "closed");
});
test("valid resident report preserves the confirmed location", () => {
  assert.equal(reportSchema.parse(valid).longitude, 124.2452);
});
test("coordinate entry rejects blank, nonnumeric and out-of-range values", () => {
  for (const [lat, lon] of [["", "124"], ["8", " "], ["91", "124"], ["8", "181"], ["NaN", "124"], ["8", "Infinity"]]) {
    assert.equal(parseReportCoordinates(lat, lon), null);
  }
  assert.deepEqual(parseReportCoordinates(" 8.228 ", "124.2452"), { latitude: 8.228, longitude: 124.2452 });
  assert.deepEqual(parseReportCoordinates("0", "0"), { latitude: 0, longitude: 0 });
});
test("nearby distance uses meters, is symmetric and handles the date line", () => {
  const origin = { latitude: 0, longitude: 0 }, north = { latitude: 1, longitude: 0 };
  assert.equal(distanceMeters(origin, origin), 0);
  assert.ok(Math.abs(distanceMeters(origin, north) - 111195) < 1);
  assert.equal(distanceMeters(origin, north), distanceMeters(north, origin));
  assert.ok(distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }) < 223);
  assert.ok(Number.isFinite(distanceMeters(origin, { latitude: 0, longitude: 180 })));
});

const problemSchema = createReportSchema([{ id: valid.category_id, name: "Drainage", problem_types: [
  { code: "clogged_blocked", label: "Clogged or Blocked Drainage", sort_order: 1 },
  { code: "other", label: "Others (Please Specify)", sort_order: 99 },
] }]);
test("new reports require a problem belonging to their category", () => {
  for (const problem_type of [undefined, null, "", "pothole", "unknown"]) {
    assert.equal(problemSchema.safeParse({ ...valid, problem_type }).success, false);
  }
  const parsed = problemSchema.parse({ ...valid, problem_type: "clogged_blocked", problem_other: null });
  assert.equal(parsed.description, valid.description);
  assert.equal(parsed.problem_type, "clogged_blocked");
});
test("Others requires a trimmed custom problem of at most 240 characters", () => {
  for (const problem_other of [undefined, null, "", "   ", "x".repeat(241)]) {
    assert.equal(problemSchema.safeParse({ ...valid, problem_type: "other", problem_other }).success, false);
  }
  assert.equal(problemSchema.parse({ ...valid, problem_type: "other", problem_other: "  Unusual drainage noise  " }).problem_other, "Unusual drainage noise");
});
test("switching to a predefined problem must clear custom details", () => {
  assert.equal(problemSchema.safeParse({ ...valid, problem_type: "clogged_blocked", problem_other: "Old custom description" }).success, false);
  assert.equal(problemSchema.safeParse({ ...valid, problem_type: "clogged_blocked", problem_other: null }).success, true);
});
test("rejects invalid coordinates, missing category, and insufficient description", () => {
  for (const change of [
    { latitude: 91 },
    { longitude: 181 },
    { category_id: "" },
    { description: "short" },
    { title: "   " },
  ])
    assert.equal(
      reportSchema.safeParse({ ...valid, ...change }).success,
      false,
    );
});
test("residents cannot smuggle privileged fields through the shared schema", () => {
  const output = reportSchema.parse({
    ...valid,
    status: "verified",
    resident_id: "someone-else",
    is_demo: true,
  });
  assert.equal("status" in output, false);
  assert.equal("resident_id" in output, false);
  assert.equal("is_demo" in output, false);
});
test("workflow combines barangay review with assessment and optional office routing", () => {
  assert.deepEqual(transitions.submitted, [
    "verified",
    "assigned",
    "rejected",
    "duplicate",
  ]);
  assert.equal(transitions.submitted.includes("under_review"), false);
  assert.deepEqual(transitions.under_review, ["verified", "assigned", "rejected", "duplicate"]);
  assert.equal(transitions.under_review.includes("resolved"), false);
  assert.deepEqual(transitions.verified, ["assigned", "scheduled", "duplicate"]);
  assert.deepEqual(transitions.assigned, ["scheduled", "duplicate"]);
  assert.deepEqual(transitions.scheduled, ["in_progress", "resolved", "duplicate"]);
  assert.equal(transitions.verified.includes("in_progress"), false);
  assert.equal(transitions.assigned.includes("in_progress"), false);
});
test("exceptional states require human review before reopening", () => {
  for (const state of ["resolved", "rejected", "duplicate"] as const)
    assert.deepEqual(transitions[state], ["under_review"]);
  for (const next of Object.values(transitions).flat())
    assert.ok(statuses.includes(next));
});
test("report lifecycle labels use clear resident-facing status wording", () => {
  assert.equal(reportStatusLabel("in_progress"), "Ongoing");
  assert.equal(reportStatusLabel("scheduled"), "Scheduled");
  assert.equal(reportStatusLabel("resolved"), "Resolved");
  assert.match(reportStatusDescription("scheduled"), /Philippine date and time/);
  assert.match(reportStatusDescription("in_progress"), /Work has started/);
});
test("map cells aggregate nearby reports into documented count bands", () => {
  const cells = aggregateReportCells([
    { latitude: 8.2281, longitude: 124.2451 },
    { latitude: 8.2282, longitude: 124.2452 },
    { latitude: 8.2284, longitude: 124.2453 },
    { latitude: 8.232, longitude: 124.25 },
  ]);
  assert.equal(cells.length, 2);
  assert.equal(cells.find((cell) => cell.count === 3)?.color, "#41ae76");
  assert.deepEqual([1, 2, 3, 4, 7, 8].map(reportCellColor), ["#4e9ed0", "#41ae76", "#41ae76", "#f5b840", "#f5b840", "#d64732"]);
});
test("density sample reflects 2, 8 and 20 real points with no heat for empty areas", () => {
  const area = (latitude: number, count: number) => Array.from({ length: count }, (_, i) => ({ latitude: latitude + i * 0.00001, longitude: 124.245 }));
  const cells = aggregateReportCells([...area(8.2, 2), ...area(8.22, 8), ...area(8.24, 20)]);
  assert.deepEqual(cells.map((cell) => cell.count).sort((a, b) => a - b), [2, 8, 20]);
  assert.ok(cells.find((cell) => cell.count === 8)!.count > cells.find((cell) => cell.count === 2)!.count);
  assert.ok(cells.find((cell) => cell.count === 20)!.count > cells.find((cell) => cell.count === 8)!.count);
  assert.equal(cells.some((cell) => cell.center.latitude > 8.25), false);
});
test("map clusters preserve every valid report and compute actual cluster counts", () => {
  const points = [
    { id: "a", latitude: 8.2281, longitude: 124.2451 },
    { id: "b", latitude: 8.2282, longitude: 124.2452 },
    { id: "c", latitude: 8.24, longitude: 124.26 },
    { id: "bad", latitude: 95, longitude: 124 },
  ];
  const clusters = clusterMapPoints(points, 250);
  assert.deepEqual(clusters.map((cluster) => cluster.points.map(({ id }) => id)), [["a", "b"], ["c"]]);
  assert.equal(clusters.reduce((total, cluster) => total + cluster.points.length, 0), 3);
});
