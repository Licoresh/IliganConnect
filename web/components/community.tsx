"use client";
import { useState } from "react";
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
  FileText,
  Flag,
  LayoutGrid,
  Link2,
  List,
  MapPin,
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
  X,
} from "lucide-react";
import { db, result } from "../lib/client";
import { label, Profile, UUID_PATTERN, SHORT_REASON_LIMIT, characterLimitHint } from "@community/shared";
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
type Comment = {
  id: string;
  body: string;
  parent_id: string | null;
  hidden: boolean;
  official: boolean;
  created_at: string;
};
const localDate = (value?: string) => {
  const d = value ? new Date(value) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
function useSave() {
  const qc = useQueryClient();
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return {
    message,
    busy,
    run: async (
      p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
    ) => {
      setBusy(true);
      setMessage("");
      try {
        await result(p);
        await qc.invalidateQueries();
        setMessage("Saved.");
        return true;
      } catch (e) {
        setMessage((e as Error).message);
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
    [page, setPage] = useState(0);
  const searchTerm = useDebouncedValue(search.trim());
  const columns = table === "meeting_requests"
    ? "id,title,body,status,barangay_id,decision_reason,consultation_id,category_id,report_id,created_at"
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
    setEditing("new");
  };
  const startEdit = (row: Row) => {
    setDraftOrganization(row.organization_id ?? "");
    setDraftBarangay(row.barangay_id ?? "");
    setEditTitleLength(row.title.length);
    setEditBodyLength(row.body.length);
    setRelatedReport(row.report_id ?? "");
    setEditing(row);
  };
  const q = useQuery({
    queryKey: ["community", table, searchTerm, status, barangay, dateRange, sort, page],
    refetchInterval: 60000,
    queryFn: async () => {
      let query = db!
        .from(table)
        .select(columns)
        .order("created_at", { ascending: sort === "oldest" })
        .range(page * 20, page * 20 + 19);
      if (searchTerm) query = query.ilike("title", `%${searchTerm}%`);
      if (status) query = query.eq("status", status);
      if (barangay) query = query.eq("barangay_id", barangay);
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
          onRetry={() => {
            void q.refetch();
            void queryClient.invalidateQueries({ queryKey: ["meeting-request-schedules"] });
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
                const canEdit = manager || (r.created_by === profile.id && r.status === "pending_review");
                const primaryNext = r.status === "pending_review" ? "published" : "pending_review";
                const primaryLabel = r.status === "pending_review" ? "Publish" : r.status === "archived" ? "Restore to review" : "Pending review";
                const otherStates = states.filter((next) => next !== r.status && next !== "draft" && next !== primaryNext);
                const dateValue = r.publish_at || r.created_at;
                const dateText = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(dateValue));
                const statusText = r.status === "published" && r.publish_at && new Date(r.publish_at).getTime() > Date.now() ? "Scheduled" : label(r.status);
                const nextLabel = (next: string) => next === "published" ? "Publish" : next === "pending_review" ? "Send for review" : "Archive";
                return (
                  <article className="panel announcement-card" key={r.id}>
                    <div className="announcement-card-top">
                      <span className={`announcement-status ${r.status}`}>{statusText}</span>
                      <time dateTime={dateValue}><CalendarDays size={14} /> {dateText}</time>
                      {manager && <details className="announcement-menu">
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
          className={table === "consultations" ? "consultation-edit-dialog" : undefined}
          icon={table === "consultations" ? <Pencil size={22} /> : undefined}
          description={table === "consultations" ? "Update the discussion details and keep your community informed." : undefined}
        >
          <form
            key={editing === "new" ? `${table}-new` : `${table}-${editing.id}`}
            className={table === "consultations" ? "consultation-edit-form" : undefined}
            onFocusCapture={(event) => {
              if (table === "consultations" && event.target.matches("input, select, textarea"))
                event.target.scrollIntoView({ block: "nearest" });
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
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
                      opens_at: new Date(String(f.get("opens"))).toISOString(),
                      closes_at: new Date(
                        String(f.get("closes")),
                      ).toISOString(),
                    }
                  : {
                      publish_at: new Date(
                        String(f.get("publish")),
                      ).toISOString(),
                      kind: f.get("kind"),
                    }),
                ...(table === "announcements" && editing === "new"
                  ? { status: "pending_review" }
                  : {}),
              };
              if (
                await run(
                  editing === "new"
                    ? db!.from(table).insert(payload)
                    : db!.from(table).update(payload).eq("id", editing.id),
                )
              )
                setEditing(null);
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
                      <select name="barangay" required defaultValue={editing === "new" ? initialBarangay || profile.barangay_id || "" : editing.barangay_id || ""}>
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
                  <div className="consultation-edit-related">
                    <input maxLength={36} name="report" pattern={UUID_PATTERN} title="Use the complete 36-character report ID." placeholder="Full report ID (optional)" value={relatedReport} onChange={(event) => setRelatedReport(event.target.value)} aria-label="Related report identifier" />
                    {relatedReport && <button type="button" className="consultation-edit-clear" aria-label="Clear related report" onClick={() => setRelatedReport("")}><X size={18} /></button>}
                  </div>
                </section>

                <section className="consultation-edit-section">
                  <div className="consultation-edit-section-heading">
                    <span className="consultation-edit-section-icon"><CalendarDays size={19} /></span>
                    <div><h3>Schedule</h3><p>Set the opening and closing dates for this consultation.</p></div>
                  </div>
                  <div className="consultation-edit-grid">
                    <label className="consultation-edit-field"><span className="consultation-edit-field-label"><span>Opens <b>*</b></span></span><input required type="datetime-local" name="opens" defaultValue={localDate(editing === "new" ? undefined : editing.opens_at)} /></label>
                    <label className="consultation-edit-field"><span className="consultation-edit-field-label"><span>Closes <b>*</b></span></span><input required type="datetime-local" name="closes" defaultValue={localDate(editing === "new" ? new Date(Date.now() + 30 * 86400000).toISOString() : editing.closes_at)} /></label>
                  </div>
                </section>
              </div>
            ) : (
              <>
                <label>
                  Title
                  <input name="title" required minLength={8} maxLength={160} defaultValue={editing === "new" ? "" : editing.title} />
                </label>
                <label>
                  Content
                  <textarea name="body" required minLength={20} maxLength={10000} defaultValue={editing === "new" ? "" : editing.body} />
                </label>
                {profile.role === "barangay" ? (
                  <label>
                    Barangay
                    <input type="hidden" name="barangay" value={profile.barangay_id ?? ""} />
                    <input value={refs.barangays.find((item) => item.id === profile.barangay_id)?.name ?? "Your assigned barangay"} readOnly />
                  </label>
                ) : (
                  <label>
                    Barangay
                    <select name="barangay" required={profile.role === "office" && !canSetCitywide} value={draftBarangay} onChange={(event) => setDraftBarangay(event.target.value)}>
                      {profile.role === "office" && !canSetCitywide ? <option value="">Choose a barangay</option> : <option value="">Citywide</option>}
                      {(profile.role === "office" ? allowedAnnouncementBarangays : refs.barangays).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                )}
                {profile.role !== "barangay" && (
                  <label>
                    Issuing office
                    <select name="organization" required={profile.role === "office"} value={profile.role === "office" ? draftOrganization : undefined} defaultValue={profile.role === "office" ? undefined : editing === "new" ? "" : editing.organization_id || ""} onChange={profile.role === "office" ? (event) => {
                      const nextOrganization = event.target.value;
                      const nextRules = access.rules.filter((rule) => rule.enabled && rule.organization_id === nextOrganization);
                      setDraftOrganization(nextOrganization);
                      setDraftBarangay((current) => current && nextRules.some((rule) => !rule.barangay_id || rule.barangay_id === current) ? current : nextRules.some((rule) => !rule.barangay_id) ? "" : nextRules.find((rule) => rule.barangay_id)?.barangay_id ?? "");
                    } : undefined}>
                      <option value="">{profile.role === "office" ? "Choose your office" : "Barangay administration"}</option>
                      {(profile.role === "office" ? announcementOrganizations : refs.organizations).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                )}
                <label>
                  Announcement type
                  <input maxLength={80} required list="announcement-kinds" name="kind" defaultValue={editing === "new" ? "General announcement" : editing.kind} />
                  <datalist id="announcement-kinds">
                    {["General announcement", "Maintenance notice", "Community cleanup", "Office advisory", "Consultation invitation", "Meeting schedule", "Repair update"].map((k) => <option key={k}>{k}</option>)}
                  </datalist>
                </label>
                <label>
                  Publication date
                  <input required name="publish" type="datetime-local" defaultValue={localDate(editing === "new" ? undefined : editing.publish_at)} />
                </label>
                <p className="fine">Published items become visible at this date. Immediate and scheduled publication send in-app updates once to eligible subscribers. Scheduled delivery is checked every minute.</p>
              </>
            )}
            {table === "announcements" && <p className="fine">
              Announcements are submitted for review and become visible to residents only after an authorized publisher publishes them.
            </p>}
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
                <div className="community-edit-actions">
                  <button disabled={busy}>{busy ? editing === "new" ? "Submitting…" : "Saving…" : editing === "new" ? "Submit for review" : "Save changes"}</button>
                </div>
                <p role="status">{message}</p>
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
          description={table === "consultations" ? "Review the consultation and follow the community discussion." : table === "meeting_requests" ? "Review and manage the meeting details." : undefined}
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
            <Meeting row={selected} refs={refs} manage={canManage(selected)} />
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
  completed: boolean;
};

function MeetingRequestsView({
  rows,
  refs,
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
  onRetry,
  onPageChange,
  onOpen,
}: {
  rows: Row[];
  refs: References;
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
          .select("id,request_id,venue,starts_at,completed")
          .in("request_id", requestIds)
          .order("starts_at"),
      ),
  });
  const scheduleByRequest = new Map(
    (meetings.data ?? []).map((meeting) => [meeting.request_id, meeting]),
  );
  const upcoming = (meetings.data ?? [])
    .filter((meeting) => !meeting.completed && new Date(meeting.starts_at).getTime() >= Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 4);
  const pending = rows.filter((row) => row.status === "pending").length;
  const approved = rows.filter((row) => row.status === "approved").length;
  const completed = (meetings.data ?? []).filter((meeting) => meeting.completed).length;
  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const statusFor = (row: Row) => {
    const schedule = scheduleByRequest.get(row.id);
    if (schedule?.completed) return { key: "completed", label: "Completed" };
    if (schedule) return { key: "scheduled", label: "Scheduled" };
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
          { title: "Total requests", count: rows.length, note: "In these results", icon: <Users />, tone: "teal" },
          { title: "Approved", count: approved, note: "Ready to coordinate", icon: <CheckCircle2 />, tone: "green" },
          { title: "Pending review", count: pending, note: "Awaiting a decision", icon: <Clock3 />, tone: "amber" },
          { title: "Scheduled", count: (meetings.data ?? []).filter((meeting) => !meeting.completed).length, note: "Dates confirmed", icon: <CalendarDays />, tone: "blue" },
          { title: "Completed", count: completed, note: "Meeting held", icon: <Check />, tone: "green" },
        ].map((metric) => (
          <article className="meeting-metric" key={metric.title}>
            <span className={`meeting-metric-icon ${metric.tone}`}>{metric.icon}</span>
            <div><span>{metric.title}</span><strong>{loading ? "—" : metric.count}</strong><small>{metric.note}</small></div>
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
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="pending">Pending review</option><option value="approved">Approved</option><option value="declined">Declined</option></select></label>
        <label><span>Date range</span><select value={dateRange} onChange={(event) => setDateRange(event.target.value)}><option value="all">All time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
        <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>

      <div className="meeting-results-heading">
        <div><h2>Meeting requests</h2><p>{loading ? "Loading requests…" : `${rows.length} ${rows.length === 1 ? "request" : "requests"} in these results`}</p></div>
        <div className="meeting-results-actions">
          <button className="secondary meeting-refresh" onClick={onRetry} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <div className="meeting-view-toggle" aria-label="Request layout">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Grid view" aria-pressed={view === "grid"}><LayoutGrid size={17} /></button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view" aria-pressed={view === "list"}><List size={18} /></button>
          </div>
        </div>
      </div>

      {error ? (
        <section className="panel meeting-empty" role="alert"><MessageSquare /><h3>Meeting requests could not load</h3><p>{error.message}</p><button onClick={onRetry}><RefreshCw size={15} /> Try again</button></section>
      ) : loading ? (
        <div className="meeting-layout"><div className={`meeting-request-grid ${view === "list" ? "is-list" : ""}`} aria-label="Loading meeting requests">{[0, 1, 2].map((item) => <div className="meeting-card meeting-card-skeleton" key={item}><span /><span /><span /><span /></div>)}</div><aside className="meeting-rail"><div className="meeting-card meeting-card-skeleton"><span /><span /><span /></div><div className="meeting-card meeting-card-skeleton"><span /><span /><span /></div></aside></div>
      ) : !rows.length ? (
        <section className="panel meeting-empty"><CalendarPlus /><h3>No meeting requests found</h3><p>Try changing the search or filters to see more requests.</p></section>
      ) : (
        <div className="meeting-layout">
          <div className="meeting-primary">
            <div className={`meeting-request-grid ${view === "list" ? "is-list" : ""}`}>
              {rows.map((row) => {
                const status = statusFor(row);
                const schedule = scheduleByRequest.get(row.id);
                const barangayName = refs.barangays.find((item) => item.id === row.barangay_id)?.name ?? "Barangay not specified";
                return (
                  <article className="meeting-card" key={row.id}>
                    <div className="meeting-card-top"><span className={`meeting-status ${status.key}`}>{statusIcon(status.key)}{status.label}</span><time dateTime={row.created_at}>{formatDate(row.created_at)}</time></div>
                    <h3>{row.title}</h3>
                    <p className="meeting-card-body">{row.body}</p>
                    <div className="meeting-card-meta"><span><MapPin size={15} />{barangayName}</span><span><CalendarDays size={15} />Requested {formatDate(row.created_at)}</span></div>
                    {schedule && <div className="meeting-schedule"><CalendarDays size={16} /><div><strong>{formatDate(schedule.starts_at)} · {new Date(schedule.starts_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</strong><span>{schedule.venue}</span></div></div>}
                    {row.decision_reason && <p className="meeting-decision">{row.decision_reason}</p>}
                    <button className="meeting-review" onClick={() => onOpen(row.id)}><FileText size={16} /> Review &amp; follow up <ChevronRight size={17} /></button>
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
                const request = rows.find((row) => row.id === meeting.request_id);
                return <button className="meeting-upcoming" key={meeting.id} onClick={() => request && onOpen(request.id)} disabled={!request}><span className="meeting-date-tile"><strong>{new Date(meeting.starts_at).toLocaleDateString("en-PH", { day: "2-digit" })}</strong><small>{new Date(meeting.starts_at).toLocaleDateString("en-PH", { month: "short" }).toUpperCase()}</small></span><span className="meeting-upcoming-copy"><strong>{request?.title ?? "Meeting request"}</strong><small>{new Date(meeting.starts_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} · {refs.barangays.find((item) => item.id === request?.barangay_id)?.name ?? "Barangay"}</small></span><ChevronRight size={16} /></button>;
              })}
            </section>
            <section className="panel meeting-rail-panel">
              <div className="meeting-rail-heading"><span className="meeting-rail-icon clock"><Clock3 size={18} /></span><div><h3>Recent requests</h3><p>Latest resident submissions</p></div></div>
              {[...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4).map((row) => <button className="meeting-recent" key={row.id} onClick={() => onOpen(row.id)}><span className={`meeting-recent-dot ${statusFor(row).key}`} /><span><strong>{row.title}</strong><small>{statusFor(row).label} · {formatDate(row.created_at)}</small></span><ChevronRight size={15} /></button>)}
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
function Meeting({
  row,
  refs,
  manage,
}: {
  row: Row;
  refs: References;
  manage: boolean;
}) {
  const { run, message, busy } = useSave();
  const q = useQuery({
    queryKey: ["meeting", row.id],
    queryFn: async () => {
      const meeting = await result<{
        id: string;
        venue: string;
        starts_at: string;
        outcome: string;
        completed: boolean;
      } | null>(
        db!.from("meetings").select("*").eq("request_id", row.id).maybeSingle(),
      );
      return {
        meeting,
        actions: meeting
          ? await result<
              {
                id: string;
                description: string;
                organization_id: string;
                due_at: string;
                completed: boolean;
              }[]
            >(
              db!
                .from("meeting_action_items")
                .select("*")
                .eq("meeting_id", meeting.id),
            )
          : [],
        participants: meeting
          ? await result<{ organization_id: string }[]>(
              db!
                .from("meeting_participants")
                .select("organization_id")
                .eq("meeting_id", meeting.id),
            )
          : [],
      };
    },
  });
  const meeting = q.data?.meeting;
  const participants = q.data?.participants || [];
  const availableOrganizations = refs.organizations.filter(
    (organization) => (organization as { active?: boolean }).active !== false && !participants.some((participant) => participant.organization_id === organization.id),
  );
  return (
    <div className="meeting-detail-workspace">
      {q.isPending ? <p className="meeting-feedback">Loading meeting details…</p> : null}
      {q.error && <p role="alert" className="meeting-feedback error">{q.error.message}</p>}
      {message && <p role="status" className="meeting-feedback success">{message}</p>}

      <section className="meeting-section meeting-overview">
        <div className="meeting-overview-main">
          <span className={`meeting-detail-status ${meeting?.completed ? "is-complete" : meeting ? "is-scheduled" : ""}`}>
            {meeting?.completed ? "Completed" : meeting ? "Scheduled" : label(row.status)}
          </span>
          <p>{row.body}</p>
        </div>
        <div className="meeting-overview-date">
          <CalendarDays size={21} aria-hidden="true" />
          <div><strong>Meeting date and time</strong><span>{meeting ? new Date(meeting.starts_at).toLocaleString() : "Not scheduled yet"}</span></div>
        </div>
      </section>

      {(row.report_id || row.decision_reason) && (
        <section className="meeting-section">
          <div className="meeting-section-heading">
            <span className="meeting-section-icon"><FileText size={20} /></span>
            <div><h3>Meeting report</h3><p>Linked report and approval context.</p></div>
          </div>
          {row.decision_reason && <p className="meeting-context-note">{row.decision_reason}</p>}
          {row.report_id && <div className="meeting-report-id"><span>Report ID</span><code>{row.report_id}</code></div>}
        </section>
      )}

      {manage && row.status === "pending" && (
        <section className="meeting-section">
          <div className="meeting-section-heading">
            <span className="meeting-section-icon is-blue"><CheckCircle2 size={20} /></span>
            <div><h3>Review meeting request</h3><p>Record a decision and explain it to the requester.</p></div>
          </div>
          <form className="meeting-form" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const status = String(f.get("status"));
            await run(db!.from("meeting_requests").update({ status, decision_reason: f.get("reason") }).eq("id", row.id));
          }}>
            <label className="meeting-field"><span>Decision</span><select name="status"><option value="approved">Approve</option><option value="declined">Decline</option></select></label>
            <label className="meeting-field"><span>Official reason</span><textarea required minLength={5} maxLength={SHORT_REASON_LIMIT} name="reason" placeholder="Explain the decision and any next steps…" aria-describedby="meeting-decision-reason-hint" /><small id="meeting-decision-reason-hint">Keep it brief. Use 5–500 characters.</small></label>
            <div className="meeting-form-actions"><button disabled={busy}>{busy ? "Saving…" : "Record decision"}</button></div>
          </form>
        </section>
      )}

      {manage && row.status === "approved" && (
        <form className="meeting-section meeting-details-form" key={meeting?.id || "new"} onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(db!.from("meetings").upsert({ request_id: row.id, venue: f.get("venue"), starts_at: new Date(String(f.get("date"))).toISOString(), outcome: f.get("outcome"), completed: f.get("completed") === "on" }, { onConflict: "request_id" }));
        }}>
          <div className="meeting-section-heading">
            <span className="meeting-section-icon"><FileText size={20} /></span>
            <div><h3>Meeting information</h3><p>Set the venue, schedule, and public summary.</p></div>
          </div>
          <div className="meeting-form-grid">
            <label className="meeting-field"><span>Venue or meeting URL <b>*</b></span><input maxLength={240} name="venue" required minLength={3} defaultValue={meeting?.venue} placeholder="Enter the venue or online meeting link" /></label>
            <label className="meeting-field"><span>Date and time <b>*</b></span><input name="date" type="datetime-local" required defaultValue={localDate(meeting?.starts_at)} /></label>
          </div>
          <label className="meeting-field"><span>Public summary and minutes</span><textarea name="outcome" maxLength={2000} defaultValue={meeting?.outcome || ""} placeholder="Write a summary, decisions, and key discussion points…" /></label>
          <label className="meeting-completed"><input name="completed" type="checkbox" defaultChecked={meeting?.completed} /><span><strong>Meeting completed</strong><small>Mark complete after the planned activities and follow-up are finished.</small></span></label>
          <div className="meeting-form-actions"><button disabled={busy}>{busy ? "Saving…" : "Save meeting details"}</button></div>
        </form>
      )}

      {meeting && (
        <>
          <section className="meeting-section">
            <div className="meeting-section-heading">
              <span className="meeting-section-icon"><Users size={20} /></span>
              <div><h3>Participating offices</h3><p>Add the offices taking part in this meeting.</p></div>
            </div>
            {participants.length ? <div className="meeting-participant-list">{participants.map((p) => (
              <div className="meeting-participant" key={p.organization_id}>
                <span className="meeting-participant-icon"><Users size={17} /></span>
                <strong>{refs.organizations.find((o) => o.id === p.organization_id)?.name || "Organization"}</strong>
                {manage && <button type="button" className="meeting-remove" aria-label="Remove participating office" disabled={busy} onClick={() => void run(db!.from("meeting_participants").delete().eq("meeting_id", meeting.id).eq("organization_id", p.organization_id))}><X size={17} /></button>}
              </div>
            ))}</div> : <p className="meeting-empty">No participating offices have been added yet.</p>}
            {manage && <form className="meeting-add-office" onSubmit={(e) => {
              e.preventDefault();
              const organizationId = new FormData(e.currentTarget).get("office");
              if (organizationId) void run(db!.from("meeting_participants").upsert({ meeting_id: meeting.id, organization_id: organizationId }));
            }}>
              <label className="meeting-field"><span>Participating office</span><select name="office" required disabled={!availableOrganizations.length}><option value="">{availableOrganizations.length ? "Select an office" : "All offices added"}</option>{availableOrganizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <button disabled={busy || !availableOrganizations.length}><Plus size={17} /> Add office</button>
            </form>}
          </section>

          <section className="meeting-section">
            <div className="meeting-section-heading">
              <span className="meeting-section-icon"><CheckCircle2 size={20} /></span>
              <div><h3>Agreed action items</h3><p>Track decisions, owners, and follow-up dates.</p></div>
            </div>
            {q.data?.actions.length ? <div className="meeting-action-list">{q.data.actions.map((a) => (
              <article className="meeting-action-item" key={a.id}>
                <span className={`meeting-action-state ${a.completed ? "is-complete" : ""}`} aria-hidden="true"><Check size={16} /></span>
                <div className="meeting-action-copy"><strong>{a.description}</strong><span>{refs.organizations.find((o) => o.id === a.organization_id)?.name || "Unassigned"}<i>·</i>{a.due_at ? new Date(`${a.due_at}T00:00:00`).toLocaleDateString() : "No target date"}</span></div>
                <span className={`meeting-action-badge ${a.completed ? "is-complete" : ""}`}>{a.completed ? "Completed" : "Open"}</span>
                {manage && <button type="button" className="meeting-action-toggle" disabled={busy} onClick={() => void run(db!.from("meeting_action_items").update({ completed: !a.completed }).eq("id", a.id))}>{a.completed ? "Reopen" : "Mark complete"}</button>}
              </article>
            ))}</div> : <p className="meeting-empty">No agreed actions recorded yet.</p>}
            {manage && <form className="meeting-form meeting-action-form" onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              if (await run(db!.from("meeting_action_items").insert({ meeting_id: meeting.id, description: f.get("description"), organization_id: f.get("office") || null, due_at: f.get("due") || null }))) form.reset();
            }}>
              <label className="meeting-field"><span>Agreed action</span><textarea name="description" required minLength={5} maxLength={2000} placeholder="Write the agreed action, decision, or finding…" /></label>
              <div className="meeting-form-grid"><label className="meeting-field"><span>Responsible office</span><select name="office"><option value="">Unassigned</option>{refs.organizations.filter(o => (o as { active?: boolean }).active !== false).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label className="meeting-field"><span>Target date</span><input name="due" type="date" /></label></div>
              <div className="meeting-form-actions"><button disabled={busy}>{busy ? "Saving…" : "Record follow-up action"}</button></div>
            </form>}
          </section>
        </>
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
        Publication: {new Date(row.publish_at!).toLocaleString()}
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
