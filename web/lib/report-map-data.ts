import polygonClipping, { type Polygon } from "polygon-clipping";
import { aggregateReportCells, type ReportMapPoint } from "../../shared";
import { pointInPolygon, type MapPolygon } from "./map-geometry";

/** Keep border reports in the heatmap, clipping cell shapes to the selected area. */
export function reportHeatCells(points: ReportMapPoint[], boundary?: MapPolygon | null) {
  const edges = boundary?.coordinates.flatMap((ring) => ring.map((start, index) => {
    const end = ring[(index + 1) % ring.length];
    return [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(start[0], end[0]), Math.max(start[1], end[1])];
  }));
  return aggregateReportCells(points).map((cell) => {
    const ring = cell.bounds.map(({ longitude, latitude }) => [longitude, latitude] as [number, number]);
    ring.push(ring[0]);
    const [[west, south], , [east, north]] = ring;
    const touchesBoundary = edges?.some(([w, s, e, n]) => w <= east && e >= west && s <= north && n >= south);
    // Interior cells need no polygon operation; edge boxes also catch concave notches and holes.
    const coordinates = !boundary ? [[ring]] : touchesBoundary
      ? polygonClipping.intersection([ring], boundary.coordinates as Polygon)
      : pointInPolygon([cell.center.longitude, cell.center.latitude], boundary) ? [[ring]] : [];
    return { ...cell, geometry: { type: "MultiPolygon" as const, coordinates } };
  }).filter((cell) => cell.geometry.coordinates.length > 0)
    .sort((a, b) => b.count - a.count);
}
