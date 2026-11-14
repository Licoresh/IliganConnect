import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterReportsByCategory, offsetMapCoordinate, separateNearbyMapPoints } from "../shared/map-clusters";

test("map counts collapse by barangay at low zoom and individual pins at street zoom", () => {
  const points = [{ latitude: 8.23, longitude: 124.24, categoryName: "Roads", color: "#2457a6" }];
  assert.deepEqual(clusterReportsByCategory(points, 10.5), []);
  assert.deepEqual(clusterReportsByCategory(points, 14), []);
});

test("mid-zoom markers keep category counts and colors separate", () => {
  const clusters = clusterReportsByCategory([
    { id: "road-1", latitude: 8.23, longitude: 124.24, categoryName: "Roads", color: "#2457a6" },
    { id: "road-2", latitude: 8.23, longitude: 124.24, categoryName: "Roads", color: "#2457a6" },
    { id: "drain-1", latitude: 8.23, longitude: 124.24, categoryName: "Drainage", color: "#08756b" },
  ], 12);
  assert.deepEqual(clusters.map(({ categoryName, color, count }) => ({ categoryName, color, count })), [
    { categoryName: "Drainage", color: "#08756b", count: 1 },
    { categoryName: "Roads", color: "#2457a6", count: 2 },
  ]);
});

test("invalid coordinates do not create count markers", () => {
  assert.deepEqual(clusterReportsByCategory([
    { latitude: Number.NaN, longitude: 124.24, categoryName: "Roads" },
    { latitude: 8.23, longitude: 181, categoryName: "Roads" },
  ], 12), []);
});

test("category badge offsets stay fixed in screen space as map zoom changes", () => {
  const projectX = (longitude: number, zoom: number) => (longitude + 180) / 360 * 256 * 2 ** zoom;
  for (const zoom of [12.5, 14]) {
    const offset = offsetMapCoordinate(124.24, 8.23, 58, 0, zoom);
    assert.ok(Math.abs(projectX(offset.longitude, zoom) - projectX(124.24, zoom) - 58) < 0.001);
    assert.ok(Math.abs(offset.latitude - 8.23) < 0.001);
  }
});

test("nearby barangay totals get distinct stable badge positions", () => {
  const points = ["Palao", "Poblacion", "Saray", "Tambacan", "Tibanga", "Tubod"]
    .map((id) => ({ id, longitude: 124.24, latitude: 8.23 }));
  const first = separateNearbyMapPoints(points, 10, 48, 28);
  const second = separateNearbyMapPoints(points, 10, 48, 28);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(({ longitude, latitude }) => `${longitude.toFixed(8)},${latitude.toFixed(8)}`)).size, points.length);
  assert.ok(first.some(({ offsetX, offsetY }) => Math.hypot(offsetX, offsetY) > 10));
});
