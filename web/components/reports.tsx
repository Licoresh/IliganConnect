"use client";
import { useEffect, useRef, useState } from "react";
import { withTitle, withTitles } from "../lib/report-title";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, MessageSquareQuote, CalendarDays, Camera, Check, ChevronDown, ChevronRight, CircleCheck, CircleX, ClipboardCheck, Clock3, ClipboardList, Copy, Download, FilePlus2, FileText, History, Image as ImageIcon, ListFilter, LockKeyhole, MapPin, Paperclip, RefreshCw, Save, Send, SlidersHorizontal, Upload, UsersRound } from "lucide-react";
import { Report, statuses, transitions, label, hasReportCoordinates, reportAssessmentSchema, reportScheduleDayReached, reportScheduleLabel, reportStatusDescription, reportStatusLabel, textInputError, type Status } from "@community/shared";
import { db, result } from "../lib/client";
import { openReportFromRow } from "../lib/report-row";
import { DuplicateReview, type DuplicateCandidateOption } from "./duplicate-review";
import { DuplicateMainProgress, LinkedDuplicateReports } from "./linked-duplicates";
import { validateImageFile } from "../lib/images";
import type { References } from "./workspace";
import { permissionFingerprint, reportAction } from "../lib/access";
import { Dialog } from "./dialog";
import { downloadCsv, philippineDateBoundary } from "../lib/export";
import { useDebouncedValue } from "../lib/use-debounced-value";
import { reportCategoryPresentation, ReportCategoryLabel } from "./report-category";
import { reportLocalAddress } from "../lib/report-location";
import { AssessmentFields, focusField, ReportAssessment } from "./report-assessment";
import { ReportHandling, useReportResidents } from "./report-handling";
import { useAccess } from "./access-context";
import { WalkInReport } from "./walk-in-report";
import { ReportThumb, useReportListPhotos } from "./report-photos";
import { WalkInLocationMap, type WalkInPin } from "./walk-in-location-map";

function manilaDateTimeInput(value: string | null = null) {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function defaultScheduleDateTimeInput() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "0";
  const nextMorning = new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day")) + 1, 1));
  return manilaDateTimeInput(nextMorning.toISOString());
}

function manilaDateTime(value: string) {
  const date = new Date(`${value}:00+08:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function Reports({ refs, initialRecordId = "", initialSearch = "", initialBarangay = "", initialQueue = "all", onOpenReport, onCloseReport }: {
  refs: References; initialRecordId?: string; initialSearch?: string; initialBarangay?: string; initialQueue?: string;
  onOpenReport: (id: string, queue: string) => void; onCloseReport: () => void;
}) {
  const access = useAccess();
  const officeView = access.profile.role === "office";
  const officeOrganizationIds = officeView ? access.organizations.filter((organization) => organization.active).map((organization) => organization.id) : [];
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [page, setPage] = useState(0),
    [status, setStatus] = useState(""), [search, setSearch] = useState(initialSearch),
    [category, setCategory] = useState(""), [barangay, setBarangay] = useState(initialBarangay),
    [office, setOffice] = useState(""), [since, setSince] = useState(""), [until, setUntil] = useState(""),
    [sort, setSort] = useState("newest"), [queue, setQueue] = useState(officeView ? initialQueue === "resolved" ? "resolved" : "ready" : initialQueue),
    [activeCaseStage, setActiveCaseStage] = useState<"ongoing" | "forwarded">("ongoing");
  const term = useDebouncedValue(search.trim());
  const invalidDates = !!(since && until && since > until);
  const target = useQuery({
    queryKey: ["notification-report", initialRecordId, officeOrganizationIds, permissionFingerprint(access)], enabled: !!initialRecordId,
    queryFn: async () => {
      let query = db!.from("reports").select("*").eq("id", initialRecordId);
      if (officeView) query = officeOrganizationIds.length
        ? query.in("organization_id", officeOrganizationIds).in("status", ["assigned", "scheduled", "in_progress", "resolved"])
        : query.eq("id", "00000000-0000-0000-0000-000000000000");
      return result<Report | null>(query.maybeSingle()).then((row) => row && withTitle(row));
    },
  });
  const selected = target.data;
  const queueCounts = useQuery({
    queryKey: ["report-queue-counts", officeView, officeOrganizationIds, permissionFingerprint(access)],
    staleTime: 30_000,
    queryFn: async () => {
      const base = () => db!.from("reports").select("id", { count: "exact", head: true });
      if (officeView) {
        if (!officeOrganizationIds.length) return { ready: 0, resolved: 0 };
        const responses = await Promise.all([
          base().in("organization_id", officeOrganizationIds).in("status", ["assigned", "scheduled", "in_progress"]),
          base().in("organization_id", officeOrganizationIds).eq("status", "resolved"),
        ]);
        const failed = responses.find((response) => response.error);
        if (failed?.error) throw new Error(failed.error.message);
        return { ready: responses[0].count ?? 0, resolved: responses[1].count ?? 0 };
      }
      const responses = await Promise.all([
        base(),
        base().in("status", ["submitted", "under_review"]),
        base().eq("status", "verified"),
        base().in("status", ["assigned", "scheduled", "in_progress"]),
        base().in("status", ["scheduled", "in_progress"]).is("organization_id", null),
        base().in("status", ["assigned", "scheduled", "in_progress"]).not("organization_id", "is", null),
        base().eq("status", "resolved"),
      ]);
      const failed = responses.find((response) => response.error);
      if (failed?.error) throw new Error(failed.error.message);
      return Object.fromEntries(
        ["all", "review", "route", "active", "ongoing", "forwarded", "resolved"].map((key, index) => [key, responses[index].count ?? 0]),
      ) as Record<string, number>;
    },
  });
  const q = useQuery({
    queryKey: ["reports", page, status, term, category, barangay, office, since, until, sort, queue, queue === "active" ? activeCaseStage : "", officeOrganizationIds],
    enabled: !invalidDates,
    queryFn: async () => {
      let query = db!.from("reports").select("*", { count: "exact" });
      if (officeView) {
        query = officeOrganizationIds.length
          ? query.in("organization_id", officeOrganizationIds)
          : query.eq("id", "00000000-0000-0000-0000-000000000000");
        query = queue === "resolved" ? query.eq("status", "resolved") : query.in("status", ["assigned", "scheduled", "in_progress"]);
      } else {
        if (queue === "review") query = query.in("status", ["submitted", "under_review"]);
        else if (queue === "route") query = query.eq("status", "verified");
        else if (queue === "active") query = query.in("status", ["assigned", "scheduled", "in_progress"]);
        else if (queue === "resolved") query = query.eq("status", "resolved");
        if (queue === "active") query = activeCaseStage === "forwarded"
          ? query.not("organization_id", "is", null)
          : query.is("organization_id", null);
      }
      if (status) query = query.eq("status", status);
      if (term) query = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term)
        ? query.eq("id", term) : query.ilike("title", `%${term.replace(/[\\%_]/g, "\\$&")}%`);
      if (category) query = query.eq("category_id", category);
      if (barangay) query = query.eq("barangay_id", barangay);
      if (office) query = query.eq("organization_id", office);
      if (since) query = query.gte("created_at", philippineDateBoundary(since)!);
      if (until) query = query.lt("created_at", philippineDateBoundary(until, true)!);
      if (sort === "status") query = query.order("status", { ascending: true });
      if (sort === "severity" || sort === "urgency") query = query.order(sort, { ascending: false, nullsFirst: false });
      const { data, count, error } = await query.order("created_at", { ascending: sort === "oldest" })
        .order("id").range(page * 20, page * 20 + 19);
      if (error) throw new Error(error.message);
      return { rows: withTitles(data as Report[]), count: count ?? 0 };
    },
  });
  const residents = useReportResidents(q.data?.rows.map(row => row.id) || []);
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
  const listPhotos = useReportListPhotos(q.isSuccess ? duplicateIds : []);
  // Queue tabs overflow on narrow screens: touch swipes natively; mouse users get wheel and drag scrolling.
  const queueTabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = queueTabs.current;
    if (!row) return;
    let startX = 0, startScroll = 0, dragging = false, moved = false;
    const wheel = (event: WheelEvent) => {
      if (row.scrollWidth <= row.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const max = row.scrollWidth - row.clientWidth;
      if ((event.deltaY < 0 && row.scrollLeft <= 0) || (event.deltaY > 0 && row.scrollLeft >= max - 1)) return;
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || row.scrollWidth <= row.clientWidth) return;
      dragging = true; moved = false; startX = event.clientX; startScroll = row.scrollLeft;
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const distance = event.clientX - startX;
      if (Math.abs(distance) > 5) moved = true;
      if (moved) row.scrollLeft = startScroll - distance;
    };
    const up = () => { dragging = false; };
    const click = (event: MouseEvent) => { if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; } };
    row.addEventListener("wheel", wheel, { passive: false });
    row.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    row.addEventListener("click", click, true);
    return () => {
      row.removeEventListener("wheel", wheel);
      row.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      row.removeEventListener("click", click, true);
    };
  }, []);
  useEffect(() => {
    if (q.data) setPage((current) => Math.min(current, Math.max(0, Math.ceil(q.data.count / 20) - 1)));
  }, [q.data]);
  const clear = () => {
    setSearch(""); setStatus(""); setCategory(""); setBarangay(""); setOffice("");
    setSince(""); setUntil(""); setQueue(officeView ? "ready" : "all"); setActiveCaseStage("ongoing"); setSort("newest"); setPage(0);
  };
  const filtered = !!(search || status || category || barangay || office || since || until || queue !== (officeView ? "ready" : "all"));
  const reportQueues = officeView ? [
    ["ready", "Ready for action", Send],
    ["resolved", "Resolved", CircleCheck],
  ] as const : [
    ["all", "All reports", FileText],
    ["review", "Needs review", Clock3],
    ["route", "Ready for action", Send],
    ["active", "Active cases", UsersRound],
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
          <select id="mobile-report-queue" value={!officeView && status ? "custom" : queue} onChange={(event) => { setQueue(event.target.value); if (event.target.value === "active") setActiveCaseStage("ongoing"); setStatus(""); setPage(0); }}>
            {!officeView && status && <option value="custom" disabled>Custom status: {label(status)}</option>}
            {reportQueues.map(([id, name]) => <option key={id} value={id}>{name}{queueCounts.data ? ` (${queueCounts.data[id]})` : ""}</option>)}
          </select>
        </div>
        <div className="queue-tabs" aria-label="Report queues" ref={queueTabs}>
          {reportQueues.map(([id, name, Icon]) => (
            <button key={id} aria-pressed={queue === id && (officeView || !status)} className={queue === id && (officeView || !status) ? "active" : ""}
              onClick={() => { setQueue(id); if (id === "active") setActiveCaseStage("ongoing"); setStatus(""); setPage(0); }}>
              <Icon size={16} aria-hidden="true" /><span>{name}</span>
              {queueCounts.data && <span className="queue-count" aria-hidden="true">{queueCounts.data[id]}</span>}
            </button>
          ))}
        </div>
        {!officeView && queue === "active" && !status && <div className="active-case-stages" aria-label="Active case stage">
          <div className="active-case-stages-copy"><strong>Active cases</strong><span>Choose the current handoff stage.</span></div>
          <div className="active-case-stage-tabs" role="group" aria-label="Filter active cases">
            <button type="button" aria-pressed={activeCaseStage === "ongoing"} className={activeCaseStage === "ongoing" ? "active" : ""} onClick={() => { setActiveCaseStage("ongoing"); setPage(0); }}>
              <span>Ongoing</span><small>Barangay team · scheduled or in progress</small><b>{queueCounts.data?.ongoing ?? "—"}</b>
            </button>
            <button type="button" aria-pressed={activeCaseStage === "forwarded"} className={activeCaseStage === "forwarded" ? "active" : ""} onClick={() => { setActiveCaseStage("forwarded"); setPage(0); }}>
              <span>Forwarded</span><small>Assigned to an office</small><b>{queueCounts.data?.forwarded ?? "—"}</b>
            </button>
          </div>
        </div>}
        <div className="report-search-row">
          <label className="search-field staff-search-field"><span className="sr-only">Search report title or full ID</span>
            <input placeholder="Search report title or paste a full report ID" value={search} maxLength={200}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></label>
          <label className="sort-field"><ListFilter size={16} aria-hidden="true" /><span className="sr-only">Sort reports</span>
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="status">Status, then newest</option><option value="severity">Highest assessed severity</option><option value="urgency">Highest assessed urgency</option>
            </select></label>
        </div>
        <details className="report-filter-panel">
          <summary><SlidersHorizontal size={16} aria-hidden="true" /><strong>Refine results</strong><span className="muted">Category, location, office, status &amp; date</span><ChevronDown className="filter-chevron" size={16} aria-hidden="true" /></summary>
          <div className="toolbar">
            {[
              { name: "Category", items: officeView ? refs.categories.filter((item) => access.rules.some((rule) => rule.enabled && rule.category_id === item.id && officeOrganizationIds.includes(rule.organization_id))) : refs.categories, value: category, set: setCategory },
              { name: "Barangay", items: refs.barangays.filter((item) => !officeView || access.rules.some((rule) => rule.enabled && officeOrganizationIds.includes(rule.organization_id) && (!rule.barangay_id || rule.barangay_id === item.id))), value: barangay, set: setBarangay },
              { name: "Assigned office", items: officeView ? refs.organizations.filter((item) => officeOrganizationIds.includes(item.id)) : refs.organizations, value: office, set: setOffice },
            ].map((f) => <label key={f.name}>{f.name}<select value={f.value} onChange={(e) => { f.set(e.target.value); setPage(0); }}>
              <option value="">All permitted</option>{f.items.map((x) => <option key={x.id} value={x.id}>{f.name === "Category" ? reportCategoryPresentation(x.name).label : x.name}</option>)}
            </select></label>)}
            <label>Status<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="">{officeView ? "All statuses" : "Current queue"}</option>{(officeView ? (queue === "resolved" ? ["resolved"] : ["assigned", "scheduled", "in_progress"]) as Status[] : statuses).map((s) => <option key={s} value={s}>{officeView ? reportStatusLabel(s) : label(s)}</option>)}
            </select></label>
            <label>Submitted from<input type="date" value={since} max={until || undefined} onChange={(e) => { setSince(e.target.value); setPage(0); }} /></label>
            <label>Submitted through<input type="date" value={until} min={since || undefined} onChange={(e) => { setUntil(e.target.value); setPage(0); }} /></label>
          </div>
        </details>
        <div className="results-heading">
          <p role="status">{invalidDates ? "Check the date range" : q.isFetching || search.trim() !== term ? "Updating results…" : `${q.data?.count ?? 0} reports in your authorized scope`}</p>
          <div className="inline-actions">
            {access.profile.role === "barangay" && access.profile.barangay_id && <button type="button" className="walk-in-new-button" onClick={() => setWalkInOpen(true)}><FilePlus2 size={16} aria-hidden="true" />Record walk-in report</button>}
            {filtered && <button className="text-button" onClick={clear}>Clear filters</button>}
            <button className="secondary refresh-reports" disabled={q.isFetching || invalidDates} onClick={() => { void q.refetch(); if (duplicateIds.length) void duplicateSummary.refetch(); }}><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
            <button className="secondary" disabled={!q.data?.rows.length || q.isFetching || invalidDates || search.trim() !== term}
              onClick={() => downloadCsv(`iligan-reports-page-${page + 1}.csv`, [
                ["Report ID", "Title", "Category", "Barangay", "Status", "Assigned office", "Assessed severity", "Assessed urgency", "Submitted (UTC)"],
                ...q.data!.rows.map((r) => [r.id, r.title, refs.categories.find((c) => c.id === r.category_id)?.name,
                  refs.barangays.find((b) => b.id === r.barangay_id)?.name, reportStatusLabel(r.status),
                  refs.organizations.find((o) => o.id === r.organization_id)?.name, r.severity, r.urgency, r.created_at]),
              ])}><Download size={16} /> Export page</button>
          </div>
        </div>
        {queueCounts.error && <p className="notice" role="status">Queue totals could not load. Report search remains available.</p>}
        {!invalidDates && q.isSuccess && duplicateIds.length > 0 && (duplicateSummary.isPending || duplicateSummary.error) && <p className="duplicate-queue-status" role="status">{duplicateSummary.error ? "Duplicate indicators are unavailable. Open a report to retry its individual check." : "Checking this page for possible duplicates…"}</p>}
        {invalidDates ? <p className="error" role="alert">The end date must be on or after the start date.</p> : q.isPending ? (
          <div className="loading-stack" role="status" aria-label="Loading reports">{[1, 2, 3, 4].map((i) => <div className="skeleton" key={i} />)}</div>
        ) : q.error ? <div className="error" role="alert"><p>{q.error.message}</p><button className="secondary" onClick={() => void q.refetch()}>Try again</button></div> : q.data.rows.length ? (<>
          <ul className="report-card-list" aria-label={`Authorized community reports, page ${page + 1}`}>{q.data.rows.map((r) => {
            const category = refs.categories.find((c) => c.id === r.category_id)?.name || "Other";
            const photoCount = listPhotos.data?.counts.get(r.id) ?? 0;
            const barangayName = refs.barangays.find((b) => b.id === r.barangay_id)?.name || "Iligan City";
            const duplicates = duplicateSummary.error ? 0 : possibleCounts.get(r.id) ?? 0;
            return <li key={r.id}><button type="button" className="report-card" onClick={() => onOpenReport(r.id, queue)} aria-label={`Open report: ${r.title}`}>
              <ReportThumb className="report-card-thumb" url={listPhotos.data?.urls.get(r.id)} categoryName={category}>
                {hasReportCoordinates(r) && <span className="report-card-pin" title="Has a map pin"><MapPin size={12} aria-hidden="true" /></span>}
              </ReportThumb>
              <span className="report-card-body">
                <span className="report-card-chips"><ReportCategoryLabel name={category} compact /><span className={`badge ${r.status}`}>{reportStatusLabel(r.status)}</span></span>
                <strong className="report-card-title">{r.title}</strong>
                <span className="report-card-meta">
                  <span><CalendarDays size={13} aria-hidden="true" />{new Date(r.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })} · {barangayName}{reportLocalAddress(r) ? ` · ${reportLocalAddress(r)}` : ""}</span>
                  {photoCount > 0 && <span className="report-card-photos"><ImageIcon size={13} aria-hidden="true" />{photoCount} {photoCount === 1 ? "photo" : "photos"}</span>}
                  {duplicates > 0 && <span className="report-card-duplicates"><Copy size={12} aria-hidden="true" />{duplicates} possible {duplicates === 1 ? "duplicate" : "duplicates"}</span>}
                </span>
              </span>
            </button></li>;
          })}</ul>
          <div className="table-scroll">
            <div className="reports-table-head" aria-hidden="true"><span>Report</span><span>Location &amp; category</span><span>Resident / reporter</span><span>Status</span><span>Assigned office</span><span>Received</span></div>
            <table className="reports-table">
            <caption className="sr-only">Authorized community reports, page {page + 1}</caption>
            <colgroup><col style={{ width: "28%" }} /><col style={{ width: "22%" }} /><col style={{ width: "11%" }} /><col style={{ width: "18%" }} /><col style={{ width: "13%" }} /><col style={{ width: "8%" }} /></colgroup>
            <thead className="sr-only"><tr><th scope="col">Report</th><th scope="col">Location &amp; category</th><th scope="col">Resident / reporter</th><th scope="col">Status</th><th scope="col">Assigned office</th><th scope="col">Received</th></tr></thead>
            <tbody>{q.data.rows.map((r) => {
              const category = refs.categories.find((c) => c.id === r.category_id)?.name || "Other";
              const person = residents.data?.find((item) => item.report_id === r.id);
              const walkIn = r.submission_source === "walk_in";
              return <tr key={r.id} className="report-row-clickable" onClick={(event) => openReportFromRow(event, () => onOpenReport(r.id, queue))}>
              <th scope="row"><div className="report-table-cell">
                <ReportThumb className="report-table-thumb" url={listPhotos.data?.urls.get(r.id)} categoryName={category} />
                <div className="report-table-cell-copy"><button className="report-title" aria-label={`Open report: ${r.title}`} onClick={() => onOpenReport(r.id, queue)}><span>{r.title}</span><ArrowUpRight size={15} aria-hidden="true" /></button>
                <small className="record-meta">{r.id.slice(0, 8).toUpperCase()}{r.severity && ` · Severity ${r.severity}/5`}{r.urgency && ` · Urgency ${r.urgency}/5`}</small>
                {!duplicateSummary.error && (possibleCounts.get(r.id) ?? 0) > 0 && <button type="button" className="duplicate-queue-indicator" aria-label={`Review ${possibleCounts.get(r.id)} possible duplicates for ${r.title}`} onClick={() => onOpenReport(r.id, queue)}><Copy size={12} aria-hidden="true" /><span>{possibleCounts.get(r.id)} possible {possibleCounts.get(r.id) === 1 ? "duplicate" : "duplicates"}</span></button>}</div></div></th>
              <td data-label="Location"><span className="report-location"><MapPin size={13} aria-hidden="true" /><strong>{refs.barangays.find((b) => b.id === r.barangay_id)?.name}</strong></span>
                {reportLocalAddress(r) && <small className="record-meta">{reportLocalAddress(r)}</small>}
                <ReportCategoryLabel name={category} compact className="report-category" /></td>
              <td data-label={walkIn ? "Reporter" : "Resident"}>{person?.resident_name || (residents.isPending ? "Loading…" : residents.error ? "Details unavailable" : walkIn ? "Walk-in report" : "Resident")}<small className="record-meta">{walkIn ? `Walk-in · Recorded by ${person?.created_by_name || "barangay staff"}` : refs.barangays.find(b => b.id === person?.registered_barangay_id)?.name || "Barangay not recorded"}</small></td><td data-label="Status"><span className={"badge " + r.status}>{reportStatusLabel(r.status)}</span></td>
              <td data-label="Office">{refs.organizations.find((o) => o.id === r.organization_id)?.name || "Barangay team"}</td>
              <td className="report-received" data-label="Received"><time dateTime={r.created_at}>{new Date(r.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}</time><button className="report-open" aria-label={`Open report: ${r.title}`} onClick={() => onOpenReport(r.id, queue)}><ChevronRight size={17} aria-hidden="true" /></button></td>
            </tr>;
            })}</tbody>
          </table></div>
        </>) : <div className="empty-state"><ClipboardList size={32} /><h3>{queue === "active" && !status ? `No ${activeCaseStage} cases` : "No reports found"}</h3><p>{queue === "active" && !status && !(search || category || barangay || office || since || until)
          ? activeCaseStage === "ongoing" ? "Scheduled and in-progress cases in your authorized scope will appear here." : "Cases assigned to offices in your authorized scope will appear here."
          : filtered ? "Try a broader search or clear your filters." : "New reports in your jurisdiction will appear here."}</p>{filtered && <button className="secondary" onClick={clear}>Clear all filters</button>}</div>}
        <div className="pagination">
          <span className="muted">Page {page + 1}{q.data ? ` of ${Math.max(1, Math.ceil(q.data.count / 20))}` : ""} · 20 per page</span>
          <button className="secondary" disabled={!page || q.isFetching} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="secondary" disabled={q.isFetching || !q.data || (page + 1) * 20 >= q.data.count || invalidDates} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </section>
      <p className="fine">Dates use Philippine time. Exports contain the current page only and exclude reporter identity, private descriptions and precise coordinates.</p>
      {selected && <ReportDetail key={selected.id} report={selected} refs={refs} close={onCloseReport} onOpenLinked={(id) => onOpenReport(id, queue)} startOnProgress={!status && (queue === "active" || queue === "route" || (officeView && queue === "ready"))} />}
      {walkInOpen && access.profile.role === "barangay" && access.profile.barangay_id && <WalkInReport refs={refs} barangayId={access.profile.barangay_id} onClose={() => setWalkInOpen(false)} onCreated={(id) => { setWalkInOpen(false); onOpenReport(id, "review"); }} />}
    </>
  );
}
export function ReportDetail({
  report: r,
  refs,
  close,
  onOpenLinked,
  readOnly = false,
  startOnProgress = false,
}: {
  report: Report;
  refs: References;
  close: () => void;
  onOpenLinked?: (id: string) => void;
  readOnly?: boolean;
  /** Opened from Ready for action / Active cases: land on Status & progress when that tab is usable. */
  startOnProgress?: boolean;
}) {
  const qc = useQueryClient();
  const access = useAccess();
  const reviewPending = r.status === "submitted" || r.status === "under_review";
  const assignedOfficeName = refs.organizations.find(organization => organization.id === r.organization_id)?.name || "the assigned office";
  const barangayReadOnly = access.profile.role === "barangay" && !!r.organization_id;
  const [status, setStatus] = useState<string>(r.status === "verified" && !r.organization_id && ["admin", "barangay"].includes(access.profile.role) ? "scheduled" : transitions[r.status][0]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  type WorkspaceStep = "review" | "action" | "details" | "notes" | "timeline";
  const startStep: WorkspaceStep = startOnProgress && !readOnly && !reviewPending ? "action" : "details";
  const [activeStep, setActiveStep] = useState<WorkspaceStep>(startStep);
  const workspaceContent = useRef<HTMLDivElement>(null);
  // Every report and every tab starts at the top of its section.
  useEffect(() => { workspaceContent.current?.scrollTo({ top: 0 }); }, [activeStep, r.id]);
  const [actionMode, setActionMode] = useState<"status" | "progress">("status");
  // "Case timeline" is its own tab only when it cannot sit beside the step content (under 1280px).
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1280px)");
    const leaveTimelineTab = () => { if (wide.matches) setActiveStep(step => step === "timeline" ? startStep : step); };
    leaveTimelineTab();
    wide.addEventListener("change", leaveTimelineTab);
    return () => wide.removeEventListener("change", leaveTimelineTab);
  }, [startStep]);
  const [walkInPin, setWalkInPin] = useState<WalkInPin>(() => hasReportCoordinates(r) ? { latitude: r.latitude, longitude: r.longitude } : null);
  const [editingWalkInPin, setEditingWalkInPin] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => r.status === "scheduled" ? "" : r.scheduled_at ? manilaDateTimeInput(r.scheduled_at) : defaultScheduleDateTimeInput());
  const [scheduleClock, setScheduleClock] = useState<Date | null>(null);
  const [reviewRatings, setReviewRatings] = useState({ severity: r.severity == null ? "" : String(r.severity), urgency: r.urgency == null ? "" : String(r.urgency) });
  const [actionNote, setActionNote] = useState("");
  const [selectedOffice, setSelectedOffice] = useState(r.organization_id || "");
  const [publicSummary, setPublicSummary] = useState("");
  useEffect(() => {
    const refreshClock = () => setScheduleClock(new Date());
    refreshClock();
    const timer = window.setInterval(refreshClock, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const q = useQuery({
    queryKey: ["detail", r.id],
    queryFn: async () => {
      const [problem, permissions, referralOptions, engagement, history, photos, notes, routing] = await Promise.all([
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
            old_status?: string;
            action_kind?: string;
            actor_name?: string;
            attachment_count?: number;
            public_note: string;
            created_at: string;
          }[]
        >(
          db!.rpc("report_action_history", { p_id: r.id }),
        ),
        (async () => {
          const files = await result<{ id: string; action_id: number | null; path: string }[]>(db!.from("report_attachments").select("id,action_id,path").eq("report_id", r.id));
          if (!files.length) return [];
          const { data, error } = await db!.storage.from("report-evidence").createSignedUrls(files.map((file) => file.path), 3600);
          return files.map((file, index) => ({ ...file, url: error ? null : data[index]?.signedUrl }));
        })(),
        readOnly ? Promise.resolve([]) : result<{ id: string; body: string; created_at: string }[]>(
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
      return { problem, permissions, referralOptions, engagement, history, photos, notes, routing };
    },
  });
  const [canonical, setCanonical] = useState({ id: "", title: "" });
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidateOption[]>([]);
  const canCompleteBarangayReview = !reviewPending || access.profile.role === "admin" ||
    (access.profile.role === "barangay" && access.profile.barangay_id === r.barangay_id);
  const scheduleDayReached = !!scheduleClock && reportScheduleDayReached(r.scheduled_at, scheduleClock);
  const availableStatuses: readonly Status[] = r.status === "scheduled"
    ? scheduleDayReached ? [...transitions.scheduled, "scheduled"] : ["scheduled", "duplicate"]
    : transitions[r.status];
  const nextStatuses = availableStatuses.filter(s => !readOnly && !barangayReadOnly && canCompleteBarangayReview && q.data?.permissions[reportAction(s)] &&
    (s !== "assigned" || !reviewPending || q.data?.permissions.review) &&
    (s !== "duplicate" || duplicateCandidates.length > 0) &&
    !(r.status === "verified" && s === "in_progress" && (r.organization_id || !["admin", "barangay"].includes(access.profile.role))));
  const canRouteFromReview = !readOnly && r.status === "verified" && !r.organization_id &&
    (access.profile.role === "admin" || (access.profile.role === "barangay" && access.profile.barangay_id === r.barangay_id)) &&
    nextStatuses.includes("assigned");
  const stepStatuses = reviewPending
    ? activeStep === "review" ? nextStatuses : []
    : activeStep === "review" ? canRouteFromReview ? nextStatuses.filter(s => s === "assigned" || s === "duplicate") : []
      : activeStep === "action" ? nextStatuses.filter(s => s !== "assigned") : [];
  const canRecordProgress = !readOnly && !barangayReadOnly && !reviewPending && !!q.data?.permissions.update && ["scheduled", "in_progress"].includes(r.status);
  const progressOnly = activeStep === "action" && canRecordProgress && (actionMode === "progress" || !stepStatuses.length);
  const selectedStatus = stepStatuses.includes(status as typeof r.status) ? status : stepStatuses[0] || "";
  const routeDecisionOnly = !reviewPending && activeStep === "review" && selectedStatus === "assigned";
  const actionForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (canonical.id && !duplicateCandidates.some(candidate => candidate.id === canonical.id)) {
      setCanonical({ id: "", title: "" });
    }
  }, [canonical.id, duplicateCandidates]);
  useEffect(() => {
    if (canonical.title && selectedStatus === "duplicate") setActiveStep(reviewPending ? "review" : "action");
  }, [canonical, selectedStatus, reviewPending]);
  useEffect(() => {
    if (!canonical.title || selectedStatus !== "duplicate" || activeStep !== (reviewPending ? "review" : "action")) return;
    actionForm.current?.querySelector<HTMLSelectElement>('select[name="duplicate"]')?.focus({ preventScroll: true });
  }, [canonical, selectedStatus, activeStep, reviewPending]);
  const [assessmentErrors, setAssessmentErrors] = useState<Partial<Record<"severity" | "urgency" | "note", string>>>({});
  const statusChoiceLabel = (next: string) => reviewPending && next === "verified" ? "Verify · keep with barangay" : reviewPending && next === "assigned" ? "Verify & forward to office" : next === "under_review" ? r.status === "submitted" ? "Acknowledge and review" : "Reopen for barangay review" : next === "scheduled" ? r.status === "scheduled" ? "Reschedule work" : "Schedule work" : next === "in_progress" ? "Start work · Ongoing" : next === "resolved" ? "Resolve report" : next === "duplicate" ? "Link as duplicate" : next === "rejected" ? "Reject report" : reportStatusLabel(next);
  const statusChoiceHint = (next: string) => ({
    verified: "Confirm the issue; the barangay team handles it.",
    assigned: "Confirm the issue and hand it to an eligible office.",
    under_review: r.status === "submitted" ? "Let the resident know review has started." : "Send the case back for barangay review.",
    scheduled: r.status === "scheduled" ? "Move the planned work to a new date." : "Set a date and time for the planned work.",
    in_progress: "Work has started on site.",
    resolved: "Work is complete and the issue is addressed.",
    duplicate: "Same incident as an existing report.",
    rejected: "Not actionable or outside scope; explain why.",
  } as Record<string, string>)[next] || "";
  const statusChoiceIcon = (next: string) => next === "under_review" ? Clock3 : next === "scheduled" ? CalendarDays : next === "verified" || next === "resolved" ? CircleCheck : next === "assigned" ? UsersRound : next === "in_progress" ? RefreshCw : next === "duplicate" ? Copy : next === "rejected" ? CircleX : ClipboardList;
  const canWrite = !barangayReadOnly && !!(q.data?.permissions.review || q.data?.permissions.update);
  const requiresAssessment = reviewPending && ["verified", "assigned"].includes(selectedStatus);
  const noteError = textInputError(actionNote, { min: 5, max: 4000, required: true });
  const noteReady = !noteError;
  const scheduleDate = scheduledAt ? manilaDateTime(scheduledAt) : null;
  const scheduleError = !scheduledAt ? r.status === "scheduled" ? "Choose a new date and time to reschedule." : "Choose the scheduled date and time." : !scheduleDate ? "Enter a valid date and time." : scheduleDate.getTime() <= Date.now() ? "Choose a future date and time." : r.status === "scheduled" && r.scheduled_at && scheduleDate.getTime() === new Date(r.scheduled_at).getTime() ? "Choose a new date and time to reschedule." : "";
  const scheduledDayLabel = r.scheduled_at
    ? new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeZone: "Asia/Manila" }).format(new Date(r.scheduled_at))
    : "the scheduled Philippine date";
  const scheduleReady = !scheduleError;
  const ratingsReady = /^[1-5]$/.test(reviewRatings.severity) && /^[1-5]$/.test(reviewRatings.urgency);
  const officeReady = !!q.data?.referralOptions.some(option => option.id === selectedOffice);
  const duplicateReady = duplicateCandidates.some(candidate => candidate.id === canonical.id);
  const actionReady = noteReady && (progressOnly ? canRecordProgress : !!selectedStatus && (!requiresAssessment || ratingsReady) &&
    (selectedStatus !== "scheduled" || scheduleReady) &&
    (selectedStatus !== "assigned" || officeReady) && (selectedStatus !== "duplicate" || duplicateReady));
  const checklist = [
    { label: "Review note", complete: noteReady },
    ...(requiresAssessment ? [
      { label: "Severity assessed", complete: /^[1-5]$/.test(reviewRatings.severity) },
      { label: "Urgency assessed", complete: /^[1-5]$/.test(reviewRatings.urgency) },
    ] : []),
    ...(selectedStatus === "assigned" ? [{ label: "Eligible office selected", complete: officeReady }] : []),
    ...(selectedStatus === "scheduled" ? [{ label: "Work date scheduled", complete: scheduleReady }] : []),
    ...(selectedStatus === "duplicate" ? [{ label: "Possible main report selected", complete: duplicateReady }] : []),
  ];
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

  async function saveWalkInPin() {
    if (!walkInPin || busy) return;
    setBusy(true);
    setError("");
    try {
      await result(db!.rpc("update_walk_in_report_location", {
        p_id: r.id,
        p_latitude: walkInPin.latitude,
        p_longitude: walkInPin.longitude,
      }));
      setEditingWalkInPin(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["detail", r.id] }),
        qc.invalidateQueries({ queryKey: ["reports"] }),
        qc.invalidateQueries({ queryKey: ["report-queue-counts"] }),
        qc.invalidateQueries({ queryKey: ["notification-report"] }),
      ]);
    } catch (cause) {
      setError((cause as Error).message || "The on-site pin could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const history = [
    ...(q.data && !q.data.history.some((event) => event.new_status === "submitted")
      ? [{ id: -1, new_status: "submitted", public_note: "Report received by the system", created_at: r.created_at }] : []),
    ...(q.data?.history || []),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id);
  const barangayName = refs.barangays.find(barangay => barangay.id === r.barangay_id)?.name || "the assigned barangay";
  const reviewRecord = history.find(event => event.action_kind === "report_review") || history.find(event => event.new_status === "verified");
  const reviewComplete = !reviewPending && (!!reviewRecord || !!r.verified_at || ["rejected", "duplicate"].includes(r.status));
  const workspaceSteps = [
    { id: "details" as const, title: "Report details", detail: "Location, context and photos", icon: MapPin, state: "available", disabled: false },
    ...(!readOnly ? [
      { id: "review" as const, title: "Review & route", detail: reviewPending ? "Matches, ratings and decision" : canRouteFromReview ? "Review recorded · route if needed" : reviewComplete ? "Barangay review recorded" : "Review details", icon: ClipboardCheck, state: reviewPending || !reviewComplete ? "required" : "complete", disabled: false },
      { id: "action" as const, title: "Status & progress", detail: barangayReadOnly ? `Read-only · managed by ${assignedOfficeName}` : reviewPending ? "Review the report first" : "Case stage and resident updates", icon: ClipboardList, state: r.status === "resolved" ? "complete" : "available", disabled: false },
      { id: "notes" as const, title: "Private notes", detail: "Staff-only context", icon: LockKeyhole, state: "available", disabled: false },
    ] : []),
  ];
  const currentStatusTitle = r.status === "in_progress" ? "Ongoing" : reportStatusLabel(r.status);
  const historyPanel = <aside className="report-workspace-history" aria-labelledby="report-history-title">
    <div className="report-workspace-history-heading"><History size={19} aria-hidden="true" /><div><h3 id="report-history-title">Case timeline</h3><p>Current status and recorded activity</p></div></div>
    <div className="report-history-summary">
    <div className="report-current-case-status" role="status" aria-label={`Current case status: ${currentStatusTitle}`}>
      <div><span>Current status</span><strong className={`report-current-status-value status-${r.status}`}>{currentStatusTitle}</strong></div>
      <p>{reportStatusDescription(r.status)}</p>
      {r.status === "scheduled" && r.scheduled_at && <small className="report-current-schedule">Scheduled for {reportScheduleLabel(r.scheduled_at)} · Philippine time</small>}
    </div>
    {!reviewPending && <div className="report-review-attribution">
      <span className="report-review-attribution-icon"><Check size={16} aria-hidden="true" /></span>
      <div><strong>{reviewRecord?.actor_name ? "Reviewed by " + reviewRecord.actor_name : "Review decision recorded"}</strong>{!(reviewRecord?.actor_name || "").toLowerCase().includes((barangayName || "").toLowerCase()) && <small>Barangay {barangayName}</small>}</div>
    </div>}
    </div>
    <div className="report-workspace-history-subheading"><h4>Status history</h4><span>{history.length} {history.length === 1 ? "update" : "updates"}</span></div>
    {q.isPending ? <p className="report-workspace-muted" role="status">Loading status history…</p> : history.length ? <ol className="report-history-list">{history.map(event => {
      const state = event.new_status;
      const EventIcon = state === "resolved" ? CircleCheck : state === "scheduled" ? CalendarDays : ["assigned", "in_progress"].includes(state) ? UsersRound : state === "verified" ? Check : state === "submitted" ? FileText : Clock3;
      const eventTitle = event.action_kind === "report_review" ? "Barangay review" : event.action_kind === "progress_update" ? "Progress update" : event.action_kind === "personnel_assignment" ? "Personnel assignment" : event.action_kind === "location_update" ? "On-site pin corrected" : state === "scheduled" && event.old_status === "scheduled" ? "Work rescheduled" : reportStatusLabel(state);
      return <li className={"report-history-event " + state} key={event.id}>
        <span className="report-history-icon"><EventIcon size={15} aria-hidden="true" /></span>
        <div><strong>{eventTitle}</strong>
          {event.actor_name && <small>{event.action_kind === "report_review" ? "Reviewed by " + event.actor_name + " · Barangay " + barangayName : event.action_kind === "location_update" ? "On-site location checked by " + event.actor_name : "By " + event.actor_name}{event.action_kind !== "location_update" && event.old_status && " · " + reportStatusLabel(event.old_status) + " → " + reportStatusLabel(event.new_status)}{event.attachment_count ? " · " + event.attachment_count + " photos for action #" + event.id : ""}</small>}
          <small>{event.public_note || (state === "submitted" ? "Report received by the system" : "Authorized action recorded")}</small>
        </div>
        <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}</time>
      </li>;
    })}</ol> : <p className="report-workspace-muted">No status changes recorded yet.</p>}
  </aside>;
  const canSaveCaseUpdate = progressOnly ? canRecordProgress : stepStatuses.length > 0;
  const actionSection = stepStatuses.length > 0 || activeStep === "action" && canRecordProgress ? <section className="report-workspace-section report-action-section">
    <div className="report-workspace-section-heading"><span className="report-action-heading-icon"><FileText size={24} aria-hidden="true" /></span><div><h3>{reviewPending ? "Barangay review & routing" : routeDecisionOnly ? "Route reviewed report" : progressOnly ? "Record progress update" : "Update case status"}</h3><p>{reviewPending ? "Assess the report and decide whether the barangay will handle it or an eligible office should take over." : routeDecisionOnly ? "The review is recorded. Choose the responsible office and explain the handoff." : progressOnly ? "Share an investigation or follow-up update without changing the current status." : "Change the case status and leave a resident-visible update."}</p></div></div>
    <form id={`report-action-${r.id}`} ref={actionForm} className="report-action-form" onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      const form = new FormData(event.currentTarget);
      if (noteError) {
        setAssessmentErrors({ note: noteError });
        (event.currentTarget.elements.namedItem("note") as HTMLTextAreaElement | null)?.focus();
        return;
      }
      if (requiresAssessment) {
        const assessment = reportAssessmentSchema.safeParse({ severity: Number(form.get("severity")), urgency: Number(form.get("urgency")), note: String(form.get("note") || "") });
        if (!assessment.success) {
          const next: Partial<Record<"severity" | "urgency" | "note", string>> = {};
          for (const issue of assessment.error.issues) { const name = issue.path[0] as keyof typeof next; if (!next[name]) next[name] = issue.message; }
          setAssessmentErrors(next);
          focusField(event.currentTarget, String(assessment.error.issues[0]?.path[0]));
          return;
        }
      }
      if (!progressOnly && !selectedStatus) return;
      if (!progressOnly && selectedStatus === "scheduled" && !scheduleReady) {
        setError(scheduleError);
        (event.currentTarget.elements.namedItem("scheduled_at") as HTMLInputElement | null)?.focus();
        return;
      }
      if (!progressOnly && selectedStatus === "assigned" && !officeReady) {
        (event.currentTarget.elements.namedItem("office") as HTMLSelectElement | null)?.focus();
        return;
      }
      if (!progressOnly && selectedStatus === "duplicate" && !duplicateReady) {
        (event.currentTarget.elements.namedItem("duplicate") as HTMLSelectElement | null)?.focus();
        return;
      }
      const evidence = (q.data?.photos ?? []).filter(photo => photo.action_id == null).slice(0, 10).map(photo => photo.id);
      setBusy(true); setError(""); setAssessmentErrors({});
      try {
        if (progressOnly) await result(db!.rpc("record_report_update", { p_id: r.id, p_note: form.get("note"), p_evidence: evidence }));
        else await result(db!.rpc("change_report", {
          p_id: r.id, p_status: selectedStatus, p_note: form.get("note"),
          p_organization: form.get("office") || null,
          p_severity: requiresAssessment ? Number(form.get("severity")) : null,
          p_urgency: requiresAssessment ? Number(form.get("urgency")) : null,
          p_evidence: evidence,
          p_duplicate: form.get("duplicate") || null,
          p_public_summary: form.get("summary") || null,
          p_scheduled_at: selectedStatus === "scheduled" ? scheduleDate?.toISOString() || null : null,
        }));
        await qc.invalidateQueries(); close();
      } catch (cause) { setError((cause as Error).message); }
      finally { setBusy(false); }
    }}>
      {reviewPending && <section className="report-review-checklist-panel" aria-labelledby={`review-checklist-${r.id}`}>
        <div className="report-review-checklist-heading"><div><strong id={`review-checklist-${r.id}`}>Review checklist</strong><p>{actionReady ? "All required items are complete." : "Complete these items before saving."}</p></div><span className={actionReady ? "ready" : "pending"}>{actionReady ? "Ready" : "Action needed"}</span></div>
        <ul className="report-review-checklist" aria-label="Required review items">{checklist.map(item => <li key={item.label} className={item.complete ? "complete" : "incomplete"}>
          <span className="report-review-checklist-icon">{item.complete ? <Check size={15} aria-hidden="true" /> : <CircleX size={15} aria-hidden="true" />}</span>
          <span className="report-review-checklist-label">{item.label}</span>
          <small>{item.complete ? "Done" : "Required"}</small>
        </li>)}</ul>
      </section>}
      {!reviewPending && activeStep === "action" && stepStatuses.length > 0 && canRecordProgress && <div className="report-action-mode-wrap">
        <span className="report-action-mode-label">Update type</span>
        <div className="report-action-mode" role="group" aria-label="Case update type">
          <button type="button" aria-pressed={!progressOnly} disabled={busy} onClick={() => { setActionMode("status"); setActionNote(""); setAssessmentErrors({}); }}>Change status</button>
          <button type="button" aria-pressed={progressOnly} disabled={busy} onClick={() => { setActionMode("progress"); setActionNote(""); setAssessmentErrors({}); }}>Progress update</button>
        </div>
        <p className="report-action-mode-help">{progressOnly ? "Add a resident-visible update without changing the case status." : "Move the report to its next stage."}</p>
      </div>}
      {routeDecisionOnly
        ? <div className="report-route-decision"><span>Routing decision</span><strong><UsersRound size={16} aria-hidden="true" /> Forward to an eligible office</strong><small>The barangay review and assessment are already recorded.</small></div>
        : progressOnly ? <div className="report-action-current-status"><span>Current status stays the same</span><strong className={`report-current-status-value status-${r.status}`}>{currentStatusTitle}</strong></div>
        : <fieldset className="report-decision report-form-step" aria-required="true">
          <legend>{reviewPending ? "Review decision" : r.status === "scheduled" ? "Next action" : "Case status"} <span className="report-action-required" aria-hidden="true">*</span></legend>
          <div className="report-decision-options">{stepStatuses.map(next => {
            const NextIcon = statusChoiceIcon(next);
            return <label key={next} className={"report-decision-option" + (selectedStatus === next ? " is-selected" : "")} data-status={next}>
              <input type="radio" name="decision" value={next} checked={selectedStatus === next} onChange={() => { setStatus(next); setAssessmentErrors({}); }} />
              <span className="report-decision-icon" aria-hidden="true"><NextIcon size={18} /></span>
              <span className="report-decision-copy"><strong>{statusChoiceLabel(next)}</strong><small>{statusChoiceHint(next)}</small></span>
              <span className="report-decision-check" aria-hidden="true"><Check size={14} /></span>
            </label>;
          })}</div>
        </fieldset>}
      {r.status === "scheduled" && !scheduleDayReached && <p className="report-schedule-action-hint"><Clock3 size={16} aria-hidden="true" /><span>Work actions open on {scheduledDayLabel} (Philippine time). You can reschedule before then.</span></p>}
      {!progressOnly && selectedStatus === "scheduled" && <label className="report-action-schedule-field"><span>{r.status === "scheduled" ? "New work date and time" : "Planned work date and time"} <span className="report-action-required" aria-hidden="true">*</span></span><span className="report-action-schedule-control"><CalendarDays size={18} aria-hidden="true" /><input name="scheduled_at" type="datetime-local" required min={manilaDateTimeInput()} value={scheduledAt} onChange={event => { setScheduledAt(event.target.value); setError(""); }} aria-invalid={!!scheduleError && !!scheduledAt || undefined} /></span><small>{r.status === "scheduled" ? "Choose a new future date and time. The resident will be notified." : "Use Philippine time. The resident will see this schedule in report tracking."}</small>{scheduleError && scheduledAt && <small className="field-validation-message" role="alert">{scheduleError}</small>}</label>}
      {requiresAssessment && <AssessmentFields idPrefix={`review-${r.id}`} severity={r.severity} urgency={r.urgency} errors={assessmentErrors} disabled={busy} values={reviewRatings} onValueChange={(field, value) => setReviewRatings(previous => ({ ...previous, [field]: value }))} />}
      {selectedStatus === "assigned" && <>
        {!q.data?.routing.length && <p className="routing-guidance-empty" role="status">No routing guidance is configured for this category and barangay.</p>}
        {!q.data?.referralOptions.length && <p className="notice route-warning" role="status">No eligible office is configured. An administrator must enable the correct category and barangay access before this report can be routed.</p>}
        {q.data?.routing.map((rule, index) => <p key={index} className="notice">Routing guidance: {refs.organizations.find(organization => organization.id === rule.organization_id)?.name}. {rule.notes}</p>)}
        <label>Responsible office <span className="report-action-required" aria-hidden="true">*</span><select name="office" required value={selectedOffice} onChange={event => setSelectedOffice(event.target.value)}><option value="">Select an eligible office</option>{q.data?.referralOptions.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
      </>}
      <label className="report-action-note report-form-step"><span>{progressOnly ? "Progress update" : selectedStatus === "duplicate" ? "Reason for linking these reports" : selectedStatus === "assigned" ? "Public review note & routing reason" : reviewPending ? selectedStatus === "rejected" ? "Reason for rejection" : "Public review note" : selectedStatus === "scheduled" ? r.status === "scheduled" ? "Reason for rescheduling" : "Schedule note for the resident" : selectedStatus === "resolved" ? "Completion and resolution details" : "Public action update"} <span className="report-action-required" aria-hidden="true">*</span></span><textarea name="note" required minLength={5} maxLength={4000} value={actionNote} onChange={event => {
        const value = event.target.value;
        setActionNote(value);
        const note = textInputError(value, { min: 5, max: 4000, required: true });
        setAssessmentErrors(previous => Object.hasOwn(previous, "note") ? { ...previous, note } : previous);
      }} aria-invalid={!!assessmentErrors.note || undefined} aria-describedby={`report-action-note-hint${assessmentErrors.note ? " report-action-note-error" : ""}`} placeholder={progressOnly ? "Describe what was checked, what changed, and the next follow-up step…" : selectedStatus === "scheduled" ? r.status === "scheduled" ? "Explain why the work must move and what date the resident should expect…" : "Explain what work is planned and what the resident should expect…" : selectedStatus === "resolved" ? "Describe what was completed and how the issue was addressed…" : selectedStatus === "duplicate" ? "Explain how the location, problem, and evidence describe the same incident…" : selectedStatus === "assigned" ? "Explain what the barangay verified and why the office should take over…" : reviewPending ? "Summarize what was reviewed and what should happen next…" : "Describe the work underway and the next follow-up step…"} /></label>
      <small id="report-action-note-hint" className="report-action-note-hint">{progressOnly ? "5–4,000 characters. Visible to the resident; case status stays unchanged." : selectedStatus === "scheduled" && r.status === "scheduled" ? "The resident will be notified about the updated Philippine-time schedule." : "5–4,000 characters. Shared with the resident; for a referral, this also records the handoff reason."}</small>
      {assessmentErrors.note && <p id="report-action-note-error" className="field-validation-message" role="alert">{assessmentErrors.note}</p>}
      {requiresAssessment && <details className="report-summary-disclosure" open={!!publicSummary || undefined}>
        <summary>Add a public map summary <span>(optional)</span></summary>
        <label><span className="sr-only">Public case summary</span><textarea name="summary" maxLength={160} value={publicSummary} onChange={event => setPublicSummary(event.target.value)} placeholder="A short, privacy-safe summary for the map." /></label>
        <p className="report-form-hint">A summary publishes a rounded map location.</p>
      </details>}
      {selectedStatus === "duplicate" && <label>Suggested main report <span className="report-action-required" aria-hidden="true">*</span><select name="duplicate" required value={canonical.id} onChange={event => { const candidate = duplicateCandidates.find(item => item.id === event.target.value); setCanonical(candidate || { id: "", title: "" }); }}><option value="">Select a possible main report</option>{duplicateCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title} · {candidate.id.slice(0, 8)}</option>)}</select><small>Only reports identified by the possible-duplicate check can be linked.</small>{canonical.title && <span className="duplicate-selected-original" role="status">Selected main report: <strong>{canonical.title}</strong>.</span>}</label>}
    </form>
  </section> : null;

  return (
    <Dialog title={r.title} description={category.label} descriptionMeta={<span className={`badge ${r.status} report-workspace-header-status`}>{r.status === "duplicate" ? "Linked duplicate" : reportStatusLabel(r.status)}</span>} icon={<CategoryIcon size={23} />} className="report-workspace-dialog" close={close}>
      <div className="report-workspace-content" ref={workspaceContent}>
        <section className="report-workspace-summary is-description" aria-label="Resident's description">
          <div className="report-description-head">
            <span className="report-description-icon" aria-hidden="true"><MessageSquareQuote size={17} /></span>
            <span className="report-workspace-summary-label">Resident&apos;s description</span>
            <small className="mono report-description-id" title={r.id}>ID {r.id.slice(0, 8).toUpperCase()}</small>
          </div>
          <p>{r.description}</p>
        </section>

        {(q.error || error) && <p role="alert" className="error">{error || q.error?.message}</p>}
        {uploadMessage && <p className="report-upload-success" role="status">{uploadMessage}</p>}

        <div className="report-workspace-layout" data-timeline={activeStep === "timeline" ? "open" : undefined}>
          <nav className="report-workspace-nav" aria-label="Report workspace steps">
            <p className="report-workspace-nav-label">Workspace</p>
            {workspaceSteps.map((step) => {
              const StepIcon = step.icon;
              const StepStateIcon = step.state === "complete" ? Check : step.state === "required" ? CircleX : null;
              return <button type="button" key={step.id} disabled={step.disabled} className={"report-workspace-step" + (activeStep === step.id ? " active" : "") + (step.disabled ? " unavailable" : "")}
                aria-current={activeStep === step.id ? "step" : undefined} onClick={() => setActiveStep(step.id)}>
                <span className="report-workspace-step-icon">{StepStateIcon ? <StepStateIcon size={17} aria-hidden="true" /> : <StepIcon size={17} aria-hidden="true" />}</span>
                <span className="report-workspace-step-copy"><strong>{step.title}</strong><small>{step.detail}</small></span>
                {step.state !== "available" && <span className={"report-workspace-step-state " + step.state}>{step.state === "complete" ? "Done" : "Needs review"}</span>}
              </button>;
            })}
            <button type="button" className={"report-workspace-step report-workspace-timeline-tab" + (activeStep === "timeline" ? " active" : "")}
              aria-current={activeStep === "timeline" ? "step" : undefined} onClick={() => setActiveStep("timeline")}>
              <span className="report-workspace-step-icon"><History size={17} aria-hidden="true" /></span>
              <span className="report-workspace-step-copy"><strong>Case timeline</strong><small>Status and activity</small></span>
            </button>
          </nav>

          <main className="report-workspace-main" aria-live="polite">

            {activeStep === "review" && <>
              {!reviewPending && <section className="report-workspace-section report-review-result">
                <span className="report-review-result-icon"><Check size={18} aria-hidden="true" /></span>
                <div>
                  <strong>{reviewRecord?.actor_name ? "Reviewed by " + reviewRecord.actor_name : "Barangay review recorded"}</strong>
                  <span>Barangay {barangayName}</span>
                  <p>{r.status === "assigned"
                    ? "Verified and forwarded to " + (refs.organizations.find(organization => organization.id === r.organization_id)?.name || "the responsible office") + ". The assigned office can now take action."
                    : r.organization_id
                      ? "The barangay reviewed this report and assigned it to " + (refs.organizations.find(organization => organization.id === r.organization_id)?.name || "the responsible office") + "."
                      : r.status === "rejected"
                        ? "The barangay reviewed this report and recorded a decision to reject it."
                        : r.status === "duplicate"
                          ? "The barangay reviewed this submission and linked it to its main report."
                          : r.status === "verified"
                            ? "Verified and ready for action by the barangay team."
                            : "The report review and decision are recorded."}</p>
                </div>
              </section>}
              {r.status !== "duplicate" && r.status !== "rejected" && <DuplicateReview report={r} onCandidatesChange={setDuplicateCandidates} />}
              {!reviewPending && <ReportAssessment key={r.id} reportId={r.id} canReview={!barangayReadOnly && !!q.data?.permissions.review} />}
              {reviewPending
                ? actionSection || <section className="report-workspace-section"><p className="report-workspace-muted" role="status">{q.isPending ? "Loading review permissions and eligible offices…" : "Your account cannot review this report."}</p></section>
                : canRouteFromReview
                  ? actionSection || <section className="report-workspace-section"><p className="report-workspace-muted" role="status">{q.isPending ? "Loading routing permissions and eligible offices…" : "Your account cannot route this report to an office."}</p></section>
                  : null}
            </>}

            {activeStep === "action" && <>
              {reviewPending && <section className="report-workspace-section report-workspace-notice"><ClipboardCheck size={20} aria-hidden="true" /><p>Complete the barangay review first. Severity, urgency, and any office referral are saved together with the review decision.</p><button type="button" className="secondary" onClick={() => setActiveStep("review")}>Go to review</button></section>}
              {!reviewPending && canRouteFromReview && <p className="report-route-reminder">Need to hand this report to an office? <button type="button" onClick={() => setActiveStep("review")}>Choose it in Review &amp; route</button> before starting local work.</p>}
              {!reviewPending && actionSection}
              {!reviewPending && !stepStatuses.length && !canRecordProgress && !q.isPending && <section className="report-workspace-section report-workspace-notice"><LockKeyhole size={20} aria-hidden="true" /><p>{barangayReadOnly ? <><strong>Office handling:</strong> {assignedOfficeName} now controls this forwarded report. Barangay staff can follow its timeline and view details, but cannot change its status, add progress, or edit the walk-in location.</> : "Your current permissions do not allow status or progress updates."}</p></section>}
              {!reviewPending && q.isPending && <section className="report-workspace-section"><p className="report-workspace-muted" role="status">Loading action permissions…</p></section>}
            </>}

            {activeStep === "details" && <>
              <section className="report-workspace-section report-document-section">
                <div className="report-workspace-section-heading"><MapPin size={22} aria-hidden="true" /><div><h3>Location and classification</h3><p>Report location, issue type, and current responsibility.</p></div></div>
                <div className="report-workspace-location-grid">
                  <div><span>Problem type</span><strong>{q.data?.problem?.label || (r.problem_type ? label(r.problem_type) : categoryName)}</strong>{r.problem_other && <small>{r.problem_other}</small>}</div>
                  <div className="report-location-details">
                    <div className="report-location-head">
                      <span className="report-location-icon" aria-hidden="true"><MapPin size={18} /></span>
                      <div><span>Reported location</span><strong>{refs.barangays.find(barangay => barangay.id === r.barangay_id)?.name || "Barangay not recorded"} · Iligan City</strong></div>
                      {hasReportCoordinates(r) && <a className="report-directions" href={"https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(r.latitude + "," + r.longitude)} target="_blank" rel="noopener noreferrer">Get directions <ArrowUpRight size={15} aria-hidden="true" /><span className="sr-only"> in Google Maps (opens a new tab)</span></a>}
                      <em className="report-location-source">{hasReportCoordinates(r) ? (r.location_source === "gps" ? "Device GPS" : r.location_source === "pin" ? "Map pin" : r.location_source === "coordinates" ? "Entered coordinates" : "Saved coordinates") : "Manual address"}</em>
                    </div>
                    {(r.purok || r.zone || r.landmark || r.location_address || hasReportCoordinates(r)) && <dl className="report-location-facts">
                      {r.purok && <div><dt>Purok</dt><dd>{r.purok}</dd></div>}
                      {r.zone && <div><dt>Zone</dt><dd>{r.zone}</dd></div>}
                      {r.landmark && <div><dt>Additional details</dt><dd>{r.landmark}</dd></div>}
                      {r.location_address && <div className="is-address"><dt>Detected address</dt><dd>{r.location_address}</dd></div>}
                      {hasReportCoordinates(r) && <div><dt>Coordinates</dt><dd><span className="mono">{r.latitude.toFixed(6)}, {r.longitude.toFixed(6)}</span>{r.location_accuracy != null && Number.isFinite(r.location_accuracy) && <small> · accuracy about ±{Math.round(r.location_accuracy)} m</small>}</dd></div>}
                    </dl>}
                    {!hasReportCoordinates(r) && <p className="report-location-note">No map pin was provided. Use the details above to locate the issue.</p>}
                    {r.submission_source === "walk_in" && access.profile.role === "barangay" && access.profile.barangay_id === r.barangay_id && !barangayReadOnly && q.data?.permissions.review && <div className="walk-in-location-correction">
                      {!editingWalkInPin ? <button type="button" className="secondary" onClick={() => { setWalkInPin(hasReportCoordinates(r) ? { latitude: r.latitude, longitude: r.longitude } : null); setEditingWalkInPin(true); }}><MapPin size={15} aria-hidden="true" />Correct pin after site visit</button> : <>
                        <p>Set the verified issue location inside the barangay boundary. The change and staff member will be added to the case timeline.</p>
                        <WalkInLocationMap barangayId={r.barangay_id} barangays={refs.barangays} value={walkInPin} onChange={setWalkInPin} />
                        <div className="walk-in-location-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setEditingWalkInPin(false); setWalkInPin(hasReportCoordinates(r) ? { latitude: r.latitude, longitude: r.longitude } : null); }}>Cancel</button><button type="button" disabled={!walkInPin || busy || !hasReportCoordinates(r) || walkInPin.latitude === r.latitude && walkInPin.longitude === r.longitude} onClick={() => void saveWalkInPin()}>{busy ? "Saving…" : "Save verified pin"}</button></div>
                      </>}
                    </div>}
                  </div>
                  <div><span>{r.status === "duplicate" ? "Progress ownership" : "Assigned office"}</span><strong>{r.status === "duplicate" ? "Managed through the main report" : refs.organizations.find(organization => organization.id === r.organization_id)?.name || "Barangay team"}</strong></div>
                </div>
              </section>
              {!readOnly && <ReportHandling report={r} barangays={refs.barangays} />}
              <section className="report-workspace-section report-photo-section">
                <div className="report-workspace-section-heading"><ImageIcon size={22} aria-hidden="true" /><div><h3>Report photos</h3><p>{canWrite && (nextStatuses.length || canRecordProgress) ? "Unlinked photos are automatically attached to your next saved status or progress update (up to 10)." : "Review photographs attached to the report."}</p></div></div>
                {q.isPending ? <div className="report-evidence-skeleton" aria-label="Loading supporting photos"><i /><i /><i /></div> : <div className="report-evidence-grid">
                  {q.data?.photos.map((photo, index) => photo.url ? <a className="report-evidence-photo" key={photo.path} href={photo.url} target="_blank" rel="noreferrer" aria-label={"Open report photo " + (index + 1)}>
                    <img src={photo.url} alt={"Photo " + (index + 1) + " for " + r.title} loading="lazy" />
                  </a> : <div className="report-evidence-unavailable" key={photo.path}><ImageIcon size={22} /><span>Photo preview unavailable</span></div>)}
                  {q.data && q.data.photos.length === 0 && <div className="report-evidence-empty"><ImageIcon size={21} /><span>No supporting photos yet</span><small>Add a photo if it helps document this report.</small></div>}
                  {canWrite && <div className="report-evidence-actions">
                    {access.profile.role === "barangay" && <label className={"report-evidence-add" + (busy ? " disabled" : "")}>
                      <Camera size={22} aria-hidden="true" /><strong>{busy ? "Uploading…" : "Take a photo"}</strong><small>Use the camera</small>
                      <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Capture a supporting report photo" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadEvidence([file]); }} />
                    </label>}
                    <label className={"report-evidence-add" + (busy ? " disabled" : "")}>
                      <Upload size={22} aria-hidden="true" /><strong>{busy ? "Uploading…" : "Upload photos"}</strong><small>Choose from your device</small>
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Upload supporting report photos" disabled={busy} onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void uploadEvidence(files); }} />
                    </label>
                    <small className="report-evidence-limits">JPG, PNG, or WebP · up to 5 MB each</small>
                  </div>}
                </div>}
              </section>
              <section className="report-workspace-section report-community-context">
                <div className="report-workspace-section-heading"><UsersRound size={22} aria-hidden="true" /><div><h3>Community context</h3><p>{q.data?.engagement.followers ?? 0} followers · {q.data?.engagement.endorsements ?? 0} residents report the same experience.</p><small>Participation counts provide context; they are not additional verified defects.</small></div></div>
              </section>
              {!readOnly && r.status === "duplicate" && <DuplicateMainProgress reportId={r.id} onOpen={onOpenLinked} />}
              {!readOnly && r.status !== "duplicate" && <LinkedDuplicateReports reportId={r.id} onOpen={onOpenLinked} />}
            </>}

            {activeStep === "notes" && <section className="report-workspace-section report-private-notes">
              <div className="report-workspace-section-heading"><LockKeyhole size={22} aria-hidden="true" /><div><h3>Private staff notes</h3><p>Visible only to authorized staff. Public action notes are shared with the resident.</p></div></div>
              {q.data?.notes.length ? q.data.notes.map(note => <article className="report-private-note" key={note.id}><p>{note.body}</p><time dateTime={note.created_at}>{new Date(note.created_at).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}</time></article>) : q.isPending ? <p className="report-workspace-muted" role="status">Loading private notes…</p> : <p className="report-workspace-muted">No private staff notes yet.</p>}
              {canWrite && <form className="report-private-note-form" onSubmit={async event => {
                event.preventDefault(); const form = event.currentTarget; setBusy(true); setError("");
                try {
                  await result(db!.from("report_internal_notes").insert({ report_id: r.id, body: new FormData(form).get("body") }));
                  form.reset(); await qc.invalidateQueries({ queryKey: ["detail", r.id] });
                } catch (cause) { setError((cause as Error).message); }
                finally { setBusy(false); }
              }}><label htmlFor={"private-note-" + r.id}>Add a private note<textarea id={"private-note-" + r.id} name="body" required minLength={5} maxLength={4000} placeholder="Write an internal note…" /></label><button disabled={busy}>{busy ? "Saving…" : "Save private note"}</button></form>}
            </section>}
          </main>

          {historyPanel}
        </div>
        <p className="report-workspace-footnote"><Paperclip size={14} aria-hidden="true" /> Supporting evidence is stored in the secured report-evidence bucket. Images remain attached to the report.</p>
      </div>
      {(activeStep === "review" && stepStatuses.length > 0 || activeStep === "action" && canSaveCaseUpdate) && <div className="report-workspace-modal-footer">
        <button type="submit" form={`report-action-${r.id}`} className="report-workspace-primary" disabled={busy || !actionReady}><Save size={18} aria-hidden="true" />{busy ? "Saving…" : reviewPending ? "Save review decision" : routeDecisionOnly ? "Save routing decision" : progressOnly ? "Save progress update" : "Save status update"}</button>
      </div>}
    </Dialog>
  );
}
