export const emailEvents = [
  "report_received",
  "report_triage",
  "report_update",
  "meeting_request",
  "meeting_invitation",
  "meeting_update",
  "meeting_declined",
  "announcement",
  "consultation",
] as const;

export type EmailEvent = (typeof emailEvents)[number];

export const brevoTemplateIds: Record<EmailEvent, number> = {
  report_received: 1,
  report_update: 2,
  report_triage: 3,
  meeting_request: 4,
  meeting_invitation: 5,
  meeting_update: 6,
  meeting_declined: 7,
  announcement: 8,
  consultation: 9,
};

export function notificationEmailEvent(input: {
  title: string;
  reportId?: string | null;
  meetingRequestId?: string | null;
  announcementId?: string | null;
  consultationId?: string | null;
}): EmailEvent | null {
  const title = input.title.toLocaleLowerCase();
  if (input.reportId) {
    return /forwarded|assigned|new report/.test(title) ? "report_triage" : "report_update";
  }
  if (input.meetingRequestId) {
    if (title.includes("all invited offices declined")) return "meeting_declined";
    if (title.includes("you are invited to a community meeting")) return "meeting_invitation";
    if (title.includes("resident requested a meeting")) return "meeting_request";
    return "meeting_update";
  }
  if (input.announcementId) return "announcement";
  if (input.consultationId) return "consultation";
  return null;
}

export function escapeEmailText(value: unknown, maxLength = 2000): string {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function firstName(displayName: string | null | undefined): string {
  return escapeEmailText(displayName?.trim().split(/\s+/)[0] || "there", 80);
}
