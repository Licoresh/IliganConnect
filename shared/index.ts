import { z } from "zod";
import { parseDecimal, textInputError } from "./validation";
export { parseDecimal, textInputError, emailInputError, passwordInputError, imageHeaderError, UUID_PATTERN, SHORT_REASON_LIMIT, characterLimitHint } from "./validation";
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
function textSchema(min: number, max: number) {
  return z.string().superRefine((value, ctx) => {
    const message = textInputError(value, { min, max, required: min > 0 });
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }).transform((value) => value.trim());
}
export const SEVERITY_OPTIONS = [
  { value: 1, label: "Minor", description: "Small, localized impact." },
  { value: 2, label: "Low", description: "Limited damage or service disruption." },
  { value: 3, label: "Moderate", description: "Meaningful damage or disruption affecting several users." },
  { value: 4, label: "Major", description: "Substantial damage or disruption affecting an area." },
  { value: 5, label: "Severe", description: "Extensive impact or a substantial safety concern." },
] as const;
export const URGENCY_OPTIONS = [
  { value: 1, label: "Routine", description: "Can enter the normal review queue." },
  { value: 2, label: "Soon", description: "Needs follow-up beyond routine monitoring." },
  { value: 3, label: "Prompt", description: "Needs prompt staff follow-up to limit worsening conditions." },
  { value: 4, label: "Urgent", description: "Needs expedited staff attention and coordination." },
  { value: 5, label: "Immediate review", description: "Needs immediate staff review and coordination." },
] as const;
export const reportAssessmentSchema = z.object({
  severity: z.number().int().min(1).max(5),
  urgency: z.number().int().min(1).max(5),
  note: textSchema(5, 4000),
});
export const reportSchema = z.object({
  category_id: z.string().uuid("Choose a report type."),
  barangay_id: z.string().uuid("Choose a barangay."),
  title: textSchema(8, 160),
  description: textSchema(20, 4000),
  latitude: z.preprocess((value) => value == null ? null : parseDecimal(value), z.number({ invalid_type_error: "Enter a decimal latitude from −90 to 90." }).finite().min(-90).max(90).nullable()),
  longitude: z.preprocess((value) => value == null ? null : parseDecimal(value), z.number({ invalid_type_error: "Enter a decimal longitude from −180 to 180." }).finite().min(-180).max(180).nullable()),
  landmark: textSchema(0, 240).default(""),
  purok: textSchema(0, 80).nullable().optional(),
  zone: textSchema(0, 80).nullable().optional(),
  location_address: textSchema(0, 500).nullable().optional(),
  location_source: z.enum(["manual", "gps", "pin", "coordinates"]).nullable().optional(),
  location_accuracy: z.number().finite().min(0).max(100000).nullable().optional(),
  problem_type: z.string().nullable().optional(),
  problem_other: textSchema(0, 240).nullable().optional(),
}).superRefine((report, ctx) => {
  const hasCoordinates = hasReportCoordinates(report);
  if (!hasCoordinates) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["latitude"], message: "Place a pin on the map or use your current location before continuing." });
  }
  if (report.location_accuracy != null && report.location_source !== "gps") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["location_accuracy"], message: "Location accuracy is only recorded for GPS locations." });
  }
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
  urgency?: number | null;
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
export function hasReportCoordinates<T extends { latitude: number | null | undefined; longitude: number | null | undefined }>(point: T): point is T & ReportMapPoint {
  return typeof point.latitude === "number" && typeof point.longitude === "number"
    && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}
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
  const lat = parseDecimal(latitude), lon = parseDecimal(longitude);
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
