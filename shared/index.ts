import polygonClipping, { type Polygon } from "polygon-clipping";
import { z } from "zod";
import { parseDecimal, textInputError } from "./validation";
export { BARANGAY_GIS_CATEGORY_ZOOM, BARANGAY_TOTAL_ZOOM, INDIVIDUAL_REPORT_PIN_ZOOM, clusterReportsByCategory, clusterReportPinGroups, mapZoomFromLongitudeDelta, offsetMapCoordinate, separateNearbyMapPoints } from "./map-clusters";
export type { CategoryReportCluster, ClusterableReportPoint, PositionedMapPoint, ReportPinGroup } from "./map-clusters";
export { parseDecimal, textInputError, residentNamePartsError, residentDisplayName, normalizePersonName, personNameInputError, residentAgeError, emailInputError, mobileInputError, normalizePhilippineMobile, addressInputError, numericInputError, dateInputError, passwordInputError, imageHeaderError, UUID_PATTERN, SHORT_REASON_LIMIT, MIN_PASSWORD_LENGTH, MIN_REGISTRATION_PASSWORD_LENGTH, EMAIL_OTP_LENGTH, EMAIL_OTP_EXPIRY_SECONDS, EMAIL_RESEND_INTERVAL_SECONDS, characterLimitHint } from "./validation";
export { ILIGAN_CITY_MAX_MAP_ZOOM, ILIGAN_CITY_MIN_MAP_ZOOM, ILIGAN_MAP_BOUNDS } from "./iligan";
export { formatMeetingTimeRange, googleCalendarDraftUrl, meetingDateInput, meetingDateTimeInput, meetingTimeInput, normalizeGoogleMeetUrl, parseManilaDateTimeInput } from "./meeting-links";
export { resolveGoogleLocation } from "./google-geocoding";
export type { GoogleGeocodeResult, BarangayMatch, CityCheck } from "./google-geocoding";
export const statuses = [
  "submitted",
  "under_review",
  "verified",
  "assigned",
  "scheduled",
  "in_progress",
  "resolved",
  "rejected",
  "duplicate",
] as const;
export type Status = (typeof statuses)[number];
export const transitions: Record<Status, readonly Status[]> = {
  submitted: ["verified", "assigned", "rejected", "duplicate"],
  under_review: ["verified", "assigned", "rejected", "duplicate"],
  verified: ["assigned", "scheduled", "duplicate"],
  assigned: ["scheduled", "duplicate"],
  scheduled: ["in_progress", "resolved", "duplicate"],
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
  resident_id: string | null;
  submission_source?: "resident" | "walk_in";
  created_by?: string;
  status: Status;
  created_at: string;
  verified_at: string | null;
  scheduled_at?: string | null;
  organization_id: string | null;
  severity: number | null;
  resident_barangay_id?: string | null;
  assigned_to?: string | null;
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
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  age?: number | null;
  role: "resident" | "barangay" | "office" | "admin";
  barangay_id: string | null;
  phone?: string | null;
  notifications_enabled: boolean;
  avatar_path?: string | null;
}
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase());

export function reportStatusLabel(status: string) {
  return ({
    submitted: "Received",
    under_review: "Under review",
    verified: "Verified",
    assigned: "Forwarded to office",
    scheduled: "Scheduled",
    in_progress: "Ongoing",
    resolved: "Resolved",
    rejected: "Rejected",
    duplicate: "Linked to main report",
  } as Record<string, string>)[status] || label(status);
}

export function reportStatusDescription(status: string) {
  return ({
    submitted: "Your report has been received. The barangay responsible for its location will check the details and pin.",
    under_review: "Barangay staff are checking the details and location. If verified, they will schedule local work or forward it to the responsible office.",
    verified: "Your report is verified. The barangay will schedule the work or send it to an office that can handle it. You do not need to take another step.",
    assigned: "The report was forwarded to the responsible office. That team will share its schedule or next update here.",
    scheduled: "Work is scheduled for the Philippine date and time shown. On that day, the handling team can begin or reschedule if needed. Schedule and status changes will appear here.",
    in_progress: "Work has started. The handling team will post progress and mark the report resolved when the work is complete.",
    resolved: "The handling team recorded that the issue has been addressed. Read the resolution below.",
    rejected: "The report was not accepted. Read the official explanation in the timeline.",
    duplicate: "Progress follows the linked main report. Your original submission is retained.",
  } as Record<string, string>)[status] || "";
}

export function reportScheduleLabel(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}

export function scheduledManilaDayReached(value: string | null | undefined, now = new Date()) {
  if (!value) return false;
  const scheduled = new Date(value);
  if (!Number.isFinite(scheduled.getTime()) || !Number.isFinite(now.getTime())) return false;
  const dayKey = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  return dayKey(scheduled) <= dayKey(now);
}

export function reportScheduleDayReached(value: string | null | undefined, now = new Date()) {
  return scheduledManilaDayReached(value, now);
}

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

export type ReportHeatBoundary = { coordinates: number[][][] };
type ReportHeatCell = {
  count: number;
  color: string;
  center: ReportMapPoint;
  bounds: ReportMapPoint[];
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
};
function heatPointInBoundary(point: [number, number], boundary: ReportHeatBoundary) {
  const inRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      const cross = (point[1] - y1) * (x2 - x1) - (point[0] - x1) * (y2 - y1);
      if (Math.abs(cross) <= 1e-10 && point[0] >= Math.min(x1, x2) - 1e-10 && point[0] <= Math.max(x1, x2) + 1e-10 && point[1] >= Math.min(y1, y2) - 1e-10 && point[1] <= Math.max(y1, y2) + 1e-10) return true;
      if ((y2 > point[1]) !== (y1 > point[1]) && point[0] < ((x1 - x2) * (point[1] - y2)) / (y1 - y2) + x2) inside = !inside;
    }
    return inside;
  };
  const [outer, ...holes] = boundary.coordinates;
  return !!outer && inRing(outer) && !holes.some(inRing);
}
function nearestInteriorHeatPoint(point: ReportMapPoint, boundary: ReportHeatBoundary) {
  const latMeters = 111_320;
  const lonMeters = latMeters * Math.cos(point.latitude * Math.PI / 180);
  const x = point.longitude * lonMeters, y = point.latitude * latMeters;
  let nearestDistance = Infinity;
  const candidates: { x: number; y: number; dx: number; dy: number; interiorSide: number }[] = [];
  boundary.coordinates.forEach((ring, ringIndex) => {
    let area = 0;
    for (let index = 0; index < ring.length; index++) {
      const [lonA, latA] = ring[index], [lonB, latB] = ring[(index + 1) % ring.length];
      area += lonA * latB - lonB * latA;
    }
    const interiorSide = (area >= 0 ? 1 : -1) * (ringIndex === 0 ? 1 : -1);
    for (let index = 0; index < ring.length; index++) {
      const [lonA, latA] = ring[index], [lonB, latB] = ring[(index + 1) % ring.length];
      const startX = lonA * lonMeters, startY = latA * latMeters;
      const dx = (lonB - lonA) * lonMeters, dy = (latB - latA) * latMeters;
      const lengthSquared = dx * dx + dy * dy;
      if (!lengthSquared) continue;
      const ratio = Math.max(0, Math.min(1, ((x - startX) * dx + (y - startY) * dy) / lengthSquared));
      const edgeX = startX + ratio * dx, edgeY = startY + ratio * dy;
      const distance = Math.hypot(x - edgeX, y - edgeY);
      if (distance > nearestDistance + 1e-6) continue;
      if (distance < nearestDistance - 1e-6) {
        nearestDistance = distance;
        candidates.length = 0;
      }
      candidates.push({ x: edgeX, y: edgeY, dx, dy, interiorSide });
    }
  });
  for (const edge of candidates) {
    const length = Math.hypot(edge.dx, edge.dy);
    for (const offset of [1, 3, 10, 30]) {
      const longitude = (edge.x - edge.dy / length * edge.interiorSide * offset) / lonMeters;
      const latitude = (edge.y + edge.dx / length * edge.interiorSide * offset) / latMeters;
      if (heatPointInBoundary([longitude, latitude], boundary)) return { point: { longitude, latitude }, distance: nearestDistance };
    }
  }
  const edge = candidates[0];
  return edge ? { point: { longitude: edge.x / lonMeters, latitude: edge.y / latMeters }, distance: nearestDistance } : null;
}
export function reportHeatCellsWithinBoundary<T extends ReportMapPoint>(points: T[], boundary?: ReportHeatBoundary | null): ReportHeatCell[] {
  const edges = boundary?.coordinates.flatMap((ring) => ring.map((start, index) => {
    const end = ring[(index + 1) % ring.length];
    return [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(start[0], end[0]), Math.max(start[1], end[1])];
  }));
  return aggregateReportCells(points).map((cell) => {
    const ring = cell.bounds.map(({ longitude, latitude }) => [longitude, latitude] as [number, number]);
    ring.push(ring[0]);
    const [[west, south], , [east, north]] = ring;
    const touchesBoundary = edges?.some(([w, s, e, n]) => w <= east && e >= west && s <= north && n >= south);
    const coordinates = !boundary ? [[ring]] : touchesBoundary
      ? polygonClipping.intersection([ring], boundary.coordinates as Polygon) as number[][][][]
      : heatPointInBoundary([cell.center.longitude, cell.center.latitude], boundary) ? [[ring]] : [];
    return { ...cell, geometry: { type: "MultiPolygon" as const, coordinates } };
  }).filter((cell) => cell.geometry.coordinates.length > 0).sort((a, b) => b.count - a.count);
}
export function reportHeatCellsByBarangay<T extends ReportMapPoint>(points: T[], boundaries: ReportHeatBoundary[]): ReportHeatCell[] {
  const regions = boundaries.map((boundary) => {
    const ring = boundary.coordinates[0] ?? [];
    return {
      boundary,
      west: Math.min(...ring.map(([longitude]) => longitude)),
      east: Math.max(...ring.map(([longitude]) => longitude)),
      south: Math.min(...ring.map(([, latitude]) => latitude)),
      north: Math.max(...ring.map(([, latitude]) => latitude)),
    };
  });
  const grouped = regions.map(() => [] as T[]);
  for (const point of points) {
    const index = regions.findIndex(({ boundary, west, east, south, north }) => point.longitude >= west && point.longitude <= east && point.latitude >= south && point.latitude <= north && heatPointInBoundary([point.longitude, point.latitude], boundary));
    if (index >= 0) {
      grouped[index].push(point);
      continue;
    }
    let nearest = -1, nearestPoint: ReturnType<typeof nearestInteriorHeatPoint> = null;
    for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
      const candidate = nearestInteriorHeatPoint(point, regions[regionIndex].boundary);
      if (candidate && (!nearestPoint || candidate.distance < nearestPoint.distance)) {
        nearest = regionIndex;
        nearestPoint = candidate;
      }
    }
    if (nearest >= 0 && nearestPoint) grouped[nearest].push({ ...point, ...nearestPoint.point });
  }
  return regions.flatMap(({ boundary }, index) => reportHeatCellsWithinBoundary(grouped[index], boundary));
}
