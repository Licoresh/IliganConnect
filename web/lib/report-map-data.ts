import { reportHeatCellsByBarangay, reportHeatCellsWithinBoundary, type ReportMapPoint } from "../../shared";
import type { MapPolygon } from "./map-geometry";

/** Keep border reports in the heatmap, clipping cell shapes to the selected area. */
export function reportHeatCells(points: ReportMapPoint[], boundary?: MapPolygon | null) {
  return reportHeatCellsWithinBoundary(points, boundary);
}

/** Citywide views: each report is counted in its own barangay and cells are clipped to that barangay,
    so no heat cell crosses into a neighbouring barangay (same rule as the resident map). */
export function reportHeatCellsPerBarangay(points: ReportMapPoint[], boundaries: MapPolygon[]) {
  return reportHeatCellsByBarangay(points, boundaries);
}
