"use client";
import { useEffect, useRef, useState } from "react";
import { validateImageFile } from "../lib/images";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  FileText,
  Flag,
  LayoutGrid,
  Link2,
  List,
  MapPin,
  Megaphone,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  Users,
  ImagePlus,
  X,
} from "lucide-react";
import { db, result } from "../lib/client";
import { formatMeetingTimeRange, googleCalendarDraftUrl, label, meetingDateInput, meetingTimeInput, meetingDateTimeInput, normalizeGoogleMeetUrl, parseManilaDateTimeInput, Profile, UUID_PATTERN, SHORT_REASON_LIMIT, characterLimitHint } from "@community/shared";
import type { References } from "./workspace";
import { useAccess } from "./access-context";
import { canCreate } from "../lib/access";
import { Dialog } from "./dialog";
import { useDebouncedValue } from "../lib/use-debounced-value";
type Row = {
  id: string;
  title: string;
  body: string;
  status: string;
  coordination_status?: "open" | "unavailable";
  participation_mode?: "open" | "closed";
  barangay_id: string | null;
  organization_id?: string | null;
  outcome?: string;
  decision_reason?: string;
  opens_at?: string;
  closes_at?: string;
  publish_at?: string;
  kind?: string;
  report_id?: string;
  attachment_path?: string;
  created_by?: string;
  created_at: string;
  can_manage?: boolean;
};
type RelatedReport = {
  id: string;
  title: string;
  status: string;
  barangay_id: string;
  category_id: string;
  created_at: string;
  description?: string | null;
  public_summary?: string | null;
  location_address?: string | null;
  purok?: string | null;
  zone?: string | null;
};
type Comment = {
  id: string;
  body: string;
  parent_id: string | null;
  hidden: boolean;
  official: boolean;
  created_at: string;
};
const localDate = (value?: string) => {
  return meetingDateTimeInput(value);
};
type MeetingInputErrorMode = "save" | "calendar";
function getMeetingInputError(form: HTMLFormElement, mode: MeetingInputErrorMode) {
  const fields = new FormData(form);
  const date = String(fields.get("date") || "");
  const startsAt = parseManilaDateTimeInput(`${date}T${String(fields.get("starts_at") || "")}`);
  const endsAt = parseManilaDateTimeInput(`${date}T${String(fields.get("ends_at") || "")}`);
  const meetUrlInput = String(fields.get("meet_url") || "").trim();
  const meetUrl = normalizeGoogleMeetUrl(meetUrlInput);
  if (!startsAt || !endsAt) return "Enter a valid date and start and end times in Philippine time.";
  if (endsAt <= startsAt) return "End time must be later than start time on the selected date.";
  if (endsAt.getTime() - startsAt.getTime() > 12 * 60 * 60 * 1000) return "A meeting time window can be up to 12 hours.";
  if (mode === "calendar") return meetUrlInput && !meetUrl ? "Enter a valid Google Meet link, such as https://meet.google.com/abc-defg-hij." : "";
  const venueType = String(fields.get("venue_type") || "venue") === "online" ? "online" : "venue";
  const completed = fields.get("completed") === "on";
  if (venueType === "venue" && String(fields.get("venue") || "").trim().length < 3) return "Enter the physical meeting venue.";
  if (venueType === "online" && !meetUrl) return "Add a valid Google Meet link before saving an online meeting.";
  if (meetUrlInput && !meetUrl) return "Enter a valid Google Meet link, such as https://meet.google.com/abc-defg-hij.";
  if (!completed && startsAt.getTime() < Date.now() - 60_000) return "Choose a future time, or mark the meeting completed if it has already taken place.";
  if (completed && endsAt.getTime() > Date.now()) return "A meeting cannot be marked completed before its scheduled end time.";
  return "";
}
function useSave() {
  const qc = useQueryClient();
  const [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false);
  return {
    message,
    failed,
    busy,
    run: async (
      p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
      onError?: (message: string) => boolean | void,
    ) => {
      setBusy(true);
      setMessage("");
      setFailed(false);
      try {
        await result(p);
        await qc.invalidateQueries();
        setMessage("Saved.");
        return true;
      } catch (e) {
        const error = (e as Error).message;
        if (!onError?.(error)) setMessage(error);
        setFailed(true);
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
export function Community({
  section,
  refs,
  initialBarangay = "",
  initialRecordId = "",
  profile,
}: {
  section: string;
  refs: References;
  initialBarangay?: string;
  initialRecordId?: string;
  profile: Profile;
}) {
  const access = useAccess();
  const queryClient = useQueryClient();
  const table =
    section === "Consultations"
      ? "consultations"
      : section === "Meeting requests"
        ? "meeting_requests"
        : "announcements";
  const { run, message, busy } = useSave();
  const [selection, setSelected] = useState<string | null | undefined>(),
    [editing, setEditing] = useState<Row | "new" | null>(null),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [barangay, setBarangay] = useState(initialBarangay),
    [dateRange, setDateRange] = useState("all"),
    [sort, setSort] = useState("newest"),
    [meetingView, setMeetingView] = useState<"grid" | "list">("grid"),
    [draftOrganization, setDraftOrganization] = useState(""),
    [draftBarangay, setDraftBarangay] = useState(""),
    [editTitleLength, setEditTitleLength] = useState(0),
    [editBodyLength, setEditBodyLength] = useState(0),
    [relatedReport, setRelatedReport] = useState(""),
    [relatedReportSearch, setRelatedReportSearch] = useState(""),
    [showRelatedReportOptions, setShowRelatedReportOptions] = useState(false),
    [page, setPage] = useState(0);
  const [meetingHeaderStatus, setMeetingHeaderStatus] = useState<{ requestId: string; label: string; className: string } | null>(null);
  const relatedReportPicker = useRef<HTMLDivElement>(null);
  const searchTerm = useDebouncedValue(search.trim());
  const relatedReportSearchTerm = useDebouncedValue(relatedReportSearch.trim());
  useEffect(() => {
    if (!showRelatedReportOptions) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !relatedReportPicker.current?.contains(event.target)) setShowRelatedReportOptions(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [showRelatedReportOptions]);
  const columns = table === "meeting_requests"
    ? "id,title,body,status,coordination_status,participation_mode,barangay_id,decision_reason,consultation_id,category_id,report_id,created_at"
    : "*";
  const selectedId = selection === undefined ? initialRecordId : selection;
  const target = useQuery({
    queryKey: ["community-record", table, selectedId],
    enabled: !!selectedId,
    refetchInterval: 30000,
    queryFn: async () => {
      const row = await result<Row | null>(
        db!.from(table).select(columns).eq("id", selectedId!).maybeSingle<Row>(),
      );
      if (!row) return null;
      return { ...row, can_manage: await result<boolean>(
        db!.rpc("community_permissions", { p_table: table, p_id: row.id }),
      ) };
    },
  });
  const selected = target.data;
  const memberships = useQuery({
    queryKey: ["my-memberships", profile.id],
    queryFn: () =>
      result<{ organization_id: string }[]>(
        db!
          .from("organization_memberships")
          .select("organization_id")
          .eq("user_id", profile.id),
      ),
  });
  const officeIds = profile.role === "office" ? (memberships.data || []).map((membership) => membership.organization_id) : [];
  const announcementOrganizations = access.organizations.filter((organization) =>
    organization.active && access.rules.some((rule) => rule.organization_id === organization.id && rule.enabled),
  );
  const officeAnnouncementRules = access.rules.filter((rule) =>
    rule.enabled && rule.organization_id === draftOrganization,
  );
  const canSetCitywide = profile.role === "admin" || officeAnnouncementRules.some((rule) => !rule.barangay_id);
  const allowedAnnouncementBarangays = refs.barangays.filter((item) =>
    profile.role === "admin" || officeAnnouncementRules.some((rule) => !rule.barangay_id || rule.barangay_id === item.id),
  );
  const startCreate = () => {
    const firstOrganization = announcementOrganizations[0]?.id ?? "";
    const applicableRules = access.rules.filter((rule) => rule.enabled && rule.organization_id === firstOrganization);
    setDraftOrganization(table === "announcements" && profile.role === "office" ? firstOrganization : "");
    setDraftBarangay(profile.role === "barangay"
      ? profile.barangay_id ?? ""
      : table === "announcements" && profile.role === "office"
        ? (initialBarangay && applicableRules.some((rule) => !rule.barangay_id || rule.barangay_id === initialBarangay)
          ? initialBarangay
          : applicableRules.some((rule) => !rule.barangay_id) ? "" : applicableRules.find((rule) => rule.barangay_id)?.barangay_id ?? "")
        : initialBarangay);
    setEditTitleLength(0);
    setEditBodyLength(0);
    setRelatedReport("");
    setRelatedReportSearch("");
    setShowRelatedReportOptions(false);
    setEditing("new");
  };
  const startEdit = (row: Row) => {
    setDraftOrganization(row.organization_id ?? "");
    setDraftBarangay(row.barangay_id ?? "");
    setEditTitleLength(row.title.length);
    setEditBodyLength(row.body.length);
    setRelatedReport(row.report_id ?? "");
    setRelatedReportSearch("");
    setShowRelatedReportOptions(false);
    setEditing(row);
  };
  const q = useQuery({
    queryKey: ["community", profile.id, table, searchTerm, status, barangay, dateRange, sort, page, officeIds],
    enabled: table !== "meeting_requests" || profile.role !== "office" || memberships.isSuccess || memberships.isError,
    refetchInterval: 60000,
    queryFn: async () => {
      let invitedRequestIds: string[] | null = null;
      let invitedBarangayRequestIds: string[] | null = null;
      if (table === "meeting_requests" && profile.role === "office") {
        if (memberships.error) throw memberships.error;
        if (!officeIds.length) return [];
        const invitations = await result<{ request_id: string }[]>(
          db!.from("meeting_request_offices").select("request_id").in("organization_id", officeIds),
        );
        invitedRequestIds = [...new Set(invitations.map((invitation) => invitation.request_id))];
        if (!invitedRequestIds.length) return [];
      }
      if (table === "meeting_requests" && profile.role === "barangay" && profile.barangay_id) {
        const invitations = await result<{ request_id: string }[]>(db!.from("meeting_request_barangays")
          .select("request_id").eq("barangay_id", profile.barangay_id));
        invitedBarangayRequestIds = [...new Set(invitations.map((invitation) => invitation.request_id))];
      }
      let query = db!
        .from(table)
        .select(columns)
        .order("created_at", { ascending: sort === "oldest" })
        .range(page * 20, page * 20 + 19);
      if (invitedRequestIds) query = query.in("id", invitedRequestIds);
      if (invitedBarangayRequestIds && profile.barangay_id) {
        query = invitedBarangayRequestIds.length
          ? query.or(`barangay_id.eq.${profile.barangay_id},id.in.(${invitedBarangayRequestIds.join(",")})`)
          : query.eq("barangay_id", profile.barangay_id);
      }
      if (searchTerm) query = query.ilike("title", `%${searchTerm}%`);
      if (status === "unavailable" && table === "meeting_requests") query = query.eq("coordination_status", status);
      else if (status) query = query.eq("status", status);
      if (barangay && !invitedBarangayRequestIds) query = query.eq("barangay_id", barangay);
      if (dateRange !== "all") {
        const start = new Date();
        start.setDate(start.getDate() - Number(dateRange));
        query = query.gte("created_at", start.toISOString());
      }
      const rows = await result<Row[]>(query.returns<Row[]>());
      return Promise.all(
        rows.map(async (r) => ({
          ...r,
          can_manage: await result<boolean>(
            db!.rpc("community_permissions", { p_table: table, p_id: r.id }),
          ),
        })),
      );
    },
  });
  const relatedReports = useQuery({
    queryKey: ["consultation-related-reports", profile.id, draftBarangay, relatedReportSearchTerm, relatedReport],
    enabled: table === "consultations" && !!editing && !!draftBarangay && (showRelatedReportOptions || !!relatedReport),
    queryFn: async () => {
      const columns = "id,title,status,barangay_id,category_id,created_at";
      const reportsQuery = db!.from("reports").select(columns)
        .eq("barangay_id", draftBarangay).order("created_at", { ascending: false }).limit(8);
      const isReportId = new RegExp(`^${UUID_PATTERN}$`, "i").test(relatedReportSearchTerm);
      const filteredReportsQuery = relatedReportSearchTerm
        ? isReportId ? reportsQuery.eq("id", relatedReportSearchTerm) : reportsQuery.ilike("title", `%${relatedReportSearchTerm}%`)
        : reportsQuery;
      const [options, selectedReport] = await Promise.all([
        result<RelatedReport[]>(filteredReportsQuery),
        relatedReport
          ? result<RelatedReport | null>(db!.from("reports").select(columns).eq("id", relatedReport).eq("barangay_id", draftBarangay).maybeSingle<RelatedReport>())
          : Promise.resolve(null),
      ]);
      return selectedReport && !options.some((report) => report.id === selectedReport.id)
        ? [selectedReport, ...options]
        : options;
    },
  });
  const selectedRelatedReport = relatedReports.data?.find((report) => report.id === relatedReport);
  const canManage = (r: Row) => !!r.can_manage;
  const states =
    table === "consultations"
      ? ["draft", "open", "closed", "archived"]
      : table === "announcements"
        ? ["draft", "pending_review", "published", "archived"]
        : ["pending", "approved", "declined"];
  return (
    <>
      {table === "meeting_requests" ? (
        <MeetingRequestsView
          rows={q.data ?? []}
          refs={refs}
          isOffice={profile.role === "office"}
          search={search}
          setSearch={(value) => { setSearch(value); setPage(0); }}
          barangay={barangay}
          setBarangay={(value) => { setBarangay(value); setPage(0); }}
          status={status}
          setStatus={(value) => { setStatus(value); setPage(0); }}
          dateRange={dateRange}
          setDateRange={(value) => { setDateRange(value); setPage(0); }}
          sort={sort}
          setSort={(value) => { setSort(value); setPage(0); }}
          view={meetingView}
          setView={setMeetingView}
          page={page}
          hasNext={(q.data?.length ?? 0) === 20}
          loading={q.isPending}
          error={q.error}
          officeIds={officeIds}
          onRetry={() => {
            void q.refetch();
            void queryClient.invalidateQueries({ queryKey: ["meeting-request-schedules"] });
            void queryClient.invalidateQueries({ queryKey: ["meeting-request-office-invitations"] });
          }}
          onPageChange={setPage}
          onOpen={setSelected}
        />
      ) : table === "consultations" ? (
        <section className="consultations-workspace" aria-label="Consultations">
          <div className="consultations-actions">
            <p role="status">{message}</p>
            {canCreate(access, table) && (
              <button onClick={startCreate}>
                <Plus size={16} /> Create consultation
              </button>
            )}
          </div>

          <div className="consultations-filters">
            <label className="consultations-search">
              <span className="sr-only">Search consultations</span>
              <Search size={17} aria-hidden="true" />
              <input maxLength={200}
                placeholder="Search consultations..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </label>
            <label>
              <span>Barangay</span>
              <select value={barangay} onChange={(e) => { setBarangay(e.target.value); setPage(0); }}>
                <option value="">All visible</option>
                {refs.barangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
                <option value="">All statuses</option>
                {states.map((item) => <option key={item} value={item}>{label(item)}</option>)}
              </select>
            </label>
            <label className="consultations-sort">
              <span>Sort by</span>
              <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
          </div>

          <div className="consultations-results-heading">
            <h2>Showing {q.data?.length ?? 0} consultations</h2>
            <div className="consultations-view-toggle" role="group" aria-label="Consultation layout">
              <button type="button" aria-label="Grid view" aria-pressed={meetingView === "grid"} className={meetingView === "grid" ? "active" : ""} onClick={() => setMeetingView("grid")}><LayoutGrid size={16} /></button>
              <button type="button" aria-label="List view" aria-pressed={meetingView === "list"} className={meetingView === "list" ? "active" : ""} onClick={() => setMeetingView("list")}><List size={17} /></button>
            </div>
          </div>

          {q.isPending ? (
            <div className="consultation-grid" aria-label="Loading consultations" aria-busy="true">
              {[0, 1, 2].map((item) => <div className="panel consultation-skeleton" key={item}><span /><span /><span /><span /></div>)}
            </div>
          ) : q.error ? (
            <div className="panel consultation-empty" role="alert"><MessageSquare /><h3>Consultations could not load</h3><p>{q.error.message}</p><button className="secondary" onClick={() => void q.refetch()}><RefreshCw size={15} /> Try again</button></div>
          ) : !q.data?.length ? (
            <div className="panel consultation-empty"><MessageSquare /><h3>No consultations found</h3><p>Try another search or filter, or create a consultation for your community.</p>{canCreate(access, table) && <button onClick={startCreate}><Plus size={16} /> Create consultation</button>}</div>
          ) : (
            <div className={`consultation-grid${meetingView === "list" ? " is-list" : ""}`}>
              {q.data.map((r) => {
                const place = refs.barangays.find((item) => item.id === r.barangay_id)?.name ?? "Citywide";
                const manage = canManage(r);
                const setStatus = (next: string) => void run(db!.from(table).update({ status: next }).eq("id", r.id));
                const date = (value?: string) => value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "Date not set";
                return (
                  <article className="panel consultation-card" key={r.id}>
                    <div className="consultation-card-top">
                      <span className={`consultation-status ${r.status}`}>{label(r.status)}</span>
                      <span className="consultation-dates"><CalendarDays size={14} /> {date(r.opens_at)} – {date(r.closes_at)}</span>
                    </div>
                    <h3>{r.title}</h3>
                    <p className="consultation-description">{r.body}</p>
                    <p className="consultation-location"><MapPin size={15} /> {place}</p>
                    <div className="consultation-card-actions">
                      <button className="consultation-discussion" onClick={() => setSelected(r.id)}><MessageSquare size={15} /> Open discussion</button>
                      {manage && <>
                        <button className="secondary" onClick={() => startEdit(r)}>Edit</button>
                        {r.status === "open" ? <button className="secondary" disabled={busy} onClick={() => setStatus("closed")}>Close</button> : <button className="secondary" disabled={busy} onClick={() => setStatus("open")}>{r.status === "archived" ? "Reopen" : "Open"}</button>}
                        {r.status !== "archived" && <button className="secondary" disabled={busy} onClick={() => setStatus("archived")}>Archive</button>}
                      </>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="pagination consultation-pagination">
            <span className="muted">Page {page + 1}</span>
            <button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="secondary" disabled={(q.data?.length ?? 0) < 20} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </section>
      ) : (
        <section className="announcements-workspace" aria-label="Announcements">
          <div className="announcement-actions">
            <p role="status">{message}</p>
            {canCreate(access, table) && <button onClick={startCreate}><Plus size={16} /> Create announcement</button>}
          </div>

          <div className="announcement-filters">
            <label className="announcement-search">
              <span className="sr-only">Search announcements</span>
              <Search size={17} aria-hidden="true" />
              <input maxLength={200} placeholder="Search announcements..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </label>
            <label>
              <span>Barangay</span>
              <select value={barangay} onChange={(e) => { setBarangay(e.target.value); setPage(0); }}>
                <option value="">All visible</option>
                {refs.barangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
                <option value="">All statuses</option>
                {states.map((item) => <option key={item} value={item}>{label(item)}</option>)}
              </select>
            </label>
            <label>
              <span>Sort by</span>
              <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
          </div>

          <div className="announcement-results-heading">
            <h2>{q.data?.length ?? 0} announcements</h2>
            <div className="announcement-view-toggle" role="group" aria-label="Announcement layout">
              <button type="button" aria-label="Grid view" aria-pressed={meetingView === "grid"} className={meetingView === "grid" ? "active" : ""} onClick={() => setMeetingView("grid")}><LayoutGrid size={16} /></button>
              <button type="button" aria-label="List view" aria-pressed={meetingView === "list"} className={meetingView === "list" ? "active" : ""} onClick={() => setMeetingView("list")}><List size={17} /></button>
            </div>
          </div>

          {q.isPending ? (
            <div className="announcement-grid" aria-label="Loading announcements" aria-busy="true">
              {[0, 1, 2, 3].map((item) => <div className="panel announcement-skeleton" key={item}><span /><span /><span /><span /></div>)}
            </div>
          ) : q.error ? (
            <div className="panel announcement-empty" role="alert"><MessageSquare /><h3>Announcements could not load</h3><p>{q.error.message}</p><button className="secondary" onClick={() => void q.refetch()}><RefreshCw size={15} /> Try again</button></div>
          ) : !q.data?.length ? (
            <div className="panel announcement-empty"><MessageSquare /><h3>No announcements found</h3><p>Try another search or filter, or create an update for your community.</p>{canCreate(access, table) && <button onClick={startCreate}><Plus size={16} /> Create announcement</button>}</div>
          ) : (
            <div className={`announcement-grid${meetingView === "list" ? " is-list" : ""}`}>
              {q.data.map((r) => {
                const manager = canManage(r);
                const canEdit = manager || (r.created_by === profile.id && ["pending_review", "published"].includes(r.status));
                const primaryNext = r.status === "published" ? "archived" : "published";
                const primaryLabel = r.status === "pending_review" ? "Publish" : r.status === "archived" ? "Republish" : "Archive";
                const otherStates = states.filter((next) => next !== r.status && next !== "draft" && next !== "pending_review" && next !== primaryNext);
                const dateValue = r.publish_at || r.created_at;
                const dateText = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(dateValue));
                const statusText = r.status === "published" && r.publish_at && new Date(r.publish_at).getTime() > Date.now() ? "Scheduled" : label(r.status);
                const nextLabel = (next: string) => next === "published" ? "Publish" : "Archive";
                return (
                  <article className="panel announcement-card" key={r.id}>
                    <div className="announcement-card-top">
                      <span className={`announcement-status ${r.status}`}>{statusText}</span>
                      <time dateTime={dateValue}><CalendarDays size={14} /> {dateText}</time>
                      {manager && !!otherStates.length && <details className="announcement-menu">
                        <summary aria-label={`More actions for ${r.title}`}><MoreVertical size={17} /></summary>
                        <div className="announcement-menu-panel" role="group" aria-label="Status actions">
                          {otherStates.map((next) => (
                            <button type="button" key={next} disabled={busy} onClick={(event) => {
                              void run(db!.from("announcements").update({ status: next }).eq("id", r.id));
                              event.currentTarget.closest("details")?.removeAttribute("open");
                            }}>{nextLabel(next)}</button>
                          ))}
                        </div>
                      </details>}
                    </div>
                    <h3>{r.title}</h3>
                    <p className="announcement-description">{r.body}</p>
                    <p className="announcement-location"><MapPin size={15} /> {refs.barangays.find((item) => item.id === r.barangay_id)?.name ?? "Citywide"}{r.organization_id ? ` · ${refs.organizations.find((item) => item.id === r.organization_id)?.name ?? ""}` : ""}</p>
                    {r.decision_reason && <p className="announcement-note">{r.decision_reason}</p>}
                    <div className="announcement-card-actions">
                      <button className="announcement-read" onClick={() => setSelected(r.id)}><FileText size={14} /> Read announcement</button>
                      {canEdit && <button className="secondary" onClick={() => startEdit(r)}>Edit</button>}
                      {manager && <button className="secondary announcement-status-action" disabled={busy} onClick={() => void run(db!.from("announcements").update({ status: primaryNext }).eq("id", r.id))}>{primaryLabel}</button>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="pagination announcement-pagination">
            <span className="muted">Page {page + 1}</span>
            <button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="secondary" disabled={(q.data?.length ?? 0) < 20} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </section>
      )}
      {editing && (
        <Dialog
          title={
            editing === "new"
              ? "Create " +
                (table === "consultations" ? "consultation" : "announcement")
              : "Edit " + editing.title
          }
          close={() => setEditing(null)}
          className={table === "consultations" ? "consultation-edit-dialog" : table === "announcements" ? "announcement-edit-dialog" : undefined}
          icon={table === "consultations" ? <Pencil size={22} /> : table === "announcements" ? <Megaphone size={22} /> : undefined}
          description={table === "consultations" ? "Update the discussion details and keep your community informed." : table === "announcements" ? editing === "new" ? "Share an update with residents now or schedule it for later." : "Update the announcement and its publication time." : undefined}
        >
          <form
            key={editing === "new" ? `${table}-new` : `${table}-${editing.id}`}
            className={table === "consultations" ? "consultation-edit-form" : table === "announcements" ? "announcement-edit-form" : undefined}
            onFocusCapture={(event) => {
              if (table !== "meeting_requests" && event.target.matches("input, select, textarea"))
                event.target.scrollIntoView({ block: "nearest" });
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const dateTime = (name: string) => {
                const raw = f.get(name);
                const parsed = typeof raw === "string" ? parseManilaDateTimeInput(raw) : null;
                if (parsed) return parsed;
                const field = e.currentTarget.elements.namedItem(name);
                if (field instanceof HTMLInputElement) {
                  field.setCustomValidity("Choose a valid date and time.");
                  field.reportValidity();
                }
                return null;
              };
              const opensAt = table === "consultations" ? dateTime("opens") : null;
              const closesAt = table === "consultations" ? dateTime("closes") : null;
              const publishAt = table === "announcements" ? dateTime("publish") : null;
              if ((table === "consultations" && (!opensAt || !closesAt)) || (table === "announcements" && !publishAt)) return;
              if (opensAt && closesAt && closesAt <= opensAt) {
                const field = e.currentTarget.elements.namedItem("closes");
                if (field instanceof HTMLInputElement) {
                  field.setCustomValidity("Closing time must be later than opening time.");
                  field.reportValidity();
                }
                return;
              }
              const fileEntry = f.get("announcement_image");
              const image = fileEntry instanceof File && fileEntry.name ? fileEntry : null;
              const payload: Record<string, unknown> = {
                title: f.get("title"),
                body: f.get("body"),
                barangay_id: f.get("barangay") || null,
                organization_id: table === "announcements" && profile.role === "barangay"
                  ? null
                  : f.get("organization") || null,
                ...(table === "consultations"
                  ? {
                      report_id: f.get("report") || null,
                      opens_at: opensAt!.toISOString(),
                      closes_at: closesAt!.toISOString(),
                    }
                  : {
                      publish_at: publishAt!.toISOString(),
                      kind: f.get("kind"),
                    }),
                ...(table === "announcements" && (editing === "new" || editing.status === "pending_review")
                  ? { status: editing === "new" && image ? "draft" : "published" }
                  : {}),
              };
              const saved = table === "announcements"
                ? await run((async () => {
                    if (image) await validateImageFile(image);
                    const extension = image?.type === "image/jpeg" ? "jpg" : image?.type === "image/png" ? "png" : "webp";
                    if (editing === "new") {
                      const id = crypto.randomUUID();
                      const path = image ? `${id}/${crypto.randomUUID()}.${extension}` : null;
                      const created = await result<{ id: string }>(db!.from("announcements").insert({ ...payload, ...(path ? { id, attachment_path: path } : {}) }).select("id").single());
                      try {
                        if (image) {
                          if (!path) throw new Error("The announcement image could not be prepared.");
                          await result(db!.storage.from("announcement-media").upload(path, image, { contentType: image.type, upsert: false }));
                          await result(db!.from("announcements").update({ attachment_path: path, status: "published" }).eq("id", created.id).eq("status", "draft").select("id").single());
                        }
                      } catch (cause) {
                        if (path) await db!.storage.from("announcement-media").remove([path]);
                        try { await result(db!.from("announcements").delete().eq("id", created.id).eq("status", "draft")); } catch { /* Keep the upload error visible. */ }
                        throw cause;
                      }
                    } else {
                      let path: string | null = null;
                      if (image) {
                        path = `${editing.id}/${crypto.randomUUID()}.${extension}`;
                        await result(db!.storage.from("announcement-media").upload(path, image, { contentType: image.type, upsert: false }));
                      }
                      try {
                        await result(db!.from("announcements").update({ ...payload, ...(path ? { attachment_path: path } : {}) }).eq("id", editing.id).select("id").single());
                      } catch (cause) {
                        if (path) await db!.storage.from("announcement-media").remove([path]);
                        throw cause;
                      }
                      if (path && editing.attachment_path) await db!.storage.from("announcement-media").remove([editing.attachment_path]);
                    }
                    return { data: null, error: null };
                  })())
                : await run(editing === "new" ? db!.from(table).insert(payload) : db!.from(table).update(payload).eq("id", editing.id));
              if (saved) setEditing(null);
            }}
          >
            {table === "consultations" ? (
              <div className="consultation-edit-content">
                <section className="consultation-edit-section">
                  <div className="consultation-edit-section-heading">
                    <span className="consultation-edit-section-icon"><FileText size={19} /></span>
                    <div><h3>Basic information</h3><p>Provide a clear and concise title and description for the consultation.</p></div>
                  </div>
                  <label className="consultation-edit-field">
                    <span className="consultation-edit-field-label"><span>Title <b>*</b></span><small>{characterLimitHint(editTitleLength, 160)}</small></span>
                    <input name="title" required minLength={8} maxLength={160} defaultValue={editing === "new" ? "" : editing.title} onChange={(event) => setEditTitleLength(event.target.value.length)} />
                  </label>
                  <label className="consultation-edit-field">
                    <span className="consultation-edit-field-label"><span>Objective and questions <b>*</b></span><small>{characterLimitHint(editBodyLength, 10000)}</small></span>
                    <textarea name="body" required minLength={20} maxLength={10000} defaultValue={editing === "new" ? "" : editing.body} onChange={(event) => setEditBodyLength(event.target.value.length)} />
                  </label>
                </section>

                <section className="consultation-edit-section">
                  <div className="consultation-edit-section-heading">
                    <span className="consultation-edit-section-icon"><MapPin size={20} /></span>
                    <div><h3>Location and organization</h3><p>Specify the barangay and issuing office for this consultation.</p></div>
                  </div>
                  <div className="consultation-edit-grid">
                    <label className="consultation-edit-field">
                      <span className="consultation-edit-field-label"><span>Barangay <b>*</b></span></span>
                      <select name="barangay" required value={draftBarangay} onChange={(event) => {
                        const nextBarangay = event.target.value;
                        setDraftBarangay(nextBarangay);
                        setRelatedReport("");
                        setRelatedReportSearch("");
                        setShowRelatedReportOptions(false);
                      }}>
                        <option value="">Choose a barangay</option>
                        {refs.barangays.filter((item) => profile.role !== "barangay" || item.id === profile.barangay_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                    <label className="consultation-edit-field">
                      <span className="consultation-edit-field-label"><span>Issuing office</span></span>
                      <select name="organization" required={profile.role === "office"} defaultValue={editing === "new" ? "" : editing.organization_id || ""}>
                        <option value="">{profile.role === "office" ? "Choose your office" : "Barangay administration"}</option>
                        {refs.organizations.filter((o) => ((o as { active?: boolean }).active !== false || editing !== "new" && editing.organization_id === o.id) && (profile.role !== "office" || access.organizations.some((a) => a.id === o.id && a.can_consult) && memberships.data?.some((m) => m.organization_id === o.id))).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </label>
                  </div>
                </section>

                <section className="consultation-edit-section">
                  <div className="consultation-edit-section-heading">
                    <span className="consultation-edit-section-icon"><Link2 size={19} /></span>
                    <div><h3>Related report <span>(optional)</span></h3><p>Link this consultation to an existing report for easier tracking.</p></div>
                  </div>
                  <div className="consultation-edit-related" ref={relatedReportPicker}>
                    <input type="hidden" name="report" value={relatedReport} />
                    {relatedReport && !showRelatedReportOptions ? (
                      <div className="consultation-linked-report">
                        <div><strong>{selectedRelatedReport?.title || relatedReportSearch || "Related report"}</strong><small>{relatedReport.slice(0, 8).toUpperCase()} · {selectedRelatedReport ? label(selectedRelatedReport.status) : "Linked"}</small></div>
                        <div className="consultation-linked-report-actions"><button type="button" onClick={() => { setRelatedReport(""); setRelatedReportSearch(""); setShowRelatedReportOptions(true); }}>Change</button><button type="button" onClick={() => { setRelatedReport(""); setRelatedReportSearch(""); setShowRelatedReportOptions(false); }}>Remove link</button></div>
                      </div>
                    ) : (
                      <>
                        <div className="consultation-edit-related-search"><Search size={17} aria-hidden="true" /><input maxLength={160} placeholder="Search report title or paste report ID" value={relatedReportSearch} onFocus={() => setShowRelatedReportOptions(true)} onChange={(event) => { setRelatedReport(""); setRelatedReportSearch(event.target.value); setShowRelatedReportOptions(true); }} aria-label="Search reports in this barangay" aria-expanded={showRelatedReportOptions} aria-controls="consultation-related-report-options" autoComplete="off" />{relatedReportSearch && <button type="button" className="consultation-edit-clear" aria-label="Clear report search" onClick={() => { setRelatedReportSearch(""); setShowRelatedReportOptions(true); }}><X size={17} /></button>}</div>
                        {showRelatedReportOptions && <div className="consultation-related-report-options" id="consultation-related-report-options" role="listbox" aria-label="Available reports">
                          {!draftBarangay ? <p>Choose a barangay first to find related reports.</p>
                            : relatedReports.isPending ? <p role="status">Loading reports…</p>
                              : relatedReports.isError ? <p role="alert">Reports could not load. <button type="button" className="text-button" onClick={() => void relatedReports.refetch()}>Try again</button></p>
                                : !relatedReports.data?.length ? <p>{relatedReportSearchTerm ? "No matching reports found." : "No accessible reports in this barangay."}</p>
                                  : relatedReports.data.map((report) => <button type="button" role="option" aria-selected={relatedReport === report.id} key={report.id} onClick={() => { setRelatedReport(report.id); setRelatedReportSearch(report.title); setShowRelatedReportOptions(false); }}><span><strong>{report.title}</strong><small>{refs.categories.find((category) => category.id === report.category_id)?.name || "Report"} · {label(report.status)} · {new Date(report.created_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</small></span><code>{report.id.slice(0, 8).toUpperCase()}</code></button>)}
                        </div>}
                      </>
                    )}
                  </div>
                </section>

                <section className="consultation-edit-section">
                  <div className="consultation-edit-section-heading">
                    <span className="consultation-edit-section-icon"><CalendarDays size={19} /></span>
                    <div><h3>Schedule</h3><p>Set the opening and closing dates for this consultation.</p></div>
                  </div>
                  <div className="consultation-edit-grid">
                    <label className="consultation-edit-field"><span className="consultation-edit-field-label"><span>Opens <b>*</b></span></span><input required type="datetime-local" name="opens" defaultValue={localDate(editing === "new" ? undefined : editing.opens_at)} onInput={(event) => event.currentTarget.setCustomValidity("")} /></label>
                    <label className="consultation-edit-field"><span className="consultation-edit-field-label"><span>Closes <b>*</b></span></span><input required type="datetime-local" name="closes" defaultValue={localDate(editing === "new" ? new Date(Date.now() + 30 * 86400000).toISOString() : editing.closes_at)} onInput={(event) => event.currentTarget.setCustomValidity("")} /></label>
                  </div>
                </section>
              </div>
            ) : (
              <>
                <div className="announcement-edit-content">
                  <section className="announcement-edit-section">
                    <div className="announcement-edit-section-heading"><span className="announcement-edit-section-icon"><FileText size={18} /></span><div><h3>Announcement details</h3><p>Write a clear update residents can act on.</p></div></div>
                    <div className="announcement-edit-grid">
                      <label className="announcement-edit-field is-wide"><span>Title <b>*</b></span><input name="title" required minLength={8} maxLength={160} defaultValue={editing === "new" ? "" : editing.title} /></label>
                      <label className="announcement-edit-field is-wide"><span>Content <b>*</b></span><textarea name="body" required minLength={20} maxLength={10000} defaultValue={editing === "new" ? "" : editing.body} /></label>
                      <label className="announcement-edit-field"><span>Type <b>*</b></span><input maxLength={80} required list="announcement-kinds" name="kind" defaultValue={editing === "new" ? "General announcement" : editing.kind} /><datalist id="announcement-kinds">{["General announcement", "Maintenance notice", "Community cleanup", "Office advisory", "Consultation invitation", "Meeting schedule", "Repair update"].map((kind) => <option key={kind}>{kind}</option>)}</datalist></label>
                      <label className="announcement-edit-image"><span><ImagePlus size={16} /> Image <small>Optional</small></span><input type="file" name="announcement_image" accept="image/jpeg,image/png,image/webp" /><small>{editing !== "new" && editing.attachment_path ? "Choose a new image to replace the attached one." : "JPG, PNG, or WebP · up to 5 MB"}</small></label>
                    </div>
                  </section>
                  <section className="announcement-edit-section">
                    <div className="announcement-edit-section-heading"><span className="announcement-edit-section-icon"><MapPin size={18} /></span><div><h3>Audience</h3><p>Choose where this announcement applies.</p></div></div>
                    <div className="announcement-edit-grid announcement-audience-grid">
                      {profile.role === "barangay" ? (
                        <label className="announcement-edit-field"><span>Barangay</span><input type="hidden" name="barangay" value={profile.barangay_id ?? ""} /><input value={refs.barangays.find((item) => item.id === profile.barangay_id)?.name ?? "Your assigned barangay"} readOnly /></label>
                      ) : (
                        <label className="announcement-edit-field"><span>Barangay <b>{profile.role === "office" && !canSetCitywide ? "*" : ""}</b></span><select name="barangay" required={profile.role === "office" && !canSetCitywide} value={draftBarangay} onChange={(event) => setDraftBarangay(event.target.value)}>{profile.role === "office" && !canSetCitywide ? <option value="">Choose a barangay</option> : <option value="">Citywide</option>}{(profile.role === "office" ? allowedAnnouncementBarangays : refs.barangays).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                      )}
                      {profile.role !== "barangay" && <label className="announcement-edit-field"><span>Issuing office <b>{profile.role === "office" ? "*" : ""}</b></span><select name="organization" required={profile.role === "office"} value={profile.role === "office" ? draftOrganization : undefined} defaultValue={profile.role === "office" ? undefined : editing === "new" ? "" : editing.organization_id || ""} onChange={profile.role === "office" ? (event) => { const nextOrganization = event.target.value; const nextRules = access.rules.filter((rule) => rule.enabled && rule.organization_id === nextOrganization); setDraftOrganization(nextOrganization); setDraftBarangay((current) => current && nextRules.some((rule) => !rule.barangay_id || rule.barangay_id === current) ? current : nextRules.some((rule) => !rule.barangay_id) ? "" : nextRules.find((rule) => rule.barangay_id)?.barangay_id ?? ""); } : undefined}><option value="">{profile.role === "office" ? "Choose your office" : "Barangay administration"}</option>{(profile.role === "office" ? announcementOrganizations : refs.organizations).map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
                    </div>
                  </section>
                  <section className="announcement-edit-section announcement-publication-section">
                    <div className="announcement-edit-section-heading"><span className="announcement-edit-section-icon"><CalendarDays size={18} /></span><div><h3>Publication</h3><p>Set when residents can see it.</p></div></div>
                    <label className="announcement-edit-field"><span>Publish date and time · Philippine time <b>*</b></span><input required name="publish" type="datetime-local" defaultValue={localDate(editing === "new" ? undefined : editing.publish_at)} onInput={(event) => event.currentTarget.setCustomValidity("")} /></label>
                    <p className="announcement-publish-note"><Clock3 size={16} /><span>No review is needed. It will publish at this time; a future time is scheduled automatically. Residents receive one in-app update when it goes live.</span></p>
                  </section>
                </div>
              </>
            )}
            {table === "consultations" ? (
              <div className="consultation-edit-footer">
                <p className="consultation-edit-status" role="status">{message}</p>
                <div className="consultation-edit-actions">
                  <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
                  <button disabled={busy}>{busy ? "Saving…" : editing === "new" ? "Save draft" : "Save revision"}</button>
                </div>
              </div>
            ) : (
              <>
                {table === "announcements" ? (
                  <div className="community-edit-actions announcement-edit-actions">
                    <p role="status">{message}</p>
                    <div className="announcement-edit-buttons">
                      <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
                      <button disabled={busy}>{busy ? editing === "new" || editing.status === "pending_review" ? "Publishing…" : "Saving…" : editing === "new" || editing.status === "pending_review" ? <><Send size={15} /> Publish announcement</> : "Save changes"}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="community-edit-actions"><button disabled={busy}>{busy ? editing === "new" ? "Submitting…" : "Saving…" : editing === "new" ? "Submit for review" : "Save changes"}</button></div>
                    <p role="status">{message}</p>
                  </>
                )}
              </>
            )}
          </form>
        </Dialog>
      )}
      {selectedId && (
        <Dialog
          key={selectedId}
          title={selected?.title || "Community update"}
          close={() => setSelected(null)}
          className={table === "consultations" ? "discussion-detail-dialog" : table === "meeting_requests" ? "meeting-details-dialog" : undefined}
          icon={table === "consultations" ? <MessageSquare size={22} /> : table === "meeting_requests" ? <CalendarDays size={22} /> : undefined}
          description={table === "consultations" ? "Review the consultation and follow the community discussion." : table === "meeting_requests" ? profile.role === "office" ? "View meeting details, respond to invitations, and follow actions assigned to your office." : "Review the request and manage its meeting details." : undefined}
          headerMeta={table === "meeting_requests" && meetingHeaderStatus?.requestId === selectedId
            ? <span className={meetingHeaderStatus.className}>{meetingHeaderStatus.label}</span>
            : undefined}
        >
          {target.isPending ? <p className="empty">Opening update…</p> : target.error ? (
            <div role="alert" className="error">
              <p>{target.error.message}</p>
              <button className="secondary" onClick={() => void target.refetch()}>Retry</button>
            </div>
          ) : !selected ? (
            <p className="notice">This update is no longer available or is outside your current access.</p>
          ) : table === "consultations" ? (
            <Discussion row={selected} manage={canManage(selected)} />
          ) : table === "meeting_requests" ? (
            <Meeting row={selected} refs={refs} isOffice={profile.role === "office"} manage={profile.role !== "office" && canManage(selected)} manageSchedule={profile.role === "barangay" && canManage(selected)}
              canInvite={profile.role === "admin" || (profile.role === "barangay" && profile.barangay_id === selected.barangay_id)}
              profileRole={profile.role} profileBarangayId={profile.barangay_id} officeIds={officeIds} onStatusChange={setMeetingHeaderStatus} />
          ) : (
            <Announcement
              row={selected}
              manage={canManage(selected)}
              admin={profile.role === "admin"}
            />
          )}
        </Dialog>
      )}
    </>
  );
}
type MeetingSchedule = {
  id: string;
  request_id: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  completed: boolean;
  meet_url?: string | null;
};

function MeetingRequestsView({
  rows,
  refs,
  isOffice,
  search,
  setSearch,
  barangay,
  setBarangay,
  status,
  setStatus,
  dateRange,
  setDateRange,
  sort,
  setSort,
  view,
  setView,
  page,
  hasNext,
  loading,
  error,
  officeIds,
  onRetry,
  onPageChange,
  onOpen,
}: {
  rows: Row[];
  refs: References;
  isOffice: boolean;
  search: string;
  setSearch: (value: string) => void;
  barangay: string;
  setBarangay: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  dateRange: string;
  setDateRange: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
  view: "grid" | "list";
  setView: (value: "grid" | "list") => void;
  page: number;
  hasNext: boolean;
  loading: boolean;
  error: Error | null;
  officeIds: string[];
  onRetry: () => void;
  onPageChange: (value: number) => void;
  onOpen: (id: string) => void;
}) {
  const requestIds = rows.map((row) => row.id);
  const meetings = useQuery({
    queryKey: ["meeting-request-schedules", requestIds],
    enabled: requestIds.length > 0,
    queryFn: () =>
      result<MeetingSchedule[]>(
        db!
          .from("meetings")
          .select("*")
          .in("request_id", requestIds)
          .order("starts_at"),
      ),
  });
  const invitationsQuery = useQuery({
    queryKey: ["meeting-request-office-invitations", requestIds, isOffice, officeIds],
    enabled: requestIds.length > 0 && (!isOffice || officeIds.length > 0),
    queryFn: () => {
      let query = db!.from("meeting_request_offices")
        .select("request_id,organization_id,status")
        .in("request_id", requestIds);
      if (isOffice) query = query.in("organization_id", officeIds);
      return result<{ request_id: string; organization_id: string; status: string }[]>(query);
    },
  });
  const invitationByRequest = new Map<string, { organization_id: string; status: string }[]>();
  for (const invitation of invitationsQuery.data ?? []) {
    const current = invitationByRequest.get(invitation.request_id) ?? [];
    current.push(invitation);
    invitationByRequest.set(invitation.request_id, current);
  }
  const scheduleByRequest = new Map(
    (meetings.data ?? []).map((meeting) => [meeting.request_id, meeting]),
  );
  const invitationCheckPending = isOffice && officeIds.length > 0 && invitationsQuery.isPending;
  const invitationCheckFailed = isOffice && !!invitationsQuery.error;
  const visibleRows = isOffice
    ? invitationCheckPending || invitationCheckFailed || !officeIds.length
      ? []
      : rows.filter((row) => (invitationByRequest.get(row.id)?.length ?? 0) > 0)
    : rows;
  const visibleRequestIds = new Set(visibleRows.map((row) => row.id));
  const visibleMeetings = (meetings.data ?? []).filter((meeting) => visibleRequestIds.has(meeting.request_id));
  const summaryLoading = loading || invitationCheckPending || invitationCheckFailed;
  const upcoming = visibleMeetings
    .filter((meeting) => !meeting.completed && new Date(meeting.starts_at).getTime() >= Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 4);
  const pending = visibleRows.filter((row) => row.status === "pending" && (!isOffice || (invitationByRequest.get(row.id) ?? []).some((invitation) => invitation.status === "pending"))).length;
  const approved = visibleRows.filter((row) => row.status === "approved").length;
  const completed = visibleMeetings.filter((meeting) => meeting.completed).length;
  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
  const statusFor = (row: Row) => {
    const schedule = scheduleByRequest.get(row.id);
    if (schedule?.completed) return { key: "completed", label: "Completed" };
    if (schedule) return { key: "scheduled", label: "Scheduled" };
    if (row.status === "pending" && isOffice) {
      const officeInvitations = invitationByRequest.get(row.id) ?? [];
      if (officeInvitations.every((invitation) => invitation.status === "declined")) return { key: "declined", label: "Invitation declined" };
      if (officeInvitations.some((invitation) => invitation.status === "pending")) return { key: "invitation-pending", label: "Invitation pending" };
      return { key: "awaiting-barangay", label: "Awaiting barangay" };
    }
    return row.status === "approved"
      ? { key: "approved", label: "Approved" }
      : row.status === "declined"
        ? { key: "declined", label: "Declined" }
        : { key: "pending", label: "Pending review" };
  };
  const statusIcon = (key: string) =>
    key === "approved" || key === "completed" ? <CheckCircle2 size={15} />
      : key === "scheduled" ? <CalendarDays size={15} />
        : key === "declined" ? <Check size={15} /> : <Clock3 size={15} />;

  return (
    <section className="meeting-workspace" aria-label="Meeting request workspace">
      <div className="meeting-metrics" aria-label="Meeting request summary">
        {[
          { title: "Total requests", count: visibleRows.length, note: "In these results", icon: <Users />, tone: "teal" },
          { title: "Approved", count: approved, note: "Ready to coordinate", icon: <CheckCircle2 />, tone: "green" },
          { title: isOffice ? "Pending invitations" : "Pending review", count: pending, note: isOffice ? "Awaiting your office" : "Awaiting a decision", icon: <Clock3 />, tone: "amber" },
          { title: "Scheduled", count: visibleMeetings.filter((meeting) => !meeting.completed).length, note: "Dates confirmed", icon: <CalendarDays />, tone: "blue" },
          { title: "Completed", count: completed, note: "Meeting held", icon: <Check />, tone: "green" },
        ].map((metric) => (
          <article className="meeting-metric" key={metric.title}>
            <span className={`meeting-metric-icon ${metric.tone}`}>{metric.icon}</span>
            <div><span>{metric.title}</span><strong>{summaryLoading ? "—" : metric.count}</strong><small>{metric.note}</small></div>
          </article>
        ))}
      </div>

      <div className="meeting-filterbar" aria-label="Filter meeting requests">
        <label className="meeting-search">
          <span className="sr-only">Search meeting requests</span>
          <Search size={17} aria-hidden="true" />
          <input maxLength={200} placeholder="Search meeting requests, offices, or keywords…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label><span>Barangay</span><select value={barangay} onChange={(event) => setBarangay(event.target.value)}><option value="">All visible</option>{refs.barangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{!isOffice && <option value="pending">Pending review</option>}<option value="approved">Approved</option><option value="declined">Declined</option></select></label>
        <label><span>Date range</span><select value={dateRange} onChange={(event) => setDateRange(event.target.value)}><option value="all">All time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
        <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>

      <div className="meeting-results-heading">
        <div><h2>Meeting requests</h2><p>{loading || invitationCheckPending ? "Loading requests…" : invitationCheckFailed ? "Invitations could not be checked" : `${visibleRows.length} ${visibleRows.length === 1 ? "request" : "requests"} in these results`}</p></div>
        <div className="meeting-results-actions">
          <button className="secondary meeting-refresh" onClick={onRetry} disabled={loading || invitationCheckPending}><RefreshCw size={15} /> Refresh</button>
          <div className="meeting-view-toggle" aria-label="Request layout">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Grid view" aria-pressed={view === "grid"}><LayoutGrid size={17} /></button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view" aria-pressed={view === "list"}><List size={18} /></button>
          </div>
        </div>
      </div>

      {error || invitationCheckFailed ? (
        <section className="panel meeting-empty" role="alert"><MessageSquare /><h3>{invitationCheckFailed && !error ? "Meeting invitations could not load" : "Meeting requests could not load"}</h3><p>{error?.message ?? "Your office invitations could not be checked. Refresh and try again."}</p><button onClick={onRetry}><RefreshCw size={15} /> Try again</button></section>
      ) : loading ? (
        <div className="meeting-layout"><div className={`meeting-request-grid ${view === "list" ? "is-list" : ""}`} aria-label="Loading meeting requests">{[0, 1, 2].map((item) => <div className="meeting-card meeting-card-skeleton" key={item}><span /><span /><span /><span /></div>)}</div><aside className="meeting-rail"><div className="meeting-card meeting-card-skeleton"><span /><span /><span /></div><div className="meeting-card meeting-card-skeleton"><span /><span /><span /></div></aside></div>
      ) : invitationCheckPending ? (
        <section className="panel meeting-empty" role="status" aria-busy="true"><Clock3 /><h3>Checking invitations</h3><p>Meeting requests appear here after the barangay invites your office.</p></section>
      ) : !visibleRows.length ? (
        <section className="panel meeting-empty"><CalendarPlus /><h3>{isOffice ? "No meeting invitations found" : "No meeting requests found"}</h3><p>{isOffice ? "Requests appear here after the barangay invites your office." : "Try changing the search or filters to see more requests."}</p></section>
      ) : (
        <div className="meeting-layout">
          <div className="meeting-primary">
            <div className={`meeting-request-grid ${view === "list" ? "is-list" : ""}`}>
              {visibleRows.map((row) => {
                const status = statusFor(row);
                const schedule = scheduleByRequest.get(row.id);
                const officeInvitations = invitationByRequest.get(row.id) ?? [];
                const pendingOfficeInvitation = officeInvitations.some((invitation) => invitation.status === "pending");
                const barangayName = refs.barangays.find((item) => item.id === row.barangay_id)?.name ?? "Barangay not specified";
                const meetingLink = normalizeGoogleMeetUrl(schedule?.meet_url || "");
                return (
                  <article className="meeting-card" key={row.id}>
                    <div className="meeting-card-top"><span className={`meeting-status ${status.key}`}>{statusIcon(status.key)}{status.label}</span><time dateTime={row.created_at}>{formatDate(row.created_at)}</time></div>
                    <h3>{row.title}</h3>
                    <p className="meeting-card-body">{row.body}</p>
                    <div className="meeting-card-meta"><span><MapPin size={15} />{barangayName}</span><span><CalendarDays size={15} />Requested {formatDate(row.created_at)}</span></div>
                    {officeIds.length > 0 && (invitationsQuery.isPending || invitationsQuery.error || officeInvitations.length > 0) && <div className="meeting-office-invitations" aria-live="polite">
                      {invitationsQuery.isPending ? <span className="muted">Checking your office invitation…</span> : invitationsQuery.error ? <span className="meeting-invitation-error">Invitation status unavailable</span> : officeInvitations.map((invitation) => (
                        <span className={`meeting-invitation-status ${invitation.status}`} key={invitation.organization_id}>
                          <strong>{refs.organizations.find((item) => item.id === invitation.organization_id)?.name ?? "Your office"}</strong>
                          <span>{invitation.status === "pending" ? "Reply needed" : label(invitation.status)}</span>
                        </span>
                      ))}
                    </div>}
                    {schedule && <div className="meeting-schedule"><CalendarDays size={16} /><div><strong>{formatMeetingTimeRange(schedule.starts_at, schedule.ends_at)}</strong><span>{schedule.venue}</span></div>{meetingLink && <a className="meeting-join-link" href={meetingLink} target="_blank" rel="noreferrer"><Link2 size={14} aria-hidden="true" />Join Google Meet</a>}</div>}
                    {row.decision_reason && <p className="meeting-decision">{row.decision_reason}</p>}
                    <button className="meeting-review" onClick={() => onOpen(row.id)}><FileText size={16} /> {isOffice ? pendingOfficeInvitation ? "Respond to invitation" : "View meeting" : "Review & follow up"} <ChevronRight size={17} /></button>
                  </article>
                );
              })}
            </div>
            <div className="meeting-pagination"><span>Page {page + 1}</span><div><button className="secondary" disabled={!page || loading} onClick={() => onPageChange(page - 1)}>Previous</button><button className="secondary" disabled={!hasNext || loading} onClick={() => onPageChange(page + 1)}>Next <ArrowRight size={15} /></button></div></div>
          </div>
          <aside className="meeting-rail">
            <section className="panel meeting-rail-panel">
              <div className="meeting-rail-heading"><span className="meeting-rail-icon"><CalendarDays size={18} /></span><div><h3>Upcoming meetings</h3><p>Confirmed dates and venues</p></div></div>
              {meetings.isPending ? <p className="meeting-rail-empty">Loading schedules…</p> : meetings.error ? <p className="meeting-rail-error">Meeting schedules are unavailable.</p> : !upcoming.length ? <p className="meeting-rail-empty">No upcoming meetings scheduled.</p> : upcoming.map((meeting) => {
                const request = visibleRows.find((row) => row.id === meeting.request_id);
                return <button className="meeting-upcoming" key={meeting.id} onClick={() => request && onOpen(request.id)} disabled={!request}><span className="meeting-date-tile"><strong>{new Date(meeting.starts_at).toLocaleDateString("en-PH", { day: "2-digit", timeZone: "Asia/Manila" })}</strong><small>{new Date(meeting.starts_at).toLocaleDateString("en-PH", { month: "short", timeZone: "Asia/Manila" }).toUpperCase()}</small></span><span className="meeting-upcoming-copy"><strong>{request?.title ?? "Meeting request"}</strong><small>{meetingTimeInput(meeting.starts_at)}–{meetingTimeInput(meeting.ends_at)} · {refs.barangays.find((item) => item.id === request?.barangay_id)?.name ?? "Barangay"}</small></span><ChevronRight size={16} /></button>;
              })}
            </section>
            <section className="panel meeting-rail-panel">
              <div className="meeting-rail-heading"><span className="meeting-rail-icon clock"><Clock3 size={18} /></span><div><h3>Recent requests</h3><p>Latest resident submissions</p></div></div>
              {[...visibleRows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4).map((row) => <button className="meeting-recent" key={row.id} onClick={() => onOpen(row.id)}><span className={`meeting-recent-dot ${statusFor(row).key}`} /><span><strong>{row.title}</strong><small>{statusFor(row).label} · {formatDate(row.created_at)}</small></span><ChevronRight size={15} /></button>)}
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}

function Discussion({ row, manage }: { row: Row; manage: boolean }) {
  const { run, message, busy } = useSave();
  const [reply, setReply] = useState(""),
    [page, setPage] = useState(0),
    [bodyLength, setBodyLength] = useState(0);
  const q = useQuery({
    queryKey: ["discussion", row.id, page],
    queryFn: async () => ({
      comments: await result<Comment[]>(
        db!
          .from("consultation_comments")
          .select("id,body,parent_id,hidden,official,created_at")
          .eq("consultation_id", row.id)
          .order("created_at")
          .range(page * 50, page * 50 + 49),
      ),
      flags: manage
        ? await result<
            { comment_id: string; reason: string; user_id: string }[]
          >(db!.from("comment_flags").select("comment_id,reason,user_id"))
        : [],
    }),
  });
  const replyTo = q.data?.comments.find((comment) => comment.id === reply);
  return (
    <div className="discussion-view">
      <section className="discussion-summary">
        <div className="discussion-summary-copy">
          <span className={`consultation-status ${row.status}`}>{label(row.status)}</span>
          <p className="preserve-lines">{row.body}</p>
        </div>
        {row.opens_at && row.closes_at && <div className="discussion-window"><CalendarDays size={20} /><span><strong>Discussion window</strong><time>{new Date(row.opens_at).toLocaleString("en-PH")} – {new Date(row.closes_at).toLocaleString("en-PH")}</time></span></div>}
      </section>
      {row.outcome && (
        <section className="discussion-outcome">
          <span className="discussion-outcome-icon"><CheckCircle2 size={19} /></span>
          <div><h3>Recorded outcome</h3><p className="preserve-lines">{row.outcome}</p></div>
        </section>
      )}
      {message && <p className="discussion-feedback" role="status">{message}</p>}
      <section className="discussion-thread" aria-labelledby="discussion-thread-title">
        <div className="discussion-section-heading"><div><h3 className="discussion-eyebrow">Community input</h3><p id="discussion-thread-title">Discussion</p></div>{q.data && <span className="discussion-count"><MessageSquare size={16} />{q.data.comments.length} {q.data.comments.length === 1 ? "comment" : "comments"} on this page</span>}</div>
        {q.isPending ? <div className="discussion-loading" aria-busy="true"><span /><span /><span /></div> : q.error ? (
          <div role="alert" className="discussion-error"><p>{q.error.message}</p><button type="button" className="secondary" onClick={() => void q.refetch()}>Retry loading discussion</button></div>
        ) : q.data?.comments.length ? q.data.comments.map((c) => (
          <article className={`comment discussion-comment${c.parent_id ? " reply" : ""}${c.official ? " official" : ""}`} key={c.id}>
            <span className={`discussion-author-icon${c.official ? " official" : ""}`} aria-hidden="true">{c.official ? <ShieldCheck size={20} /> : <UserRound size={20} />}</span>
            <div className="discussion-comment-content">
              <div className="discussion-comment-meta"><div><span className={c.official ? "badge verified" : "badge"}>{c.official ? "Verified official response" : "Resident contribution"}</span>{c.hidden && <span className="badge">Hidden</span>}</div><time dateTime={c.created_at}>{new Date(c.created_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</time></div>
              {c.parent_id && <p className="discussion-reply-context">Reply to: {q.data.comments.find((x) => x.id === c.parent_id)?.body.slice(0, 90) || "an earlier comment"}</p>}
              <p className="preserve-lines discussion-comment-body">{c.body}</p>
              {q.data.flags.filter((f) => f.comment_id === c.id).map((f) => <p className="discussion-flag" key={`${f.comment_id}-${f.user_id}`}><Flag size={16} /><span><strong>Flag:</strong> {f.reason}</span></p>)}
              <div className="discussion-comment-actions">
                <button type="button" className="text-button" onClick={() => setReply(c.id)}><MessageSquare size={15} /> Reply</button>
                {manage && <form className="inline-form discussion-moderation-form" onSubmit={(e) => { e.preventDefault(); void run(db!.from("consultation_comments").update({ hidden: !c.hidden, moderation_reason: new FormData(e.currentTarget).get("reason") }).eq("id", c.id)); }}>
                  <label>Moderation reason<textarea rows={2} maxLength={SHORT_REASON_LIMIT} required minLength={5} name="reason" placeholder="Briefly explain the moderation decision" aria-describedby={`moderation-reason-hint-${c.id}`} /><small id={`moderation-reason-hint-${c.id}`}>Use 5–500 characters.</small></label>
                  <button type="submit" className="secondary" disabled={busy}>{c.hidden ? "Restore" : "Hide"}</button>
                </form>}
                {manage && q.data.flags.some((f) => f.comment_id === c.id) && <button type="button" className="text-button discussion-resolve-flags" disabled={busy} onClick={() => void run(db!.from("comment_flags").delete().eq("comment_id", c.id))}>Resolve reviewed flags</button>}
              </div>
            </div>
          </article>
        )) : q.data ? <div className="discussion-empty"><MessageSquare size={21} /><strong>No comments yet</strong><span>Start the conversation with a clear, respectful comment.</span></div> : null}
        {q.data && <nav className="pagination discussion-pagination" aria-label="Discussion pages"><button type="button" className="secondary" aria-label="Previous page" disabled={!page || q.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /><span>Previous</span></button><span className="discussion-page-number" aria-current="page">{page + 1}</span><button type="button" className="secondary" disabled={q.data.comments.length < 50 || q.isFetching} onClick={() => setPage(page + 1)}><span>Next</span><ChevronRight size={16} /></button></nav>}
      </section>
      {row.status === "open" && (
        <section className="discussion-compose">
          <div className="discussion-compose-heading"><span className="discussion-compose-icon"><MessageSquare size={18} /></span><div><h3>{reply ? "Write a reply" : "Join the conversation"}</h3><p>Keep your contribution clear and respectful.</p></div></div>
          {reply && <div className="discussion-replying"><span>{replyTo?.body || "Replying to a comment on this discussion."}</span><button type="button" className="text-button" onClick={() => setReply("")}>Cancel reply</button></div>}
          <form className="discussion-compose-form" onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            if (
              await run(
                db!.from("consultation_comments").insert({
                  consultation_id: row.id,
                  body: new FormData(form).get("body"),
                  parent_id: reply || null,
                }),
              )
            ) {
              form.reset();
              setReply("");
              setBodyLength(0);
            }
          }}
        >
            <label><span>{reply ? "Your reply" : manage ? "Official response" : "Your comment"}</span><textarea name="body" required minLength={2} maxLength={2000} aria-describedby="discussion-body-count" onChange={(e) => setBodyLength(e.currentTarget.value.length)} placeholder="Share a helpful update or question…" /></label>
            <div className="discussion-compose-footer"><span id="discussion-body-count">{characterLimitHint(bodyLength, 2000) || "A brief update or question is enough."}</span><button disabled={busy}>{busy ? "Posting…" : "Post response"}<Send size={15} /></button></div>
          </form>
        </section>
      )}
      {manage && (
        <section className="discussion-outcome-form">
          <div className="discussion-compose-heading"><span className="discussion-outcome-icon"><CheckCircle2 size={18} /></span><div><h3>Record the consultation outcome</h3><p>Share a concise summary of the decision or next step.</p></div></div>
          <form onSubmit={(e) => {
            e.preventDefault();
            void run(
              db!
                .from("consultations")
                .update({
                  outcome: new FormData(e.currentTarget).get("outcome"),
                })
                .eq("id", row.id),
            );
          }}
        >
            <label><span>Outcome</span><textarea name="outcome" required minLength={5} maxLength={2000} defaultValue={row.outcome} placeholder="Record the decision, owner, or agreed next step…" /></label>
            <div className="discussion-compose-footer"><span>At least 5 characters</span><button disabled={busy}>{busy ? "Saving…" : "Record outcome"}</button></div>
          </form>
        </section>
      )}
    </div>
  );
}
type MeetingSection = "overview" | "schedule" | "invitations" | "follow-up" | "decision";

function Meeting({
  row,
  refs,
  isOffice,
  manage,
  manageSchedule,
  canInvite,
  profileRole,
  profileBarangayId,
  officeIds,
  onStatusChange,
}: {
  row: Row;
  refs: References;
  isOffice: boolean;
  manage: boolean;
  manageSchedule: boolean;
  canInvite: boolean;
  profileRole: Profile["role"];
  profileBarangayId: string | null;
  officeIds: string[];
  onStatusChange: (status: { requestId: string; label: string; className: string }) => void;
}) {
  const { run, message, failed, busy } = useSave();
  const [meetingFormError, setMeetingFormError] = useState("");
  const [meetingDecisionError, setMeetingDecisionError] = useState("");
  const [meetingInputError, setMeetingInputError] = useState("");
  const [meetingInputErrorMode, setMeetingInputErrorMode] = useState<MeetingInputErrorMode>("save");
  const [activeSection, setActiveSection] = useState<MeetingSection>("overview");
  const [venueType, setVenueType] = useState<"venue" | "online">("venue");
  const [meetingCompleted, setMeetingCompleted] = useState(false);
  const [barangayInvite, setBarangayInvite] = useState("");
  const [barangayInviteOpen, setBarangayInviteOpen] = useState(false);
  const q = useQuery({
    queryKey: ["meeting", row.id],
    queryFn: async () => {
      const meeting = await result<{
        id: string;
        venue: string;
        venue_type?: "venue" | "online";
        starts_at: string;
        ends_at: string;
        outcome: string;
        completed: boolean;
        meet_url?: string | null;
      } | null>(
        db!.from("meetings").select("*").eq("request_id", row.id).maybeSingle(),
      );
      return {
        meeting,
        invitations: await result<{ organization_id: string; status: string; decline_reason: string | null }[]>(
          db!.from("meeting_request_offices").select("organization_id,status,decline_reason").eq("request_id", row.id),
        ),
        barangayInvitations: await result<{ barangay_id: string; status: "pending" | "accepted" | "declined" }[]>(
          db!.from("meeting_request_barangays").select("barangay_id,status").eq("request_id", row.id),
        ),
        actions: meeting
          ? await result<
              {
                id: string;
                description: string;
                organization_id: string | null;
                due_at: string | null;
                completed: boolean;
              }[]
            >(
              db!
                .from("meeting_action_items")
                .select("*")
                .eq("meeting_id", meeting.id),
            )
          : [],
      };
    },
  });
  const participantsQuery = useQuery({
    queryKey: ["meeting-resident-roster", row.id, profileRole, profileBarangayId],
    enabled: profileRole === "admin" || profileRole === "barangay",
    queryFn: async () => result<{
      request_id: string;
      resident_id: string;
      resident_name: string;
      joined_at: string;
      participant_count: number;
    }[]>(db!.rpc("staff_meeting_request_participants", { p_request: row.id })),
  });
  const relatedReportQuery = useQuery({
    queryKey: ["meeting-linked-report", row.id, row.report_id],
    enabled: !!row.report_id,
    queryFn: async () => {
      const report = await result<RelatedReport | null>(db!.from("reports")
        .select("id,title,status,category_id,barangay_id,created_at,description,public_summary,location_address,purok,zone")
        .eq("id", row.report_id!)
        .maybeSingle<RelatedReport>());
      if (!report) return null;
      const files = await result<{ path: string; action_id: number | null }[]>(db!.from("report_attachments")
        .select("path,action_id")
        .eq("report_id", report.id)
        .is("action_id", null)
        .order("created_at", { ascending: true })
        .limit(1)).catch(() => []);
      if (!files.length) return { report, imageUrl: null as string | null };
      const { data, error } = await db!.storage.from("report-evidence").createSignedUrl(files[0].path, 3600);
      return { report, imageUrl: error ? null : data?.signedUrl ?? null };
    },
  });
  const meeting = q.data?.meeting;
  useEffect(() => {
    setVenueType(meeting?.venue_type || (meeting?.meet_url ? "online" : "venue"));
  }, [meeting?.id, meeting?.venue_type, meeting?.meet_url]);
  useEffect(() => setMeetingCompleted(!!meeting?.completed), [meeting?.id, meeting?.completed]);
  const meetingLink = normalizeGoogleMeetUrl(meeting?.meet_url || "");
  const residentParticipants = participantsQuery.data || [];
  const residentParticipantCount = participantsQuery.isPending ? "…" : participantsQuery.error ? "—" : residentParticipants[0]?.participant_count ?? 0;
  const invitations = q.data?.invitations || [];
  const barangayInvitations = q.data?.barangayInvitations || [];
  const currentBarangayInvitation = barangayInvitations.find((invitation) => invitation.barangay_id === profileBarangayId);
  const availableBarangays = refs.barangays.filter((item) => item.id !== row.barangay_id &&
    !barangayInvitations.some((invitation) => invitation.barangay_id === item.id && invitation.status !== "declined"));
  const canRespondToBarangayInvitation = profileRole === "barangay" && currentBarangayInvitation?.status === "pending";
  const ownInvitations = isOffice && officeIds.length ? invitations.filter((invitation) => officeIds.includes(invitation.organization_id)) : invitations;
  const meetingStatusLabel = meeting?.completed ? "Completed" : meeting ? "Scheduled" : isOffice && row.status === "pending" ? q.data ? !ownInvitations.length ? "Not invited" : ownInvitations.every((invitation) => invitation.status === "declined") ? "Invitation declined" : ownInvitations.some((invitation) => invitation.status === "pending") ? "Invitation pending" : "Awaiting barangay" : "Checking invitation" : label(row.status);
  const meetingStatusClassName = `meeting-detail-status${meeting?.completed ? " is-complete" : meeting ? " is-scheduled" : ""}`;
  useEffect(() => onStatusChange({ requestId: row.id, label: meetingStatusLabel, className: meetingStatusClassName }), [row.id, meetingStatusLabel, meetingStatusClassName, onStatusChange]);
  const acceptedOfficeIds = ownInvitations.filter((invitation) => invitation.status === "accepted").map((invitation) => invitation.organization_id);
  const canEditOfficeActions = isOffice && acceptedOfficeIds.length > 0;
  const canEditActionItem = (item: { organization_id: string | null }) => manage || (canEditOfficeActions && !!item.organization_id && acceptedOfficeIds.includes(item.organization_id));
  const requestOpen = row.status === "pending" || row.status === "approved";
  const hasInvitationSections = canInvite || officeIds.length > 0 || invitations.length > 0 || barangayInvitations.length > 0;
  const hasFinalDecision = canInvite || (manageSchedule && row.status === "approved" && !!meeting) || !!row.decision_reason;
  const availableOrganizations = refs.organizations.filter(
    (organization) => {
      const office = organization as typeof organization & { active?: boolean; can_consult?: boolean; can_coordinate?: boolean };
      return office.active && (office.can_consult || office.can_coordinate) &&
        !invitations.some((invitation) => invitation.organization_id === office.id && invitation.status !== "declined");
    },
  );
  const meetingSectionId = (section: string) => `meeting-${row.id}-${section}`;
  const sectionTabs: { key: MeetingSection; label: string }[] = [
    { key: "overview", label: "Overview" },
    ...(manageSchedule && row.status === "approved" ? [{ key: "schedule" as const, label: "Schedule" }] : []),
    ...(hasInvitationSections ? [{ key: "invitations" as const, label: "Invitations" }] : []),
    ...(meeting ? [{ key: "follow-up" as const, label: "Follow-up" }] : []),
    ...(hasFinalDecision ? [{ key: "decision" as const, label: "Decision" }] : []),
  ];
  const selectSection = (section: MeetingSection) => {
    setActiveSection(section);
    const body = document.getElementById(meetingSectionId("workspace"))?.closest(".community-dialog-body");
    if (body instanceof HTMLElement) body.scrollTo({ top: 0, behavior: "auto" });
  };
  return (
    <div id={meetingSectionId("workspace")} className={`meeting-detail-workspace${isOffice ? " is-office-view" : ""}`}>
      <nav className="meeting-section-tabs" role="tablist" aria-label="Meeting details sections" onKeyDown={(event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const currentIndex = sectionTabs.findIndex((section) => section.key === activeSection);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? sectionTabs.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + sectionTabs.length) % sectionTabs.length;
        const nextSection = sectionTabs[nextIndex];
        selectSection(nextSection.key);
        document.getElementById(meetingSectionId(`tab-${nextSection.key}`))?.focus();
      }}>
        {sectionTabs.map((section) => (
          <button
            key={section.key}
            id={meetingSectionId(`tab-${section.key}`)}
            type="button"
            role="tab"
            aria-selected={activeSection === section.key}
            aria-controls={meetingSectionId(`panel-${section.key}`)}
            tabIndex={activeSection === section.key ? 0 : -1}
            onClick={() => selectSection(section.key)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      {q.isPending ? <p className="meeting-feedback">Loading meeting details…</p> : null}
      {q.error && <p role="alert" className="meeting-feedback error">{q.error.message}</p>}
      {message && <p role={failed ? "alert" : "status"} className={`meeting-feedback ${failed ? "error" : "success"}`}>{message}</p>}
      {(isOffice || manage && !manageSchedule) && <p className="meeting-office-view-note"><Eye size={15} aria-hidden="true" />{isOffice ? "Meeting details are managed by the barangay. You can respond to your invitation and update action items assigned to an office you have accepted for." : "The assigned barangay manages the venue and schedule. You can review the request, invitations, and agreed actions."}</p>}

      <div id={meetingSectionId("panel-overview")} className="meeting-section-panel" role="tabpanel" aria-labelledby={meetingSectionId("tab-overview")} tabIndex={0} hidden={activeSection !== "overview"}>
      <section className="meeting-section meeting-overview">
        <div className="meeting-section-heading meeting-overview-heading">
          <span className="meeting-section-icon"><FileText size={20} /></span>
          <div><h3>Request overview</h3><p>Review the request, its current status, and scheduled time.</p></div>
        </div>
        <div className="meeting-overview-main">
          <p>{row.body}</p>
          {meeting && <div className="meeting-overview-place"><MapPin size={16} aria-hidden="true" /><div><strong>{meeting.venue_type === "online" ? "Online meeting" : "Meeting venue"}</strong><span>{meeting.venue_type === "online" ? "Google Meet" : meeting.venue}</span></div></div>}
          {meetingLink && <a className="meeting-join-link" href={meetingLink} target="_blank" rel="noreferrer"><Link2 size={15} aria-hidden="true" />Join Google Meet</a>}
        </div>
        <div className="meeting-overview-date">
          <CalendarDays size={21} aria-hidden="true" />
          <div><strong>Meeting date and time</strong><span>{meeting ? formatMeetingTimeRange(meeting.starts_at, meeting.ends_at) : "Not scheduled yet"}</span></div>
        </div>
      </section>

      <div className={`meeting-overview-support${row.report_id ? " has-report" : ""}`}>
        <section className="meeting-section meeting-overview-participants">
          <div className="meeting-section-heading">
            <span className="meeting-section-icon"><Users size={20} aria-hidden="true" /></span>
            <div><h3>Residents participating</h3><p>Residents who have joined this meeting.</p></div>
            {(profileRole === "admin" || profileRole === "barangay") && <span className="meeting-roster-count" aria-label={`${residentParticipantCount} participating residents`}>{residentParticipantCount}</span>}
          </div>
          {profileRole === "admin" || profileRole === "barangay" ? participantsQuery.isPending
            ? <p className="meeting-empty" role="status">Loading resident list…</p>
            : participantsQuery.error
              ? <div className="meeting-roster-empty"><p>Resident list couldn’t load.</p><button type="button" className="meeting-roster-retry" onClick={() => void participantsQuery.refetch()}>Try again</button></div>
              : residentParticipants.length
                ? <div className="meeting-resident-list">{residentParticipants.map((participant) => (
                  <div className="meeting-resident" key={participant.resident_id}>
                    <span className="meeting-resident-icon"><UserRound size={16} aria-hidden="true" /></span>
                    <strong>{participant.resident_name || "Resident"}</strong>
                    <small>Joined {new Date(participant.joined_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" })}</small>
                  </div>
                ))}</div>
                : <p className="meeting-empty">No participating residents yet.</p>
            : <p className="meeting-empty">The resident list is visible to the meeting barangay and administrators.</p>}
          {residentParticipants[0] && residentParticipants[0].participant_count > residentParticipants.length && <p className="meeting-empty">Showing the first {residentParticipants.length} of {residentParticipants[0].participant_count} participants.</p>}
        </section>

        {row.report_id && <section className="meeting-section meeting-overview-related-report">
          <div className="meeting-section-heading">
            <span className="meeting-section-icon"><FileText size={20} aria-hidden="true" /></span>
            <div><h3>Related report</h3><p>Issue linked to this meeting request.</p></div>
          </div>
          {relatedReportQuery.isPending
            ? <p className="meeting-empty" role="status">Loading linked report…</p>
            : relatedReportQuery.error
              ? <div className="meeting-roster-empty"><p>Linked report details couldn’t load.</p><button type="button" className="meeting-roster-retry" onClick={() => void relatedReportQuery.refetch()}>Try again</button></div>
              : relatedReportQuery.data?.report
                ? <article className="meeting-report-preview">
                  {relatedReportQuery.data.imageUrl
                    ? <img src={relatedReportQuery.data.imageUrl} alt={`Photo for ${relatedReportQuery.data.report.title}`} loading="lazy" />
                    : <div className="meeting-report-photo-empty"><ImagePlus size={21} aria-hidden="true" /><span>No report photo</span></div>}
                  <div className="meeting-report-copy">
                    <div className="meeting-report-badges">
                      <span>{refs.categories.find((category) => category.id === relatedReportQuery.data!.report!.category_id)?.name || "Community report"}</span>
                      <span>{label(relatedReportQuery.data.report.status)}</span>
                    </div>
                    <h4>{relatedReportQuery.data.report.title}</h4>
                    {(relatedReportQuery.data.report.public_summary || relatedReportQuery.data.report.description) && <p>{relatedReportQuery.data.report.public_summary || relatedReportQuery.data.report.description}</p>}
                    <div className="meeting-report-details">
                      <span>{refs.barangays.find((barangay) => barangay.id === relatedReportQuery.data!.report!.barangay_id)?.name || "Iligan City"}</span>
                      <time dateTime={relatedReportQuery.data.report.created_at}>{new Date(relatedReportQuery.data.report.created_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" })}</time>
                      {(relatedReportQuery.data.report.location_address || relatedReportQuery.data.report.purok || relatedReportQuery.data.report.zone) && <span>{relatedReportQuery.data.report.location_address || [relatedReportQuery.data.report.purok, relatedReportQuery.data.report.zone].filter(Boolean).join(" · ")}</span>}
                    </div>
                  </div>
                </article>
                : <p className="meeting-empty">The linked report is no longer available.</p>}
        </section>}
      </div>
      </div>

      {manageSchedule && row.status === "approved" && (
      <div id={meetingSectionId("panel-schedule")} className="meeting-section-panel" role="tabpanel" aria-labelledby={meetingSectionId("tab-schedule")} tabIndex={0} hidden={activeSection !== "schedule"}>
        <form id={meetingSectionId("schedule")} className="meeting-section meeting-details-form" key={meeting?.id || "new"} onChange={(e) => {
          if (!meetingInputError) return;
          setMeetingInputError(getMeetingInputError(e.currentTarget, meetingInputErrorMode));
        }} onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          const date = String(f.get("date") || "");
          const startsAt = parseManilaDateTimeInput(`${date}T${String(f.get("starts_at") || "")}`);
          const endsAt = parseManilaDateTimeInput(`${date}T${String(f.get("ends_at") || "")}`);
          const selectedVenueType = String(f.get("venue_type") || "venue") === "online" ? "online" : "venue";
          const meetUrlInput = String(f.get("meet_url") || "").trim();
          const meetUrl = normalizeGoogleMeetUrl(meetUrlInput);
          const completed = f.get("completed") === "on";
          const inputProblem = getMeetingInputError(form, "save");
          if (inputProblem || !startsAt || !endsAt) { setMeetingInputErrorMode("save"); setMeetingInputError(inputProblem || "Enter a valid date and start and end times in Philippine time."); return; }
          setMeetingInputError("");
          setMeetingFormError("");
          const payload = { request_id: row.id, venue_type: selectedVenueType,
            venue: selectedVenueType === "online" ? "Online via Google Meet" : String(f.get("venue") || "").trim(),
            starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), outcome: f.get("outcome"), completed,
            meet_url: selectedVenueType === "online" ? meetUrl : null };
          void run(db!.from("meetings").upsert(payload, { onConflict: "request_id" }), (error) => {
            if (/venue_type|meet_url|ends_at|schema cache|column .* does not exist/i.test(error)) {
              setMeetingFormError("This workspace database needs the meeting schedule update before it can save the time range. The schedule was not changed.");
              return true;
            }
          });
        }}>
          <input type="hidden" name="completed" value={meetingCompleted ? "on" : "off"} />
          <div className="meeting-section-heading meeting-details-heading">
            <span className="meeting-section-icon"><CalendarDays size={20} /></span>
            <div><h3>Plan the meeting</h3><p>Set the format and timing, then share an update with residents.</p></div>
          </div>
          <section className="meeting-form-section">
          <fieldset className="meeting-mode-fieldset">
            <legend>Meeting format <b>*</b></legend>
            <div className="meeting-mode-options">
              <label className={`meeting-mode-option ${venueType === "venue" ? "is-selected" : ""}`}><input type="radio" name="venue_type" value="venue" checked={venueType === "venue"} onChange={() => setVenueType("venue")} /><span><strong>In person</strong><small>Set the meeting venue</small></span></label>
              <label className={`meeting-mode-option ${venueType === "online" ? "is-selected" : ""}`}><input type="radio" name="venue_type" value="online" checked={venueType === "online"} onChange={() => setVenueType("online")} /><span><strong>Online</strong><small>Join through Google Meet</small></span></label>
            </div>
          </fieldset>
          <div className="meeting-form-grid">
            {venueType === "venue"
              ? <label className="meeting-field"><span>Meeting venue <b>*</b></span><input maxLength={240} name="venue" required minLength={3} defaultValue={meeting?.venue_type === "online" ? "" : meeting?.venue} placeholder="Building, office, or complete address" /></label>
              : <div className="meeting-online-note"><MapPin size={16} aria-hidden="true" /><span>Online through Google Meet. A valid join link is required before this meeting can be saved.</span></div>}
            <label className="meeting-field meeting-date-field"><span>Meeting date <b>*</b></span><input name="date" type="date" required defaultValue={meeting ? meetingDateInput(meeting.starts_at) : ""} /></label>
          </div>
          <div className="meeting-time-range">
            <label className="meeting-field"><span>Starts at <b>*</b></span><input name="starts_at" type="time" required defaultValue={meeting ? meetingTimeInput(meeting.starts_at) : ""} /></label>
            <span className="meeting-time-separator" aria-hidden="true">to</span>
            <label className="meeting-field"><span>Ends at <b>*</b></span><input name="ends_at" type="time" required defaultValue={meeting ? meetingTimeInput(meeting.ends_at) : ""} /></label>
            <small className="meeting-time-hint">Use Philippine time. Residents and email updates show this full time range.</small>
          </div>
          {venueType === "online" && <label className="meeting-field"><span>Google Meet link <b>*</b></span><input name="meet_url" type="url" inputMode="url" required autoCapitalize="none" autoCorrect="off" maxLength={300} defaultValue={meeting?.meet_url || ""} placeholder="https://meet.google.com/abc-defg-hij" aria-describedby="meeting-link-hint" /><small id="meeting-link-hint">Create or copy the Meet link from Google Calendar. The resident will receive it by email.</small></label>}
          <div className="meeting-calendar-help"><CalendarPlus size={16} aria-hidden="true" /><span>{venueType === "online" ? "Open a Calendar draft, turn on Google Meet, save the event, then paste its link above. A Meet link cannot be generated from a Calendar draft alone." : "Open a Calendar draft with this exact date and time range."}</span></div>
          {meetingInputError && <p className="meeting-feedback error" role="alert">{meetingInputError}</p>}
          {meetingFormError && <p className="meeting-feedback error" role="alert">{meetingFormError}</p>}
          </section>
          <section className="meeting-form-section">
            <div className="meeting-section-heading">
              <span className="meeting-section-icon"><FileText size={20} /></span>
              <div><h3>Resident update</h3><p>Publish the meeting summary, decisions, and key discussion points.</p></div>
            </div>
          <label className="meeting-field"><span>Public summary and minutes</span><textarea name="outcome" maxLength={2000} defaultValue={meeting?.outcome || ""} placeholder="Write a summary, decisions, and key discussion points…" /></label>
          </section>
          <div className="meeting-form-actions"><button type="button" className="secondary" disabled={busy} onClick={(event) => {
            const form = event.currentTarget.form;
            if (!form) return;
            const fields = new FormData(form);
            const date = String(fields.get("date") || "");
            const startsAt = parseManilaDateTimeInput(`${date}T${String(fields.get("starts_at") || "")}`);
            const endsAt = parseManilaDateTimeInput(`${date}T${String(fields.get("ends_at") || "")}`);
            const selectedVenueType = String(fields.get("venue_type") || "venue") === "online" ? "online" : "venue";
            const meetUrlInput = String(fields.get("meet_url") || "").trim();
            const meetUrl = normalizeGoogleMeetUrl(meetUrlInput);
            const calendarProblem = getMeetingInputError(form, "calendar");
            if (calendarProblem || !startsAt || !endsAt) { setMeetingInputErrorMode("calendar"); setMeetingInputError(!startsAt || !endsAt || calendarProblem === "End time must be later than start time on the selected date." || calendarProblem === "A meeting time window can be up to 12 hours." ? "Enter a valid date and time range of up to 12 hours before opening Calendar." : calendarProblem); return; }
            const calendarUrl = googleCalendarDraftUrl({
              title: `Iligan Connect · ${row.title}`,
              details: `${row.body}\n\nBarangay: ${refs.barangays.find((item) => item.id === row.barangay_id)?.name || "Iligan City"}`,
              venue: selectedVenueType === "venue" ? String(fields.get("venue") || "") : "",
              startsAt,
              endsAt,
              meetUrl,
            });
            if (!calendarUrl) { setMeetingInputErrorMode("calendar"); setMeetingInputError("The selected date could not be added to Calendar."); return; }
            setMeetingInputError("");
            window.open(calendarUrl, "_blank", "noopener,noreferrer");
          }}><CalendarPlus size={15} aria-hidden="true" />Create Calendar draft</button><button disabled={busy}>{busy ? "Saving…" : "Save meeting details"}</button></div>
        </form>
      </div>
      )}

      {hasInvitationSections && <div id={meetingSectionId("panel-invitations")} className="meeting-section-panel" role="tabpanel" aria-labelledby={meetingSectionId("tab-invitations")} tabIndex={0} hidden={activeSection !== "invitations"}>
        {q.isPending ? <p className="meeting-empty">Loading invitations…</p> : q.data && <div className="meeting-invitations-group">
          <div className="meeting-workflow-heading"><h3>Participants and invitations</h3><p>Office invitations and cross-barangay participation are managed separately.</p></div>
          {(canInvite || officeIds.length > 0 || invitations.length > 0) && (
          <section className="meeting-section">
            <div className="meeting-section-heading">
              <span className="meeting-section-icon"><Users size={20} /></span>
              <div><h3>{officeIds.length && !canInvite ? "Your office invitation" : "Office invitations"}</h3><p>{officeIds.length && !canInvite
                ? "Accept to confirm participation or decline. A reason is optional."
                : row.coordination_status === "unavailable" ? "All invited offices declined." : "Offices can accept or decline their invitation."}</p></div>
            </div>
            {ownInvitations.length ? <div className="meeting-participant-list">{ownInvitations.map((p) => (
              <div className="meeting-participant" key={p.organization_id}>
                <span className="meeting-participant-icon"><Users size={17} /></span>
                <div className="meeting-invitation-copy">
                  <strong>{refs.organizations.find((o) => o.id === p.organization_id)?.name || "Office"}</strong>
                  <p>{p.decline_reason ? `Reason: ${p.decline_reason}` : "Invitation to participate in this meeting."}</p>
                  {requestOpen && p.status === "pending" && officeIds.includes(p.organization_id) && (
                    <form className="meeting-form" onSubmit={(event) => {
                      event.preventDefault();
                      const fields = new FormData(event.currentTarget, event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : undefined);
                      const decision = fields.get("decision");
                      if (decision !== "accept" && decision !== "decline") return;
                      void run(db!.rpc("respond_meeting_office_invitation", {
                        p_request: row.id, p_organization: p.organization_id,
                        p_accept: decision === "accept", p_reason: decision === "decline" ? String(fields.get("reason") || "") : "",
                      }));
                    }}>
                      <label className="meeting-field"><span>Reason for declining (optional)</span><textarea name="reason" maxLength={SHORT_REASON_LIMIT} /></label>
                      <div className="meeting-form-actions">
                        <button type="submit" name="decision" value="decline" className="secondary" disabled={busy}>Decline</button>
                        <button type="submit" name="decision" value="accept" disabled={busy}>Accept invitation</button>
                      </div>
                    </form>
                  )}
                </div>
                <span className={`meeting-invitation-status ${p.status}`}>{p.status === "pending" ? "Awaiting reply" : label(p.status)}</span>
                {canInvite && p.status === "pending" && <button type="button" className="meeting-remove" aria-label="Withdraw office invitation" disabled={busy} onClick={() => void run(db!.rpc("remove_meeting_office_invitation", { p_request: row.id, p_organization: p.organization_id }))}><X size={17} /></button>}
              </div>
            ))}</div> : <p className="meeting-empty meeting-invitation-empty">{officeIds.length && !canInvite ? "Your office has not been invited to this meeting." : "No offices have been invited yet."}</p>}
            {canInvite && requestOpen && <form className="meeting-add-office" onSubmit={(e) => {
              e.preventDefault();
              const organizationId = new FormData(e.currentTarget).get("office");
              if (organizationId) void run(db!.rpc("invite_meeting_office", { p_request: row.id, p_organization: organizationId }));
            }}>
              <label className="meeting-field"><span>Office to invite</span><select name="office" required disabled={!availableOrganizations.length}><option value="">{availableOrganizations.length ? "Select an office" : "No available offices"}</option>{availableOrganizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <button disabled={busy || !availableOrganizations.length}><Plus size={17} /> Invite office</button>
            </form>}
          </section>
      )}

      {(barangayInvitations.length > 0 || canInvite && requestOpen) && (
        <section className="meeting-section meeting-barangay-invitations">
          <div className="meeting-section-heading">
            <span className="meeting-section-icon"><MapPin size={20} /></span>
            <div><h3>{canInvite ? "Barangay invitations" : "Your barangay invitation"}</h3><p>{canInvite
              ? "Invite another barangay separately from participating offices. Invited staff can respond to the meeting invitation."
              : "Review and respond to the invitation sent to your barangay."}</p></div>
          </div>
          {!!barangayInvitations.length && <div className="meeting-participant-list meeting-barangay-invitation-list" aria-live="polite">
            {barangayInvitations.map((invitation) => <div className="meeting-participant" key={invitation.barangay_id}>
              <span className="meeting-participant-icon is-teal"><MapPin size={17} aria-hidden="true" /></span>
              <div className="meeting-invitation-copy">
                <strong>{refs.barangays.find((item) => item.id === invitation.barangay_id)?.name ?? "Invited barangay"}</strong>
                <p>Invitation to participate in this meeting.</p>
              </div>
                <span className={`meeting-invitation-status ${invitation.status}`}>{invitation.status === "pending" ? "Awaiting reply" : label(invitation.status)}</span>
            </div>)}
          </div>}
          {!barangayInvitations.length && canInvite && requestOpen && <p className="meeting-empty meeting-invitation-empty">No barangays have been invited yet.</p>}
          {canRespondToBarangayInvitation && <div className="meeting-barangay-invitation-response">
            <p>Your barangay has been invited. Accept to confirm staff participation. Residents can join only when the meeting is open.</p>
            <div className="meeting-form-actions">
              <button type="button" disabled={busy} onClick={() => void run(db!.rpc("respond_meeting_barangay_invitation", { p_request: row.id, p_barangay: profileBarangayId, p_accept: true }))}>{busy ? "Saving…" : "Accept invitation"}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void run(db!.rpc("respond_meeting_barangay_invitation", { p_request: row.id, p_barangay: profileBarangayId, p_accept: false }))}>Decline</button>
            </div>
          </div>}
          {canInvite && requestOpen && availableBarangays.length > 0 && <>
            <button
              type="button"
              className="meeting-invite-barangay-trigger"
              aria-expanded={barangayInviteOpen}
              aria-controls={`meeting-barangay-invite-${row.id}`}
              onClick={() => { setBarangayInvite(""); setBarangayInviteOpen((open) => !open); }}
            >
              {barangayInviteOpen ? <X size={16} /> : <Plus size={16} />}
              {barangayInviteOpen ? "Cancel invitation" : "Invite another barangay"}
            </button>
            {barangayInviteOpen && <form id={`meeting-barangay-invite-${row.id}`} className="meeting-form meeting-add-office meeting-add-barangay" onSubmit={(event) => {
              event.preventDefault();
              if (!barangayInvite) return;
              void run(db!.rpc("invite_meeting_barangay", { p_request: row.id, p_barangay: barangayInvite })).then((saved) => {
                if (saved) { setBarangayInvite(""); setBarangayInviteOpen(false); }
              });
            }}>
              <label className="meeting-field"><span>Barangay to invite</span><select value={barangayInvite} required onChange={(event) => setBarangayInvite(event.target.value)}><option value="">Choose a barangay</option>{availableBarangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <button type="submit" disabled={busy || !barangayInvite}><Plus size={17} />{busy ? "Sending…" : "Send invitation"}</button>
            </form>}
          </>}
          {canInvite && requestOpen && !availableBarangays.length && <p className="meeting-empty">Every other barangay has already been invited.</p>}
        </section>
      )}
        </div>}
      </div>}

      {meeting && (
        <div id={meetingSectionId("panel-follow-up")} className="meeting-section-panel" role="tabpanel" aria-labelledby={meetingSectionId("tab-follow-up")} tabIndex={0} hidden={activeSection !== "follow-up"}>
          <section className="meeting-section">
            <div className="meeting-section-heading">
              <span className="meeting-section-icon"><CheckCircle2 size={20} /></span>
              <div><h3>Agreed actions and follow-up</h3><p>{isOffice ? canEditOfficeActions ? "View all agreed actions and update items assigned to your accepted office." : "View the recorded actions. Editing is available after your office accepts an invitation and receives an assigned action." : "Track decisions, owners, and follow-up dates."}</p></div>
            </div>
            {q.data?.actions.length ? <div className="meeting-action-list">{q.data.actions.map((a) => (
              <article className="meeting-action-item" key={a.id}>
                <span className={`meeting-action-state ${a.completed ? "is-complete" : ""}`} aria-hidden="true"><Check size={16} /></span>
                <div className="meeting-action-copy"><strong>{a.description}</strong><span>{refs.organizations.find((o) => o.id === a.organization_id)?.name || "Unassigned"}<i>·</i>{a.due_at ? new Date(`${a.due_at}T00:00:00`).toLocaleDateString() : "No target date"}</span></div>
                <span className={`meeting-action-badge ${a.completed ? "is-complete" : ""}`}>{a.completed ? "Completed" : "Open"}</span>
                {canEditActionItem(a) && <button type="button" className="meeting-action-toggle" disabled={busy} onClick={() => void run(db!.from("meeting_action_items").update({ completed: !a.completed }).eq("id", a.id))}>{a.completed ? "Reopen" : "Mark complete"}</button>}
                {canEditActionItem(a) && <details className="meeting-action-edit"><summary>Edit action</summary><form className="meeting-form" onSubmit={async (event) => {
                  event.preventDefault();
                  const fields = new FormData(event.currentTarget);
                  const description = String(fields.get("description") || "").trim();
                  if (description.length < 5) return;
                  await run(db!.from("meeting_action_items").update({ description, due_at: fields.get("due") || null }).eq("id", a.id));
                }}>
                  <label className="meeting-field"><span>Agreed action</span><textarea name="description" required minLength={5} maxLength={2000} defaultValue={a.description} /></label>
                  <label className="meeting-field"><span>Target date</span><input name="due" type="date" defaultValue={a.due_at || ""} /></label>
                  <div className="meeting-form-actions"><button disabled={busy}>{busy ? "Saving…" : "Save action"}</button></div>
                </form></details>}
              </article>
            ))}</div> : <p className="meeting-empty">No agreed actions recorded yet.</p>}
            {manage && <form className="meeting-form meeting-action-form" onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const organizationId = String(f.get("office") || "");
              if (await run(db!.from("meeting_action_items").insert({ meeting_id: meeting.id, description: f.get("description"), organization_id: organizationId || null, due_at: f.get("due") || null }))) form.reset();
            }}>
              <label className="meeting-field"><span>Agreed action</span><textarea name="description" required minLength={5} maxLength={2000} placeholder="Write the agreed action, decision, or finding…" /></label>
              <div className="meeting-form-grid">
                <label className="meeting-field"><span>Responsible office</span><select name="office"><option value="">Unassigned</option>{refs.organizations.filter((organization) => (organization as { active?: boolean }).active !== false).map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
                <label className="meeting-field"><span>Target date</span><input name="due" type="date" /></label>
              </div>
              <div className="meeting-form-actions"><button disabled={busy}>{busy ? "Saving…" : "Record follow-up action"}</button></div>
            </form>}
          </section>
        </div>
      )}

      {hasFinalDecision && (
        <div id={meetingSectionId("panel-decision")} className="meeting-section-panel" role="tabpanel" aria-labelledby={meetingSectionId("tab-decision")} tabIndex={0} hidden={activeSection !== "decision"}>
        <section className="meeting-section meeting-decision-section">
          <div className="meeting-section-heading">
            <span className="meeting-section-icon"><CheckCircle2 size={20} /></span>
            <div><h3>{meeting ? "Meeting decision" : "Request decision"}</h3><p>{row.status === "pending" ? "Review the request and record your decision." : manageSchedule && meeting ? "Mark the meeting complete after the scheduled activities and follow-up are finished." : "Review the recorded request decision and any explanation."}</p></div>
          </div>
          {row.status !== "pending" && <span className={`meeting-detail-status ${meeting?.completed ? "is-complete" : meeting ? "is-scheduled" : ""}`}>{meeting?.completed ? "Completed" : label(row.status)}</span>}
          {row.decision_reason && <p className="meeting-context-note">{row.decision_reason}</p>}
          {canInvite && row.status === "pending" && <form className="meeting-form" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const status = String(f.get("status"));
            const reason = String(f.get("reason") || "").trim();
            await run(db!.from("meeting_requests").update({ status, decision_reason: reason || null }).eq("id", row.id));
          }}>
            <label className="meeting-field"><span>Decision</span><select name="status"><option value="approved">Approve</option><option value="declined">Decline</option></select></label>
            <label className="meeting-field"><span>Reason (optional)</span><textarea maxLength={SHORT_REASON_LIMIT} name="reason" placeholder="Explain the decision or share next steps…" /></label>
            <div className="meeting-form-actions"><button disabled={busy}>{busy ? "Saving…" : "Record decision"}</button></div>
          </form>}
          {manageSchedule && row.status === "approved" && meeting && <form className="meeting-form meeting-completion-form" onChange={() => setMeetingDecisionError("")} onSubmit={async (event) => {
            event.preventDefault();
            const completed = new FormData(event.currentTarget).get("completed") === "on";
            const startsAt = new Date(meeting.starts_at).getTime();
            const endsAt = new Date(meeting.ends_at).getTime();
            if (completed && endsAt > Date.now()) { setMeetingDecisionError("A meeting cannot be marked completed before its scheduled end time."); return; }
            if (!completed && startsAt < Date.now() - 60_000) { setMeetingDecisionError("Choose a future time, or mark the meeting completed if it has already taken place."); return; }
            setMeetingDecisionError("");
            await run(db!.from("meetings").update({ completed }).eq("id", meeting.id));
          }}>
            <label className="meeting-completed"><input name="completed" type="checkbox" checked={meetingCompleted} disabled={busy} onChange={(event) => setMeetingCompleted(event.target.checked)} /><span><strong>Meeting completed</strong><small>Completed meetings are shown separately from upcoming schedules.</small></span></label>
            {meetingDecisionError && <p className="meeting-feedback error" role="alert">{meetingDecisionError}</p>}
            <div className="meeting-form-actions"><button disabled={busy}>{busy ? "Saving…" : "Save meeting decision"}</button></div>
          </form>}
        </section>
        </div>
      )}
    </div>
  );
}
function Announcement({
  row,
  manage,
  admin,
}: {
  row: Row;
  manage: boolean;
  admin: boolean;
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["announcement-detail", row.id],
    queryFn: async () => {
      const fresh = await result<Row>(
        db!.from("announcements").select("*").eq("id", row.id).single(),
      );
      return {
        url: fresh.attachment_path
          ? (
              await result<{ signedUrl: string }>(
                db!.storage
                  .from("announcement-media")
                  .createSignedUrl(fresh.attachment_path, 600),
              )
            ).signedUrl
          : null,
        revisions: admin
          ? await result<
              {
                id: number;
                created_at: string;
                old_value: Row | null;
                new_value: Row;
              }[]
            >(
              db!
                .from("audit_logs")
                .select("id,created_at,old_value,new_value")
                .eq("entity", "announcements")
                .eq("record_id", row.id)
                .order("created_at", { ascending: false })
                .limit(20),
            )
          : [],
      };
    },
  });
  return (
    <>
      <span className="badge">{row.kind}</span>
      <p className="fine">
        Publication: {new Date(row.publish_at!).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} Philippine time
      </p>
      <p className="preserve-lines">{row.body}</p>
      {q.data?.url && (
        <img
          className="announcement-image"
          src={q.data.url}
          alt="Official announcement attachment"
        />
      )}
      {q.error && <p className="error">{q.error.message}</p>}
      {manage && (
        <label className="section-gap">
          Attach an approved image (up to 5 MB)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                await validateImageFile(file);
                const path = `${row.id}/${crypto.randomUUID()}`;
                await result(
                  db!.storage
                    .from("announcement-media")
                    .upload(path, file, { contentType: file.type }),
                );
                try {
                  await result(
                    db!
                      .from("announcements")
                      .update({ attachment_path: path })
                      .eq("id", row.id),
                  );
                } catch (error) {
                  await db!.storage.from("announcement-media").remove([path]);
                  throw error;
                }
                await qc.invalidateQueries();
                setMessage("Image attached.");
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
      <p role="status">{message}</p>
      {admin && (
        <>
          <h3 className="section-gap">Revision history</h3>
          {q.data?.revisions.map((r) => (
            <details className="audit-item" key={r.id}>
              <summary>{new Date(r.created_at).toLocaleString()}</summary>
              <h4>Before</h4>
              <p className="preserve-lines">
                {r.old_value?.title}
                <br />
                {r.old_value?.body || "Initial version"}
              </p>
              <h4>After</h4>
              <p className="preserve-lines">
                {r.new_value.title}
                <br />
                {r.new_value.body}
              </p>
            </details>
          ))}
        </>
      )}
    </>
  );
}
