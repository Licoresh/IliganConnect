import { test } from "node:test";
import assert from "node:assert/strict";
import { reportHeatCells } from "../web/lib/report-map-data";
import { pointInPolygon } from "../web/lib/map-geometry";
import { iliganBarangayBoundaries } from "../app/lib/barangay-map";

test("border heat keeps the Poblacion report and clips its cell to the boundary", () => {
  const boundary = iliganBarangayBoundaries.find((item) => item.properties.adm4_en === "Poblacion")!.geometry;
  const point = { longitude: 124.23249555987003, latitude: 8.232154039750023 };
  assert.ok(pointInPolygon([point.longitude, point.latitude], boundary));
  const cells = reportHeatCells([point, point], boundary);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].count, 2);
  assert.ok(cells[0].geometry.coordinates.flat(2).every((coordinate) => pointInPolygon(coordinate as [number, number], boundary)));
});

test("heat clipping handles holes and disconnected intersections", () => {
  const point = { longitude: 124.24, latitude: 8.23 };
  const [cell] = reportHeatCells([point]);
  const [[ring]] = cell.geometry.coordinates;
  const [west, south] = ring[0], [east, north] = ring[2];
  const x = (west + east) / 2, y = (south + north) / 2;
  const rectangle = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
  const hole = rectangle(x - .0001, y - .0001, x + .0001, y + .0001);
  const withHole = reportHeatCells([point], { coordinates: [rectangle(west - 1, south - 1, east + 1, north + 1), hole] });
  assert.equal(withHole[0].geometry.coordinates[0].length, 2);
  const fork = [[west, south - 1], [west + .0001, south - 1], [west + .0001, north + .0001], [east - .0001, north + .0001], [east - .0001, south - 1], [east, south - 1], [east, north + 1], [west, north + 1], [west, south - 1]];
  const disconnected = reportHeatCells([point], { coordinates: [fork] });
  assert.equal(disconnected[0].geometry.coordinates.length, 2);
  assert.equal(disconnected[0].count, 1);
});

test("empty and fully outside heat cells draw no polygons", () => {
  assert.deepEqual(reportHeatCells([]), []);
  assert.deepEqual(reportHeatCells([{ longitude: 124, latitude: 8 }], { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }), []);
});
