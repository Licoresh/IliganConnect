import { z } from "zod";
export { ILIGAN_MAP_BOUNDS } from "./iligan";
export { resolveGoogleLocation } from "./google-geocoding";
export type { GoogleGeocodeResult, BarangayMatch, CityCheck } from "./google-geocoding";
export const statuses = [
  "submitted",
  "under_review",
  "verified",
  "assigned",
  "in_progress",
  "resolved",
  "rejected",
  "duplicate",
] as const;
export type Status = (typeof statuses)[number];
export const transitions: Record<Status, readonly Status[]> = {
  submitted: ["under_review", "rejected", "duplicate"],
  under_review: ["verified", "rejected", "duplicate"],
  verified: ["assigned", "duplicate"],
  assigned: ["in_progress", "duplicate"],
  in_progress: ["resolved", "assigned"],
  resolved: ["under_review"],
  rejected: ["under_review"],
  duplicate: ["under_review"],
};
export const reportSchema = z.object({
  category_id: z.string().uuid("Choose a report type."),
  barangay_id: z.string().uuid("Choose a barangay."),
  title: z.string().trim().min(8, "Use at least 8 characters for the title.").max(160, "That title is too long. Please shorten it."),
  description: z.string().trim().min(20, "Use at least 20 characters for the description.").max(4000, "That description is too long. Please shorten it."),
  latitude: z.coerce.number().min(-90, "Enter a valid latitude.").max(90, "Latitude must be between -90 and 90."),
  longitude: z.coerce.number().min(-180, "Enter a valid longitude.").max(180, "Longitude must be between -180 and 180."),
  landmark: z.string().max(240).default(""),
  problem_type: z.string().nullable().optional(),
  problem_other: z.string().trim().max(240, "That answer is too long. Please shorten it.").nullable().optional(),
});
export function createReportSchema(categories: Lookup[]) {
  return reportSchema.superRefine((report, ctx) => {
    const options = categories.find((item) => item.id === report.category_id)?.problem_types ?? [];
    if (!options.some((option) => option.code === report.problem_type)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["problem_type"], message: "Choose the specific problem for this category." });
    }
    if (report.problem_type === "other" && !report.problem_other?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["problem_other"], message: "Please describe the other problem." });
    }
    if (report.problem_type !== "other" && report.problem_other) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["problem_other"], message: "Custom details are only used for Others." });
    }
  });
}
export type ReportInput = z.infer<typeof reportSchema>;
export interface Report extends ReportInput {
  id: string;
  resident_id: string;
  status: Status;
  created_at: string;
  verified_at: string | null;
  organization_id: string | null;
  severity: number | null;
  is_demo: boolean;
  public_summary: string | null;
}
export interface Lookup {
  id: string;
  name: string;
  problem_types?: { code: string; label: string; sort_order: number }[];
}
export interface Profile {
  id: string;
  display_name: string;
  role: "resident" | "barangay" | "office" | "admin";
  barangay_id: string | null;
  notifications_enabled: boolean;
  avatar_path?: string | null;
}
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase());

export function consultationPhase(row: { status: string; opens_at: string; closes_at: string }, now = Date.now()) {
  const opens = Date.parse(row.opens_at), closes = Date.parse(row.closes_at);
  if (row.status !== "open" || !Number.isFinite(opens) || !Number.isFinite(closes) || opens > closes || now > closes) return "closed";
  return now < opens ? "scheduled" : "open";
}

export type ReportMapPoint = { latitude: number; longitude: number };
export type MapCluster<T extends ReportMapPoint> = { points: T[]; latitude: number; longitude: number };
export function clusterMapPoints<T extends ReportMapPoint>(points: T[], cellMeters: number): MapCluster<T>[] {
  const size = Math.max(1, cellMeters), latMeters = 111_320, lonMeters = latMeters * Math.cos(8.23 * Math.PI / 180), cells = new Map<string, T[]>();
  for (const point of points) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) continue;
    const x = Math.floor(point.longitude * lonMeters / size), y = Math.floor(point.latitude * latMeters / size), key = `${x}:${y}`;
    const cell = cells.get(key);
    if (cell) cell.push(point); else cells.set(key, [point]);
  }
  return [...cells.values()].map((group) => ({
    points: group,
    latitude: group.reduce((sum, point) => sum + point.latitude, 0) / group.length,
    longitude: group.reduce((sum, point) => sum + point.longitude, 0) / group.length,
  }));
}
export function distanceMeters(a: ReportMapPoint, b: ReportMapPoint) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function parseReportCoordinates(latitude: string, longitude: string): ReportMapPoint | null {
  const lat = Number(latitude), lon = Number(longitude);
  return latitude.trim() && longitude.trim() && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { latitude: lat, longitude: lon } : null;
}
export const REPORT_CELL_METERS = 250;
export const reportCellColor = (count: number) =>
  count >= 8 ? "#d64732" : count >= 4 ? "#f5b840" : count >= 2 ? "#41ae76" : "#4e9ed0";
export const aggregateReportCells = <T extends ReportMapPoint>(points: T[]) => {
  const latMeters = 111_320;
  const lonMeters = latMeters * Math.cos(8.23 * Math.PI / 180);
  const cells = new Map<string, { x: number; y: number; count: number }>();
  for (const point of points) {
    const y = Math.floor(point.latitude * latMeters / REPORT_CELL_METERS);
    const x = Math.floor(point.longitude * lonMeters / REPORT_CELL_METERS);
    const key = `${x}:${y}`;
    const cell = cells.get(key);
    if (cell) cell.count++;
    else cells.set(key, { x, y, count: 1 });
  }
  return [...cells.values()].map(({ x, y, count }) => {
    const west = x * REPORT_CELL_METERS / lonMeters;
    const south = y * REPORT_CELL_METERS / latMeters;
    const east = (x + 1) * REPORT_CELL_METERS / lonMeters;
    const north = (y + 1) * REPORT_CELL_METERS / latMeters;
    return {
      count,
      color: reportCellColor(count),
      center: { latitude: (south + north) / 2, longitude: (west + east) / 2 },
      bounds: [
        { latitude: south, longitude: west },
        { latitude: south, longitude: east },
        { latitude: north, longitude: east },
        { latitude: north, longitude: west },
      ],
    };
  });
};
