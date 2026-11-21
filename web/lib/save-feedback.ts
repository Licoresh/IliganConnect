export type SaveFeedback = { kind: "success" | "error"; message: string };
export const SAVE_FEEDBACK_EVENT = "iligan:save-feedback";

const writeRpcNames = new Set([
  "admin_update_resident", "admin_update_stakeholder_account", "change_report",
  "invite_meeting_barangay", "invite_meeting_office", "join_meeting_request",
  "leave_meeting_request", "record_report_assessment", "record_report_update",
  "remove_meeting_office_invitation", "respond_meeting_barangay_invitation",
  "respond_meeting_office_invitation", "submit_meeting_request", "submit_report",
  "submit_walk_in_report_with_contacts", "update_walk_in_report_location",
]);

function isSaveRequest(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method || (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  const pathname = new URL(url, window.location.origin).pathname;
  if (/\/rest\/v1\/rpc\/([^/]+)$/.test(pathname)) return writeRpcNames.has(pathname.split("/").at(-1) || "");
  return /\/rest\/v1\/[^/]+/.test(pathname) ||
    /\/storage\/v1\/object\/(?!sign\/)/.test(pathname) ||
    pathname.endsWith("/auth/v1/user");
}

export function notifySave(feedback: SaveFeedback) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SAVE_FEEDBACK_EVENT, { detail: feedback }));
}

export async function trackedSaveFetch(input: RequestInfo | URL, init?: RequestInit) {
  const tracked = typeof window !== "undefined" && isSaveRequest(input, init);
  try {
    const response = await fetch(input, init);
    if (tracked) notifySave(response.ok
      ? { kind: "success", message: "Saved successfully." }
      : { kind: "error", message: "Could not save. Check your connection and try again." });
    return response;
  } catch (error) {
    if (tracked) notifySave({ kind: "error", message: "Could not save. Check your connection and try again." });
    throw error;
  }
}
