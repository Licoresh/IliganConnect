const MANILA_DATETIME_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function meetingDateTimeInput(value?: string | Date | null) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return "";
  const parts = MANILA_DATETIME_FORMAT.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function meetingDateInput(value?: string | Date | null) {
  return meetingDateTimeInput(value).slice(0, 10);
}

export function meetingTimeInput(value?: string | Date | null) {
  return meetingDateTimeInput(value).slice(11, 16);
}

export function parseManilaDateTimeInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+08:00`);
  return Number.isFinite(date.getTime()) && meetingDateTimeInput(date) === value ? date : null;
}

export function formatMeetingTimeRange(startsAt: string | Date, endsAt: string | Date) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return "Schedule unavailable";
  const date = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" });
  const time = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
  const startDate = meetingDateInput(start);
  const endDate = meetingDateInput(end);
  return startDate === endDate
    ? `${date.format(start)} · ${time.format(start)}–${time.format(end)} Philippine time`
    : `${date.format(start)} ${time.format(start)} – ${date.format(end)} ${time.format(end)} Philippine time`;
}

export function normalizeGoogleMeetUrl(value: string) {
  const input = value.trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "meet.google.com" || url.port || url.username || url.password || url.hash) return null;
    if (!/^(?:\/[a-z0-9_-]+)*\/[a-z0-9-]+\/?$/i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function googleCalendarDraftUrl({
  title,
  details,
  venue,
  startsAt,
  endsAt,
  meetUrl,
}: {
  title: string;
  details: string;
  venue: string;
  startsAt: string | Date;
  endsAt: string | Date;
  meetUrl?: string | null;
}) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  const calendarTime = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const description = [details.trim(), meetUrl ? `Google Meet: ${meetUrl}` : "Add Google Meet in Calendar, save the event, then paste its link into Iligan Connect."].filter(Boolean).join("\n\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${calendarTime(start)}/${calendarTime(end)}`,
    details: description,
  });
  if (venue.trim()) params.set("location", venue.trim());
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
