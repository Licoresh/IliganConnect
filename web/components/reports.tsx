"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronRight, CircleCheck, Clock3, ClipboardList, Copy, Download, FileText, History, Image as ImageIcon, ListFilter, LockKeyhole, MapPin, Paperclip, RefreshCw, Save, Search, Send, SlidersHorizontal, Upload, UsersRound } from "lucide-react";
import { Report, statuses, transitions, label, UUID_PATTERN } from "@community/shared";
import { db, result } from "../lib/client";
import { DuplicateReview } from "./duplicate-review";
import { DuplicateMainProgress, LinkedDuplicateReports } from "./linked-duplicates";
import { validateImageFile } from "../lib/images";
import type { References } from "./workspace";
import { reportAction } from "../lib/access";
import { Dialog } from "./dialog";
import { downloadCsv, philippineDateBoundary } from "../lib/export";
import { useDebouncedValue } from "../lib/use-debounced-value";
import { reportCategoryPresentation, ReportCategoryLabel } from "./report-category";

export function Reports({ refs, initialRecordId = "", initialSearch = "", initialBarangay = "", initialQueue = "all", onOpenReport, onCloseReport }: {
  refs: References; initialRecordId?: string; initialSearch?: string; initialBarangay?: string; initialQueue?: string;
  onOpenReport: (id: string, queue: string) => void; onCloseReport: () => void;
}) {
  const [page, setPage] = useState(0),
    [status, setStatus] = useState(""), [search, setSearch] = useState(initialSearch),
    [category, setCategory] = useState(""), [barangay, setBarangay] = useState(initialBarangay),
    [office, setOffice] = useState(""), [since, setSince] = useState(""), [until, setUntil] = useState(""),
    [sort, setSort] = useState("newest"), [queue, setQueue] = useState(initialQueue);
  const term = useDebouncedValue(search.trim());
  const invalidDates = !!(since && until && since > until);
  const target = useQuery({
    queryKey: ["notification-report", initialRecordId], enabled: !!initialRecordId,
    queryFn: () => result<Report | null>(db!.from("reports").select("*").eq("id", initialRecordId).maybeSingle()),
  });
  const selected = target.data;
  const queueCounts = useQuery({
    queryKey: ["report-queue-counts"],
    staleTime: 30_000,
    queryFn: async () => {
      const base = () => db!.from("reports").select("id", { count: "exact", head: true });
      const responses = await Promise.all([
        base(),
        base().in("status", ["submitted", "under_review"]),
        base().eq("status", "verified"),
        base().in("status", ["assigned", "in_progress"]),
        base().eq("status", "resolved"),
      ]);
      const failed = responses.find((response) => response.error);
      if (failed?.error) throw new Error(failed.error.message);
      return Object.fromEntries(
        ["all", "review", "route", "active", "resolved"].map((key, index) => [key, responses[index].count ?? 0]),
      ) as Record<string, number>;
    },
  });
  const q = useQuery({
    queryKey: ["reports", page, status, term, category, barangay, office, since, until, sort, queue],
    enabled: !invalidDates,
    queryFn: async () => {
      let query = db!.from("reports").select("*", { count: "exact" });
      if (status) query = query.eq("status", status);
      else if (queue === "review") query = query.in("status", ["submitted", "under_review"]);
      else if (queue === "route") query = query.eq("status", "verified");
      else if (queue === "active") query = query.in("status", ["assigned", "in_progress"]);
      else if (queue === "resolved") query = query.eq("status", "resolved");
      if (term) query = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term)
        ? query.eq("id", term) : query.ilike("title", `%${term.replace(/[\\%_]/g, "\\$&")}%`);
      if (category) query = query.eq("category_id", category);
      if (barangay) query = query.eq("barangay_id", barangay);
      if (office) query = query.eq("organization_id", office);
      if (since) query = query.gte("created_at", philippineDateBoundary(since)!);
      if (until) query = query.lt("created_at", philippineDateBoundary(until, true)!);
      if (sort === "severity") query = query.order("severity", { ascending: false, nullsFirst: false });
      const { data, count, error } = await query.order("created_at", { ascending: sort === "oldest" })
        .order("id").range(page * 20, page * 20 + 19);
      if (error) throw new Error(error.message);
      return { rows: data as Report[], count: count ?? 0 };
    },
  });
  const duplicateIds = q.data?.rows.map(report => report.id) ?? [];
  const duplicateSummary = useQuery({
    queryKey: ["duplicate-summary", duplicateIds],
    enabled: !invalidDates && q.isSuccess && duplicateIds.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) => result<{ report_id: string; possible_count: number }[]>(
      db!.rpc("report_duplicate_summary", { p_ids: duplicateIds }).abortSignal(signal),
    ),
  });
  const possibleCounts = new Map(duplicateSummary.data?.map(item => [item.report_id, item.possible_count]));
  useEffect(() => {
    if (q.data) setPage((current) => Math.min(current, Math.max(0, Math.ceil(q.data.count / 20) - 1)));
  }, [q.data]);
  const clear = () => {
    setSearch(""); setStatus(""); setCategory(""); setBarangay(""); setOffice("");
    setSince(""); setUntil(""); setQueue("all"); setSort("newest"); setPage(0);
  };
  const filtered = !!(search || status || category || barangay || office || since || until || queue !== "all");
  const reportQueues = [
    ["all", "All reports", FileText],
    ["review", "Needs review", Clock3],
    ["route", "Ready to route", Send],
    ["active", "Assigned & in progress", UsersRound],
    ["resolved", "Resolved", CircleCheck],
  ] as const;
  return (
    <>
      {initialRecordId && !target.data && (
        <p className={target.error ? "error" : "notice"} role="status">
          {target.isPending ? "Opening linked report…" : target.error?.message || "This report is no longer available or is outside your current access."}
          {target.error && <button className="secondary" onClick={() => void target.refetch()}>Retry</button>}
        </p>
      )}
      <section className="report-workspace panel">
        <div className="mobile-report-queue">
          <label className="sr-only" htmlFor="mobile-report-queue">Report queue</label>
          <select id="mobile-report-queue" value={status ? "custom" : queue} onChange={(event) => { setQueue(event.target.value); setStatus(""); setPage(0); }}>
            {status && <option value="custom" disabled>Custom status: {label(status)}</option>}
            {reportQueues.map(([id, name]) => <option key={id} value={id}>{name}{queueCounts.data ? ` (${queueCounts.data[id]})` : ""}</option>)}
          </select>
        </div>
        <div className="queue-tabs" aria-label="Report queues">
          {reportQueues.map(([id, name, Icon]) => (
            <button key={id} aria-pressed={queue === id && !status} className={queue === id && !status ? "active" : ""}
              onClick={() => { setQueue(id); setStatus(""); setPage(0); }}>
              <Icon size={16} aria-hidden="true" /><span>{name}</span>
              {queueCounts.data && <span className="queue-count" aria-hidden="true">{queueCounts.data[id]}</span>}
            </button>
          ))}
        </div>
        <div className="report-search-row">
          <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Search report title or full ID</span>
            <input placeholder="Search report title or paste a full report ID" value={search} maxLength={200}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></label>
          <label className="sort-field"><ListFilter size={16} aria-hidden="true" /><span className="sr-only">Sort reports</span>
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="severity">Highest assessed severity</option>
            </select></label>
        </div>
        <details className="report-filter-panel">
          <summary><SlidersHorizontal size={16} aria-hidden="true" /><strong>Refine results</strong><span className="muted">Category, location, office &amp; date</span><ChevronDown className="filter-chevron" size={16} aria-hidden="true" /></summary>
          <div className="toolbar">
            {[
              { name: "Category", items: refs.categories, value: category, set: setCategory },
              { name: "Barangay", items: refs.barangays, value: barangay, set: setBarangay },
              { name: "Assigned office", items: refs.organizations, value: office, set: setOffice },
            ].map((f) => <label key={f.name}>{f.name}<select value={f.value} onChange={(e) => { f.set(e.target.value); setPage(0); }}>
              <option value="">All permitted</option>{f.items.map((x) => <option key={x.id} value={x.id}>{f.name === "Category" ? reportCategoryPresentation(x.name).label : x.name}</option>)}
            </select></label>)}
            <label>Status<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="">Current queue</option>{statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select></label>
            <label>Submitted from<input type="date" value={since} max={until || undefined} onChange={(e) => { setSince(e.target.value); setPage(0); }} /></label>
            <label>Submitted through<input type="date" value={until} min={since || undefined} onChange={(e) => { setUntil(e.target.value); setPage(0); }} /></label>
          </div>
        </details>
        <div className="results-heading">
          <p role="status">{invalidDates ? "Check the date range" : q.isFetching || search.trim() !== term ? "Updating results…" : `${q.data?.count ?? 0} reports in your authorized scope`}</p>
          <div className="inline-actions">
            {filtered && <button className="text-button" onClick={clear}>Clear filters</button>}
            <button className="secondary refresh-reports" disabled={q.isFetching || invalidDates} onClick={() => { void q.refetch(); if (duplicateIds.length) void duplicateSummary.refetch(); }}><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
            <button className="secondary" disabled={!q.data?.rows.length || q.isFetching || invalidDates || search.trim() !== term}
              onClick={() => downloadCsv(`iligan-reports-page-${page + 1}.csv`, [
                ["Report ID", "Title", "Category", "Barangay", "Status", "Assigned office", "Assessed severity", "Submitted (UTC)"],
                ...q.data!.rows.map((r) => [r.id, r.title, refs.categories.find((c) => c.id === r.category_id)?.name,
                  refs.barangays.find((b) => b.id === r.barangay_id)?.name, label(r.status),
                  refs.organizations.find((o) => o.id === r.organization_id)?.name, r.severity, r.created_at]),
              ])}><Download size={16} /> Export page</button>
          </div>
        </div>
        {queueCounts.error && <p className="notice" role="status">Queue totals could not load. Report search remains available.</p>}
        {!invalidDates && q.isSuccess && duplicateIds.length > 0 && (duplicateSummary.isPending || duplicateSummary.error) && <p className="duplicate-queue-status" role="status">{duplicateSummary.error ? "Duplicate indicators are unavailable. Open a report to retry its individual check." : "Checking this page for possible duplicates…"}</p>}
        {invalidDates ? <p className="error" role="alert">The end date must be on or after the start date.</p> : q.isPending ? (
          <div className="loading-stack" role="status" aria-label="Loading reports">{[1, 2, 3, 4].map((i) => <div className="skeleton" key={i} />)}</div>
        ) : q.error ? <div className="error" role="alert"><p>{q.error.message}</p><button className="secondary" onClick={() => void q.refetch()}>Try again</button></div> : q.data.rows.length ? (
          <div className="table-scroll"><table className="reports-table">
            <caption className="sr-only">Authorized community reports, page {page + 1}</caption>
            <thead><tr><th scope="col">Report</th><th scope="col">Location & category</th><th scope="col">Status</th><th scope="col">Assigned office</th><th scope="col">Received</th></tr></thead>
            <tbody>{q.data.rows.map((r) => {
              const category = refs.categories.find((c) => c.id === r.category_id)?.name || "Other";
              return <tr key={r.id}>
              <th scope="row"><button className="report-title" aria-label={`Open report: ${r.title}`} onClick={() => onOpenReport(r.id, queue)}><span>{r.title}</span><ArrowUpRight size={15} aria-hidden="true" /></button>
                <small className="record-meta">{r.id.slice(0, 8).toUpperCase()}{r.severity && ` · Severity ${r.severity}/5`}</small>
                {!duplicateSummary.error && (possibleCounts.get(r.id) ?? 0) > 0 && <button type="button" className="duplicate-queue-indicator" aria-label={`Review ${possibleCounts.get(r.id)} possible duplicates for ${r.title}`} onClick={() => onOpenReport(r.id, queue)}><Copy size={13} aria-hidden="true" /><span>Possible duplicates · {possibleCounts.get(r.id)}</span></button>}</th>
              <td data-label="Location"><span className="report-location"><MapPin size={13} aria-hidden="true" /><strong>{refs.barangays.find((b) => b.id === r.barangay_id)?.name}</strong></span>
                <ReportCategoryLabel name={category} compact className="report-category" /></td>
              <td data-label="Status"><span className={"badge " + r.status}>{label(r.status)}</span></td>
              <td data-label="Office">{refs.organizations.find((o) => o.id === r.organization_id)?.name || "Awaiting assignment"}</td>
              <td className="report-received" data-label="Received"><time dateTime={r.created_at}>{new Date(r.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}</time><button className="report-open" aria-label={`Open report: ${r.title}`} onClick={() => onOpenReport(r.id, queue)}><ChevronRight size={17} aria-hidden="true" /></button></td>
            </tr>;
            })}</tbody>
          </table></div>
        ) : <div className="empty-state"><ClipboardList size={32} /><h3>No reports found</h3><p>{filtered ? "Try a broader search or clear your filters." : "New reports in your jurisdiction will appear here."}</p>{filtered && <button className="secondary" onClick={clear}>Clear all filters</button>}</div>}
        <div className="pagination">
          <span className="muted">Page {page + 1}{q.data ? ` of ${Math.max(1, Math.ceil(q.data.count / 20))}` : ""} · 20 per page</span>
          <button className="secondary" disabled={!page || q.isFetching} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="secondary" disabled={q.isFetching || !q.data || (page + 1) * 20 >= q.data.count || invalidDates} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </section>
      <p className="fine">Dates use Philippine time. Exports contain the current page only and exclude reporter identity, private descriptions and precise coordinates.</p>
      {selected && <ReportDetail key={selected.id} report={selected} refs={refs} close={onCloseReport} onOpenLinked={(id) => onOpenReport(id, queue)} />}
    </>
  );
}
export function ReportDetail({
  report: r,
  refs,
  close,
  onOpenLinked,
}: {
  report: Report;
  refs: References;
  close: () => void;
  onOpenLinked?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>(transitions[r.status][0]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["detail", r.id],
    queryFn: async () => {
      const [problem, permissions, referralOptions, engagement, history, nearby, photos, notes, routing] = await Promise.all([
        r.problem_type ? result<{ label: string }>(db!.from("report_problem_types").select("label").eq("category_id", r.category_id).eq("code", r.problem_type).single()) : Promise.resolve(null),
        result<{
          read: boolean;
          review: boolean;
          update: boolean;
          refer: boolean;
        }>(db!.rpc("report_permissions", { p_id: r.id })),
        result<{ id: string; name: string }[]>(
          db!.rpc("referral_options", { p_id: r.id }),
        ),
        result<{ followers: number; endorsements: number }>(
          db!.rpc("report_engagement", { p_id: r.id }),
        ),
        result<
          {
            id: number;
            new_status: string;
            public_note: string;
            created_at: string;
          }[]
        >(
          db!
            .from("report_status_history")
            .select("id,new_status,public_note,created_at")
            .eq("report_id", r.id)
            .order("created_at"),
        ),
        result<
          { id: string; title: string; status: string; distance_m: number }[]
        >(db!.rpc("recurrence_candidates", { p_id: r.id })),
        (async () => {
          const files = await result<{ path: string; source_url: string | null; attribution: string | null; is_illustrative: boolean }[]>(db!.from("report_attachments").select("path,source_url,attribution,is_illustrative").eq("report_id", r.id));
          if (!files.length) return [];
          const { data, error } = await db!.storage.from("report-evidence").createSignedUrls(files.map((file) => file.path), 3600);
          return files.map((file, index) => ({ ...file, url: error ? null : data[index]?.signedUrl }));
        })(),
        result<{ id: string; body: string; created_at: string }[]>(
          db!
            .from("report_internal_notes")
            .select("id,body,created_at")
            .eq("report_id", r.id)
            .order("created_at"),
        ),
        result<{ organization_id: string; notes: string }[]>(
          db!
            .from("routing_rules")
            .select("organization_id,notes")
            .eq("category_id", r.category_id)
            .or(`barangay_id.is.null,barangay_id.eq.${r.barangay_id}`),
        ),
      ]);
      return { problem, permissions, referralOptions, engagement, history, nearby, photos, notes, routing };
    },
  });
  const nextStatuses = transitions[r.status].filter((s) => q.data?.permissions[reportAction(s)]);
  const selectedStatus = nextStatuses.includes(status as typeof r.status) ? status : nextStatuses[0] || "";
  const actionForm = useRef<HTMLFormElement>(null);
  const [canonical, setCanonical] = useState({ id: "", title: "" });
  const isSelfDuplicate = canonical.id.toLowerCase() === r.id;
  useEffect(() => {
    if (!canonical.title || selectedStatus !== "duplicate") return;
    actionForm.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    actionForm.current?.querySelector<HTMLInputElement>('input[name="duplicate"]')?.focus({ preventScroll: true });
  }, [canonical, selectedStatus]);
  const ActionStatusIcon = selectedStatus === "under_review" ? Clock3
    : ["verified", "resolved"].includes(selectedStatus) ? CircleCheck
    : selectedStatus === "assigned" ? UsersRound
    : selectedStatus === "in_progress" ? RefreshCw : ClipboardList;
  const canWrite = !!(q.data?.permissions.review || q.data?.permissions.update);
  const [uploadMessage, setUploadMessage] = useState("");
  const categoryName = refs.categories.find((category) => category.id === r.category_id)?.name || "Other";
  const category = reportCategoryPresentation(categoryName);
  const CategoryIcon = category.Icon;

  async function uploadEvidence(files: File[]) {
    if (!files.length) return;
    if (files.length > 10) { setError("Choose up to 10 photos at a time."); return; }
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) { setError("Choose JPG, PNG, or WebP photos."); return; }
    if (files.some((file) => file.size > 5 * 1024 * 1024)) { setError("Each photo must be smaller than 5 MB."); return; }
    setBusy(true);
    setError("");
    setUploadMessage("");
    let uploaded = 0;
    try {
      for (const file of files) await validateImageFile(file);
      const { data, error: authError } = await db!.auth.getUser();
      if (authError || !data.user) throw new Error("Your session expired. Sign in again and retry.");
      for (const file of files) {
        const path = `${data.user.id}/${r.id}/${crypto.randomUUID()}`;
        await result(db!.storage.from("report-evidence").upload(path, file, { contentType: file.type }));
        try {
          await result(db!.from("report_attachments").insert({ report_id: r.id, path }));
        } catch (cause) {
          await db!.storage.from("report-evidence").remove([path]);
          throw cause;
        }
        uploaded++;
      }
      setUploadMessage(`${uploaded} photo${uploaded === 1 ? "" : "s"} added to supporting evidence.`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      if (uploaded) await qc.invalidateQueries({ queryKey: ["detail", r.id] });
      setBusy(false);
    }
  }

  const history = [
    ...(q.data && !q.data.history.some((event) => event.new_status === "submitted")
      ? [{ id: -1, new_status: "submitted", public_note: "Report received by the system", created_at: r.created_at }] : []),
    ...(q.data?.history || []),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <Dialog title="Report workspace" description="View details, track progress, and record actions for this report." icon={<ClipboardList size={23} />} className="report-workspace-dialog" close={close}>
      <div className="report-workspace-content">
        <section className="report-workspace-summary">
          <span className="report-workspace-category-icon" style={{ background: category.background, color: category.foreground }}><CategoryIcon size={25} /></span>
          <div className="report-workspace-summary-copy">
            <small className="mono">{r.id}</small>
            <h3>{r.title}</h3>
            <div className="report-workspace-chips"><ReportCategoryLabel name={categoryName} /><span className={`badge ${r.status}`}>{r.status === "duplicate" ? "Linked duplicate" : label(r.status)}</span></div>
          </div>
          <p>{r.description}</p>
        </section>

        {r.status === "duplicate" && <DuplicateMainProgress reportId={r.id} onOpen={onOpenLinked} />}
        {r.status !== "duplicate" && <LinkedDuplicateReports reportId={r.id} onOpen={onOpenLinked} />}

        <section className="report-workspace-section report-document-section">
          <div className="report-workspace-section-heading"><MapPin size={22} /><div><h3>Location and classification</h3><p>Report location, issue type and responsible office.</p></div></div>
          <div className="report-workspace-location-grid">
            <div><span>Problem type</span><strong>{q.data?.problem?.label || (r.problem_type ? label(r.problem_type) : categoryName)}</strong>{r.problem_other && <small>{r.problem_other}</small>}</div>
            <div><span>Location</span><strong>{refs.barangays.find((b) => b.id === r.barangay_id)?.name || "Barangay not recorded"} · {r.latitude != null && r.longitude != null ? `${r.latitude}, ${r.longitude}` : "Coordinates unavailable"}</strong><small>{r.landmark || "Approximate report location"}</small></div>
            <div><span>{r.status === "duplicate" ? "Progress ownership" : "Assigned office"}</span><strong>{r.status === "duplicate" ? "Managed through the main report" : refs.organizations.find((o) => o.id === r.organization_id)?.name || "Awaiting assignment"}</strong></div>
          </div>
        </section>

        <section className="report-workspace-section report-photo-section report-document-section">
          <div className="report-workspace-section-heading"><ImageIcon size={22} /><div><h3>Report photos</h3><p>Review attached photographs and their source details.</p></div></div>
          {q.isPending ? <div className="report-evidence-skeleton" aria-label="Loading supporting photos"><i /><i /><i /></div> : (
            <div className="report-evidence-grid">
              {q.data?.photos.map((photo, index) => photo.url ? (
                <figure className="report-evidence-item" key={photo.path}><a className="report-evidence-photo" href={photo.url} target="_blank" rel="noreferrer" aria-label={`Open report photo ${index + 1}`}>
                  <img src={photo.url} alt={`Photo ${index + 1} for ${r.title}`} loading="lazy" />
                  <span>Photo {index + 1}</span>
                </a>{photo.attribution && <figcaption>{photo.attribution}{photo.source_url?.startsWith("https://") && <a href={photo.source_url} target="_blank" rel="noreferrer">View original source</a>}</figcaption>}</figure>
              ) : <div className="report-evidence-unavailable" key={photo.path}><ImageIcon size={22} /><span>Photo preview unavailable</span></div>)}
              {q.data && q.data.photos.length === 0 && <div className="report-evidence-empty"><ImageIcon size={21} /><span>No supporting photos yet</span><small>Add a photo if it helps document this report.</small></div>}
              {canWrite && <label className={`report-evidence-add${busy ? " disabled" : ""}`}>
                <Upload size={24} /><strong>{busy ? "Uploading…" : "Add more photos"}</strong><small>JPG, PNG, or WebP · up to 5 MB each</small>
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Add supporting evidence photos" disabled={busy} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void uploadEvidence(files); }} />
              </label>}
            </div>
          )}
          {uploadMessage && <p className="report-upload-success" role="status">{uploadMessage}</p>}
        </section>

        <section className="report-workspace-section report-community-context report-document-section">
          <div className="report-workspace-section-heading"><UsersRound size={22} /><div><h3>Community context</h3><p>{q.data?.engagement.followers ?? 0} followers · {q.data?.engagement.endorsements ?? 0} residents report the same experience.</p><small>Participation counts provide context; they are not additional verified defects.</small></div></div>
        </section>

        {r.status !== "duplicate" && r.status !== "rejected" && <DuplicateReview report={r} canChoose={nextStatuses.includes("duplicate")} selectedId={canonical.id} onChoose={(candidate) => { setCanonical(candidate); setStatus("duplicate"); }} />}

        {q.data?.nearby.length ? <section className="report-workspace-section report-document-section">
          <div className="report-workspace-section-heading"><MapPin size={22} /><div><h3>Related reports for review</h3><p>Nearby reports are recurrence candidates and need human assessment.</p></div></div>
          <div className="report-related-list">{q.data.nearby.map((item) => <div key={item.id}><strong>{item.title}</strong><span>{Math.round(item.distance_m)} m away · {label(item.status)}</span><small className="mono">{item.id}</small></div>)}</div>
        </section> : null}

        <section className="report-workspace-section report-document-section">
          <div className="report-workspace-section-heading"><History size={22} /><div><h3>{r.status === "duplicate" ? "Submission history" : "Recorded history"}</h3><p>{r.status === "duplicate" ? "History of this submission and its duplicate link. Current progress is shown on the main report above." : "Updates recorded as this report moved through the response process."}</p></div></div>
          {q.isPending ? <p className="report-workspace-muted">Loading report history…</p> : <ol className="report-history-list">{history.map((event) => {
            const state = event.new_status;
            const EventIcon = state === "resolved" ? CircleCheck : ["assigned", "in_progress"].includes(state) ? UsersRound : state === "verified" ? Check : state === "submitted" ? FileText : Clock3;
            return <li className={`report-history-event ${state}`} key={event.id}>
              <span className="report-history-icon"><EventIcon size={16} /></span>
              <div><strong>{label(state)}</strong><small>{event.public_note || (state === "submitted" ? "Report received by the system" : "Authorized action recorded")}</small></div>
              <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}</time>
            </li>;
          })}</ol>}
        </section>

        {q.error && <p role="alert" className="error">{q.error.message}</p>}
        {error && <p role="alert" className="error">{error}</p>}

        {nextStatuses.length > 0 && <section className="report-workspace-section report-action-section">
          <div className="report-workspace-section-heading"><span className="report-action-heading-icon"><FileText size={24} aria-hidden="true" /></span><div><h3>Record an action</h3><p>Update the case and leave a note visible to the resident.</p></div></div>
          <form ref={actionForm} className="report-action-form" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            if (selectedStatus === "duplicate" && String(form.get("duplicate")).toLowerCase() === r.id) {
              const input = event.currentTarget.elements.namedItem("duplicate") as HTMLInputElement;
              input.focus();
              return;
            }
            setBusy(true); setError("");
            try {
              await result(db!.rpc("change_report", {
                p_id: r.id, p_status: selectedStatus, p_note: form.get("note"),
                p_organization: form.get("office") || null,
                p_severity: form.get("severity") ? Number(form.get("severity")) : null,
                p_duplicate: form.get("duplicate") || null,
                p_public_summary: form.get("summary") || null,
              }));
              await qc.invalidateQueries(); close();
            } catch (cause) { setError((cause as Error).message); }
            finally { setBusy(false); }
          }}>
            <label className="report-action-status-field"><span>Next status <span className="report-action-required" aria-hidden="true">*</span></span><span className="report-action-status-control"><ActionStatusIcon className="report-action-status-icon" data-status={selectedStatus} size={20} aria-hidden="true" /><select required value={selectedStatus} onChange={(event) => setStatus(event.target.value)}>{nextStatuses.map((next) => <option key={next} value={next}>{label(next)}</option>)}</select></span></label>
            <label className="report-action-note"><span>{selectedStatus === "duplicate" ? "Reason for linking these reports" : "Public action note / resolution details"} <span className="report-action-required" aria-hidden="true">*</span></span><textarea name="note" required minLength={5} maxLength={4000} aria-describedby="report-action-note-hint" placeholder={selectedStatus === "duplicate" ? "Explain how the location, problem, and evidence describe the same incident…" : "Write the update, actions taken, or resolution details…"} /></label>
            <small id="report-action-note-hint" className="report-action-note-hint">5–4,000 characters.</small>
            {selectedStatus === "assigned" && <>
              {!q.data?.routing.length && <p className="routing-guidance-empty" role="status">No routing guidance is configured for this category and barangay. Choose an eligible office using your approved local responsibilities, then explain the handoff in the public note.</p>}
              {!q.data?.referralOptions.length && <p className="notice route-warning" role="status">No eligible office is configured for this report. An administrator must enable the correct category and barangay access before it can be routed.</p>}
              {q.data?.routing.map((rule, index) => <p key={index} className="notice">Routing guidance: {refs.organizations.find((o) => o.id === rule.organization_id)?.name}. {rule.notes}</p>)}
              <label>Responsible organization<select name="office" required defaultValue={r.organization_id || ""}><option value="">Select organization</option>{q.data?.referralOptions.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
            </>}
            {selectedStatus === "verified" && <>
              <label>Assessed severity (1–5)<input name="severity" type="number" min="1" max="5" required /></label>
              <label>Moderated public summary (optional)<textarea name="summary" maxLength={160} placeholder="Exclude names and residential details." /></label>
              <p className="report-form-hint">A summary publishes a rounded map location.</p>
            </>}
            {selectedStatus === "duplicate" && <label>Main report ID<small id="duplicate-main-hint">Choose a suggestion above, or enter the complete 36-character report ID.</small>{canonical.title && <span className="duplicate-selected-original" role="status">Selected main report: <strong>{canonical.title}</strong>. Review your reason before saving.</span>}<input maxLength={36} name="duplicate" required pattern={UUID_PATTERN} title="Use the complete 36-character report ID." list="canonical-reports" aria-invalid={isSelfDuplicate || undefined} aria-describedby={`duplicate-main-hint${isSelfDuplicate ? " duplicate-main-error" : ""}`} value={canonical.id} onChange={(event) => setCanonical({ id: event.target.value, title: "" })} />{isSelfDuplicate && <p id="duplicate-main-error" className="field-validation-message" role="alert">Choose a different main report. A report cannot be linked to itself.</p>}<datalist id="canonical-reports">{q.data?.nearby.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</datalist></label>}
            <div className="report-action-footer"><button type="submit" className="report-workspace-primary" disabled={busy || (selectedStatus === "assigned" && !q.data?.referralOptions.length)}><Save size={18} aria-hidden="true" />{busy ? "Saving…" : "Save recorded action"}</button></div>
          </form>
        </section>}
        {!nextStatuses.length && !q.isPending && <section className="report-workspace-section report-document-section"><div className="report-workspace-section-heading"><LockKeyhole size={22} /><div><h3>View-only access</h3><p>Your current permissions allow viewing this report. No status actions are available.</p></div></div></section>}

        <section className="report-workspace-section report-document-section">
          <div className="report-workspace-section-heading"><LockKeyhole size={22} /><div><h3>Private staff notes</h3><p>Visible only to authorized staff. Public action notes above are shared with the resident.</p></div></div>
          {q.data?.notes.length ? q.data.notes.map((note) => <article className="report-private-note" key={note.id}><p>{note.body}</p><time dateTime={note.created_at}>{new Date(note.created_at).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}</time></article>) : <p className="report-workspace-muted">No private staff notes yet.</p>}
          {canWrite && <form className="report-private-note-form" onSubmit={async (event) => {
            event.preventDefault(); const form = event.currentTarget; setBusy(true); setError("");
            try {
              await result(db!.from("report_internal_notes").insert({ report_id: r.id, body: new FormData(form).get("body") }));
              form.reset(); await qc.invalidateQueries({ queryKey: ["detail", r.id] });
            } catch (cause) { setError((cause as Error).message); }
            finally { setBusy(false); }
          }}><label htmlFor={`private-note-${r.id}`}>Add a private note<textarea id={`private-note-${r.id}`} name="body" required minLength={5} maxLength={4000} placeholder="Write an internal note…" /></label><button disabled={busy}>{busy ? "Saving…" : "Save private note"}</button></form>}
        </section>
        <p className="report-workspace-footnote"><Paperclip size={14} /> Supporting evidence is stored in the secured report-evidence bucket. Images remain attached to the report.</p>
      </div>
    </Dialog>
  );
}
