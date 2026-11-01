export type WorkspaceLocation = {
  section: string;
  scope: string;
  recordId: string;
  queue: string;
};

export function shouldResetWorkspace(previousUserId: string | null, nextUserId: string | null) {
  return previousUserId !== null && previousUserId !== nextUserId;
}

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const queues = new Set(["all", "review", "route", "active", "resolved"]);

export function readWorkspaceLocation(url: URL, sections: readonly string[]): WorkspaceLocation {
  const params = url.searchParams;
  const requestedSection = params.get("section") || "Overview";
  const section = requestedSection === "Barangay prioritization"
    ? "Geographic analytics"
    : requestedSection === "Organizations"
      ? "Administration"
      : requestedSection === "Profile"
        ? "Settings"
        : requestedSection;
  const scope = params.get("scope") || "";
  const recordId = params.get("record") || "";
  const queue = params.get("queue") || "all";
  return {
    section: sections.includes(section) ? section : "Overview",
    scope: uuid.test(scope) ? scope : "",
    recordId: uuid.test(recordId) ? recordId : "",
    queue: queues.has(queue) ? queue : "all",
  };
}

export function workspaceLocationUrl(current: URL, location: WorkspaceLocation) {
  const url = new URL(current);
  for (const key of ["section", "scope", "record", "queue"]) url.searchParams.delete(key);
  if (location.section !== "Overview") url.searchParams.set("section", location.section);
  if (uuid.test(location.scope)) url.searchParams.set("scope", location.scope);
  if (uuid.test(location.recordId)) url.searchParams.set("record", location.recordId);
  if (queues.has(location.queue) && location.queue !== "all") url.searchParams.set("queue", location.queue);
  return `${url.pathname}${url.search}${url.hash}`;
}
