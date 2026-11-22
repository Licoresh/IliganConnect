import { reportHeatCellsWithinBoundary, type ReportMapPoint } from "../../shared";
import type { MapPolygon } from "./map-geometry";

/** Keep border reports in the heatmap, clipping cell shapes to the selected area. */
export function reportHeatCells(points: ReportMapPoint[], boundary?: MapPolygon | null) {
  return reportHeatCellsWithinBoundary(points, boundary);
}
