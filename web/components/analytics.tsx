"use client";
import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import dynamic from "next/dynamic";
import { Activity, ArrowLeft, ArrowUpRight, BadgeCheck, CalendarDays, ChartNoAxesCombined, CheckCircle2, CircleAlert, Clock3, Download, FileText, MapPin, MapPinned, Printer, Search, UsersRound, type LucideIcon } from "lucide-react";
import { downloadCsv, philippineDateBoundary } from "../lib/export";
import { db, result } from "../lib/client";
import { label, statuses, Report } from "@community/shared";
import type { References } from "./workspace";
import { useAccess } from "./access-context";
import { canCreate, canPrioritize } from "../lib/access";
import { reportCategoryPresentation, ReportCategoryLabel } from "./report-category";
const IssueMap = dynamic(() => import("./issue-map"), { ssr: false });
const countFormatter = new Intl.NumberFormat("en-PH");
type PrioritySummary = {
  id: string;
  name: string;
  submitted: number;
  verified: number;
  unresolved: number;
  resolved: number;
  oldest_days: number;
  severity_total: number;
  score: number;
};
export type AnalyticsData = {
  counts: Record<string, number>;
  categories: { name: string; received: number; verified: number }[];
  trend: { week: string; received: number; verified: number }[];
  barangays: {
    id: string;
    name: string;
    received: number;
    verified: number;
    unresolved: number;
    recurring: number;
  }[];
};
export function Charts({ data, variant = "default" }: { data: AnalyticsData; variant?: "default" | "analytics" }) {
  const trendRows = [...data.trend].sort((a, b) => a.week.localeCompare(b.week));
  const orderedCategories = data.categories
    .map((row) => ({ ...row, displayName: reportCategoryPresentation(row.name).label }))
    .sort((a, b) => b.received - a.received || a.displayName.localeCompare(b.displayName));
  const categoryRows = orderedCategories.filter((row) => row.received > 0);
  return (
    <div className={"two-col charts" + (variant === "analytics" ? " analytics-charts" : "")}>
      <section className="panel">
        <div className="panel-heading">
          <div className="overview-panel-title"><span className="overview-section-icon blue"><Activity size={17} /></span><div><h2>Reporting over time</h2><p className="overview-panel-subtitle">Report counts received and verified by submission week</p></div></div>
          <span className="badge">Philippine time</span>
        </div>
        {trendRows.length > 1 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={trendRows}
              margin={{ top: 12, right: 12, left: -20, bottom: 2 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8efed" />
              <XAxis dataKey="week" interval="preserveStartEnd" minTickGap={24} tick={{ fontSize: 12 }} tickFormatter={(value: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${value}T12:00:00+08:00`))} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickFormatter={(value: number) => countFormatter.format(value)} />
              <Tooltip
                contentStyle={{ border: "1px solid #e0eae8", borderRadius: 12, boxShadow: "0 8px 24px #173b3518", fontSize: 12 }}
                labelFormatter={(value) => `Week of ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(`${String(value)}T12:00:00+08:00`))}`}
                formatter={(value) => countFormatter.format(Number(value))}
                cursor={{ stroke: "#9db9b3", strokeDasharray: "4 4" }}
              />
              <Line
                name="Received"
                dataKey="received"
                stroke="var(--brand-hover)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "var(--brand-hover)", strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
              />
              <Line
                name="Verified"
                dataKey="verified"
                stroke="var(--chart-verified)"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={{ r: 3, fill: "var(--chart-verified)", strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : trendRows.length === 1 ? (
          <div className="analytics-trend-snapshot" aria-label="Report activity for the available week">
            <div className="analytics-trend-snapshot-date">
              <CalendarDays size={15} aria-hidden="true" />
              <span>Week of {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(`${trendRows[0].week}T12:00:00+08:00`))}</span>
            </div>
            <div className="analytics-trend-snapshot-stats">
              <div><strong>{countFormatter.format(trendRows[0].received)}</strong><span>Reports received</span></div>
              <div><strong>{countFormatter.format(trendRows[0].verified)}</strong><span>Verified reports</span></div>
            </div>
            <div className="analytics-trend-snapshot-track" role="img" aria-label={`${trendRows[0].verified} of ${trendRows[0].received} reports verified`}>
              <span style={{ width: `${trendRows[0].received ? Math.min(100, trendRows[0].verified / trendRows[0].received * 100) : 0}%` }} />
            </div>
            <span className="analytics-trend-snapshot-note">A trend line will appear when reports span multiple weeks.</span>
          </div>
        ) : (
          <div className="analytics-trend-insufficient"><strong>No reports in this period</strong><span>Weekly activity will appear here when reports are received.</span></div>
        )}
        {trendRows.length > 1 && <div className="chart-legend chart-legend-lines" aria-label="Chart series"><span className="received"><i />Received</span><span className="verified"><i />Verified</span></div>}
        <p className="fine">
          Source: reports visible to your account. Grouped by submission week in Philippine time;
          verification reflects each report’s current state.
        </p>
        <details className="chart-data"><summary>View weekly data</summary><div className="table-scroll"><table>
          <caption className="sr-only">Weekly report cohorts</caption><thead><tr><th scope="col">Week</th><th scope="col">Received</th><th scope="col">Verified</th></tr></thead>
          <tbody>{trendRows.map((row) => <tr key={row.week}><th scope="row">{row.week}</th><td>{countFormatter.format(row.received)}</td><td>{countFormatter.format(row.verified)}</td></tr>)}</tbody>
        </table></div></details>
      </section>
      <section className="panel">
        <div className="panel-heading"><div className="overview-panel-title"><span className="overview-section-icon violet"><ChartNoAxesCombined size={17} /></span><div><h2>Reports by category</h2><p className="overview-panel-subtitle">Report counts received and verified by issue type</p></div></div></div>
        {categoryRows.length ? <ResponsiveContainer width="100%" height={Math.max(260, categoryRows.length * 34 + 24)}>
          <BarChart data={categoryRows} layout="vertical" margin={{ top: 2, left: 0, right: 20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e8efed" />
            <XAxis type="number" allowDecimals={false} tickCount={4} tick={{ fontSize: 12 }} tickFormatter={(value: number) => countFormatter.format(value)} />
            <YAxis type="category" dataKey="displayName" width={150} tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ border: "1px solid #e0eae8", borderRadius: 12, boxShadow: "0 8px 24px #173b3518", fontSize: 12 }} formatter={(value) => countFormatter.format(Number(value))} cursor={{ fill: "#f5f9f8" }} />
            <Bar name="Received" dataKey="received" fill="var(--brand-hover)" radius={[0, 4, 4, 0]} maxBarSize={12} />
            <Bar name="Verified" dataKey="verified" fill="var(--chart-verified)" radius={[0, 4, 4, 0]} maxBarSize={12} />
          </BarChart>
        </ResponsiveContainer> : <p className="empty">Category data will appear when reports are available.</p>}
        <div className="chart-legend" aria-label="Chart series"><span className="received"><i />Received</span><span className="verified"><i />Verified</span></div>
        <p className="fine">Source: reports visible to your account. Categories are ordered by received count; verification reflects each report’s current state.</p>
        <details className="chart-data"><summary>View category data</summary><div className="table-scroll"><table>
          <caption className="sr-only">Reports by category</caption><thead><tr><th scope="col">Category</th><th scope="col">Received</th><th scope="col">Verified</th></tr></thead>
          <tbody>{orderedCategories.map((row) => <tr key={row.name}><th scope="row"><ReportCategoryLabel name={row.name} compact /></th><td>{countFormatter.format(row.received)}</td><td>{countFormatter.format(row.verified)}</td></tr>)}</tbody>
        </table></div></details>
      </section>
    </div>
  );
}
export function Analytics({
  refs,
  initialBarangay = "",
  onCoordinate,
}: {
  refs: References;
  initialBarangay?: string;
  onCoordinate: (section: string, barangay: string) => void;
}) {
  const access = useAccess();
  const showPriority = canPrioritize(access);
  const [barangay, setBarangay] = useState(initialBarangay),
    [category, setCategory] = useState(""),
    [since, setSince] = useState(""),
    [until, setUntil] = useState(""),
    [status, setStatus] = useState(""),
    [office, setOffice] = useState(""),
    [detailId, setDetailId] = useState(""),
    [barangaySearch, setBarangaySearch] = useState(""),
    [sortBy, setSortBy] = useState<"name" | "received" | "verified" | "unresolved" | "recurring" | "priority">("received"),
    [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const invalidDates = !!(since && until && since > until);
  const q = useQuery({
    queryKey: ["analytics", barangay, category, since, until, status, office],
    enabled: !invalidDates,
    queryFn: () => result<AnalyticsData>(db!.rpc("geographic_analytics", {
      p_barangay: barangay || null, p_category: category || null,
      p_since: philippineDateBoundary(since), p_until: philippineDateBoundary(until, true),
      p_status: status || null, p_office: office || null,
    })),
  });
  const priorityQuery = useQuery({
    queryKey: ["priorities"],
    enabled: showPriority,
    queryFn: () => result<PrioritySummary[]>(db!.rpc("barangay_summary")),
  });
  const weightsQuery = useQuery({
    queryKey: ["weights"],
    enabled: showPriority,
    queryFn: () => result<{ count_weight: number; severity_weight: number; age_weight: number }>(db!.from("analytics_settings").select("count_weight,severity_weight,age_weight").single()),
  });
  const priorityById = useMemo(() => new Map((priorityQuery.data ?? []).map((row) => [row.id, row])), [priorityQuery.data]);
  const distributionRows = useMemo(() => [...(q.data?.barangays ?? [])]
    .filter((row) => (!barangay || row.id === barangay) && row.name.toLowerCase().includes(barangaySearch.trim().toLowerCase()))
    .sort((a, b) => {
      const order = sortBy === "name" ? a.name.localeCompare(b.name)
        : sortBy === "priority" ? Number(priorityById.get(a.id)?.score ?? 0) - Number(priorityById.get(b.id)?.score ?? 0)
        : Number(a[sortBy]) - Number(b[sortBy]);
      return sortDirection === "asc" ? order : -order;
    }), [q.data?.barangays, barangay, barangaySearch, priorityById, sortBy, sortDirection]);
  const changeSort = (key: typeof sortBy) => {
    if (sortBy === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDirection(key === "name" ? "asc" : "desc"); }
  };
  const exportAnalysis = () => {
    if (!q.data) return;
    downloadCsv("iligan-geographic-analysis.csv", [
      ["Iligan Connect · Geographic analysis"], ["Exported (UTC)", new Date().toISOString()],
      ["Filters", "Barangay: " + (refs.barangays.find((item) => item.id === barangay)?.name || "All permitted") + "; Category: " + (refs.categories.find((item) => item.id === category)?.name || "All") + "; Office: " + (refs.organizations.find((item) => item.id === office)?.name || "All") + "; Status: " + (status || "All") + "; From: " + (since || "Any") + "; Through: " + (until || "Any") + " (Philippine time)"],
      ["Method", "Permission-scoped saved report counts; no population normalization. Recurrence candidates require human review."],
      ...(showPriority ? [["Priority method", weightsQuery.data ? `Verified unresolved reports × ${weightsQuery.data.count_weight} + recorded severity × ${weightsQuery.data.severity_weight} + oldest unresolved age in days × ${weightsQuery.data.age_weight}; all-time, advisory only, human review required.` : "Uses configured count, severity and age weights; all-time, advisory only, human review required."]] : []),
      [], ["Metric", "Count"], ...Object.entries(q.data.counts).map(([key, value]) => [label(key), value]),
      [], ["Barangay", "Received", "Verified", "Unresolved", "Recurrence candidates", ...(showPriority ? ["Oldest unresolved (days)", "Assessment score"] : [])],
      ...q.data.barangays.map((row) => {
        const priority = priorityById.get(row.id);
        return [row.name, row.received, row.verified, row.unresolved, row.recurring, ...(showPriority ? [priority ? Math.floor(priority.oldest_days) : "", priority ? Number(priority.score).toFixed(1) : ""] : [])];
      }),
      [], ["Week (Philippine time)", "Received", "Verified"], ...[...q.data.trend].sort((a, b) => a.week.localeCompare(b.week)).map((row) => [row.week, row.received, row.verified]),
      [], ["Category", "Received", "Verified"], ...[...q.data.categories].sort((a, b) => b.received - a.received || reportCategoryPresentation(a.name).label.localeCompare(reportCategoryPresentation(b.name).label)).map((row) => [row.name, row.received, row.verified]),
    ]);
  };
  if (detailId) return <BarangayDetail key={detailId} id={detailId} refs={refs} onBack={() => setDetailId("")} onCoordinate={onCoordinate} />;
  return <div className="analytics-page">
    <section className="analytics-filter-card" aria-label="Geographic analysis filters">
      <label>Barangay<select value={barangay} onChange={(event) => setBarangay(event.target.value)}><option value="">All permitted</option>{refs.barangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All permitted</option>{refs.categories.map((item) => <option key={item.id} value={item.id}>{reportCategoryPresentation(item.name).label}</option>)}</select></label>
      <label>Office<select value={office} onChange={(event) => setOffice(event.target.value)}><option value="">All permitted</option>{refs.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{statuses.map((item) => <option value={item} key={item}>{label(item)}</option>)}</select></label>
      <label>From<input type="date" value={since} max={until || undefined} onChange={(event) => setSince(event.target.value)} /></label>
      <label>Through<input type="date" min={since || undefined} value={until} onChange={(event) => setUntil(event.target.value)} /></label>
      <div className="analytics-filter-actions">
        <button type="button" disabled={q.isFetching || invalidDates} onClick={exportAnalysis}><Download size={15} />Export analysis</button>
        <button type="button" className="secondary" disabled={q.isFetching || invalidDates} onClick={() => window.print()}><Printer size={15} />Print brief</button>
      </div>
    </section>
    <p className="analytics-result-meta" role="status">{invalidDates ? "Choose an end date on or after the start date." : q.isFetching ? "Updating analysis…" : "Filtered report data · Philippine time"}</p>
    {invalidDates ? <p className="error analytics-error" role="alert">The end date must be on or after the start date.</p> : q.isPending ? <div className="analytics-loading" role="status" aria-label="Calculating geographic analysis"><span /><span /><span /><span /><span /><span /></div> : q.error ? <p role="alert" className="error">{q.error.message}</p> : q.data ? <>
      <p className="print-context">Iligan Connect · Geographic assessment · {new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}<br />
        Scope: {refs.barangays.find((item) => item.id === barangay)?.name || "All permitted barangays"} · {category ? reportCategoryPresentation(refs.categories.find((item) => item.id === category)?.name || "").label : "All categories"} · {refs.organizations.find((item) => item.id === office)?.name || "All permitted offices"} · {status ? label(status) : "All statuses"}<br />
        {since || "All dates"} – {until || "Present"} (Philippine time).</p>
      <section className="analytics-kpis" aria-label="Report summary">
        {[
          { key: "total", title: "Received", note: "Submissions in this scope", Icon: FileText, tone: "blue" },
          { key: "verified", title: "Distinct verified", note: "Verified, non-duplicate issues", Icon: BadgeCheck, tone: "teal" },
          { key: "unresolved", title: "Unresolved verified", note: "Verified and still open", Icon: CircleAlert, tone: "red" },
          { key: "resolved", title: "Resolved", note: "Marked as resolved", Icon: CheckCircle2, tone: "green" },
          { key: "review", title: "Awaiting review", note: "Submitted or under review", Icon: Clock3, tone: "amber" },
          { key: "recurring", title: "Recurrence candidates", note: "Require human review", Icon: Activity, tone: "violet" },
        ].map(({ key, title, note, Icon, tone }) => <article className="analytics-kpi" key={key}>
          <span className={"analytics-kpi-icon " + tone}><Icon size={19} aria-hidden="true" /></span>
          <div><span className="analytics-kpi-title">{title}</span><strong>{q.data.counts[key] ?? 0}</strong><small>{note}</small></div>
        </article>)}
      </section>
      <Charts data={q.data} variant="analytics" />
      <section className="panel analytics-distribution section-gap">
        <div className="analytics-section-heading">
          <div className="overview-panel-title"><span className="overview-section-icon teal"><MapPinned size={18} aria-hidden="true" /></span><div><h2>Geographic distribution</h2><p className="overview-panel-subtitle">Compare reports, review barangay priorities, and open local details.</p></div></div>
          <label className="analytics-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search barangay</span><input maxLength={200} type="search" placeholder="Search barangay…" value={barangaySearch} onChange={(event) => setBarangaySearch(event.target.value)} /></label>
        </div>
        <div className="table-scroll"><table className="analytics-table">
          <caption className="sr-only">Report counts{showPriority ? " and priority scores" : ""} by barangay</caption>
          <thead><tr>
            <th scope="col" aria-sort={sortBy === "name" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="analytics-sort" onClick={() => changeSort("name")}>Barangay <span aria-hidden="true">{sortBy === "name" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</span></button></th>
            {(["received", "verified", "unresolved", "recurring"] as const).map((key) => <th scope="col" key={key} aria-sort={sortBy === key ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="analytics-sort" onClick={() => changeSort(key)}>{({ received: "Received", verified: "Verified", unresolved: "Unresolved", recurring: "Recurrence candidates" })[key]} <span aria-hidden="true">{sortBy === key ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</span></button></th>)}
            {showPriority && <th scope="col" aria-sort={sortBy === "priority" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="analytics-sort" onClick={() => changeSort("priority")}>Priority score <span aria-hidden="true">{sortBy === "priority" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</span></button></th>}
            <th scope="col">Action</th>
          </tr></thead>
          <tbody>{distributionRows.map((row) => <tr key={row.id}>
            <th scope="row"><span className="analytics-barangay-name">{row.name}</span></th>
            <td>{row.received}</td><td>{row.verified}</td><td>{row.unresolved}</td><td>{row.recurring}</td>
            {showPriority && <td className="analytics-priority-cell">{priorityQuery.isPending ? <span className="analytics-priority-loading">Loading…</span> : priorityById.has(row.id) ? <><strong>{Number(priorityById.get(row.id)?.score ?? 0).toFixed(1)}</strong><small>Oldest open · {Math.floor(priorityById.get(row.id)?.oldest_days ?? 0)} days</small></> : <span className="analytics-priority-loading">Unavailable</span>}</td>}
            <td><button type="button" className="analytics-view-detail" onClick={() => setDetailId(row.id)}>View details <ArrowUpRight size={14} aria-hidden="true" /></button></td>
          </tr>)}</tbody>
        </table></div>
        {!distributionRows.length && <p className="empty">No barangays match this search and filter.</p>}
        {showPriority && <div className="analytics-priority-note" role={priorityQuery.error ? "status" : undefined}>
          <strong>{priorityQuery.error ? "Priority assessment is temporarily unavailable." : "Advisory priority · human review required"}</strong>
          <p>{priorityQuery.error ? "Report totals and geographic analysis remain available." : <>{weightsQuery.data ? <>Score = verified unresolved reports × {weightsQuery.data.count_weight} + recorded severity × {weightsQuery.data.severity_weight} + oldest unresolved age (days) × {weightsQuery.data.age_weight}.</> : "Score uses verified unresolved count, recorded severity, and oldest unresolved age with configured weights."} Scores use all-time records, separate from the filters above; they guide review and do not establish urgency or allocate resources.{weightsQuery.error ? " The configured weights could not be loaded." : ""}</>}</p>
        </div>}
      </section>
      <p className="fine analytics-method-note">Verified counts exclude rejected and duplicate records. Recurrence candidates identify nearby reports within the configured category and time window; staff must review them. Raw counts reflect reporting activity, not population-adjusted risk or severity.</p>
    </> : null}
  </div>;
}
function BarangayDetail({
  id,
  refs,
  onBack,
  onCoordinate,
}: {
  id: string;
  refs: References;
  onBack: () => void;
  onCoordinate: (section: string, barangay: string) => void;
}) {
  const access = useAccess();
  const canAssess = access.profile.role === "admin" ||
    (access.profile.role === "barangay" && access.profile.barangay_id === id);
  const [note, setNote] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["barangay-detail", id],
    queryFn: async () => ({
      analytics: await result<AnalyticsData>(db!.rpc("geographic_analytics", { p_barangay: id })),
      reports: await result<Report[]>(db!.from("reports").select("*").eq("barangay_id", id).not("status", "in", "(resolved,rejected,duplicate)").order("created_at", { ascending: false }).limit(20)),
      assessments: await result<{ id: string; assessment: string; created_at: string }[]>(db!.from("issue_assessments").select("id,assessment,created_at").eq("barangay_id", id).order("created_at", { ascending: false }).limit(10)),
      consultations: await result<{ id: string; title: string; status: string }[]>(db!.from("consultations").select("id,title,status").eq("barangay_id", id).order("created_at", { ascending: false }).limit(10)),
      meetings: await result<{ id: string; title: string; status: string }[]>(db!.from("meeting_requests").select("id,title,status").eq("barangay_id", id).order("created_at", { ascending: false }).limit(10)),
      announcements: await result<{ id: string; title: string; status: string }[]>(db!.from("announcements").select("id,title,status").eq("barangay_id", id).order("created_at", { ascending: false }).limit(10)),
    }),
  });
  const barangay = refs.barangays.find((item) => item.id === id)?.name || "Barangay";
  if (q.isPending) return <div className="analytics-page" role="status"><button className="secondary" onClick={onBack}>Back to geographic analytics</button><p className="empty">Loading {barangay} details…</p></div>;
  if (q.error) return <div className="analytics-page"><button className="secondary" onClick={onBack}>Back to geographic analytics</button><div role="alert" className="error"><p>{q.error.message}</p><button className="secondary" onClick={() => void q.refetch()}>Retry local details</button></div></div>;
  const analyticsData = q.data.analytics;
  const summary = analyticsData.barangays.find((item) => item.id === id);
  const activeReports = q.data?.reports || [];
  const categoryTotals = analyticsData.categories.filter((item) => item.received > 0).sort((a, b) => b.received - a.received);
  const reportTotal = Math.max(summary?.received ?? 0, 1);
  const detailMetrics: { title: string; value: number; Icon: LucideIcon; tone: string }[] = [
    { title: "Received", value: summary?.received ?? 0, Icon: FileText, tone: "blue" },
    { title: "Verified", value: summary?.verified ?? 0, Icon: BadgeCheck, tone: "teal" },
    { title: "Unresolved", value: summary?.unresolved ?? 0, Icon: CircleAlert, tone: "red" },
    { title: "Resolved", value: analyticsData.counts.resolved ?? 0, Icon: CheckCircle2, tone: "green" },
    { title: "Recurrence candidates", value: summary?.recurring ?? 0, Icon: Activity, tone: "violet" },
  ];
  const quickPrompts = ["What evidence supports this assessment?", "Which areas or residents are affected?", "What are the recommended next steps?"];
  const fmtDate = (value: string) => new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(value));
  const addAssessment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (note.trim().length < 5) { setMessage("Add a little more detail before recording this assessment."); return; }
    setBusy(true); setMessage("");
    try {
      await result(db!.from("issue_assessments").insert({ barangay_id: id, assessment: note.trim() }));
      setNote(""); setMessage("Assessment recorded.");
      await qc.invalidateQueries({ queryKey: ["barangay-detail", id] });
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="analytics-page analytics-detail-page">
    <div className="analytics-detail-heading">
      <div><button className="analytics-back" type="button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Back to geographic analytics</button><p className="eyebrow">REPORTING &amp; COORDINATION</p><h1>{barangay} · Local detail</h1><p>All-time reports and coordination activity for this barangay within your authorized scope. Filters from the comparison view do not apply here.</p></div>
      <div className="analytics-detail-actions">{canCreate(access, "consultations") && <button type="button" onClick={() => onCoordinate("Consultations", id)}>Begin consultation</button>}<button type="button" className="secondary" onClick={() => onCoordinate("Meeting requests", id)}>Review meetings</button></div>
    </div>
    <section className="analytics-detail-summary" aria-label={`${barangay} report summary`}>
      <div className="analytics-detail-summary-title"><strong>Your geographic coverage</strong><span>{barangay} at a glance</span></div>
      {detailMetrics.map(({ title, value, Icon, tone }) => <div className="analytics-detail-metric" key={title}><span className={`analytics-detail-metric-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span><span><strong>{value}</strong><small>{title}</small></span></div>)}
    </section>
    <div className="analytics-detail-map-layout">
      <section className="panel analytics-detail-map-card"><div className="analytics-section-heading"><div><h2>Issue map</h2><p className="overview-panel-subtitle">Report locations and concentration in {barangay}.</p></div><span className="analytics-scope-tag"><MapPin size={14} aria-hidden="true" />{barangay}</span></div><IssueMap key={id} refs={refs} compact initialBarangay={id} hideReportList /></section>
      <aside className="panel analytics-map-insights"><div className="overview-panel-title"><span className="overview-section-icon teal"><ChartNoAxesCombined size={17} aria-hidden="true" /></span><div><h2>Map insights</h2><p className="overview-panel-subtitle">A quick read of the selected area.</p></div></div>
        <div className="analytics-insight-total"><MapPin size={17} aria-hidden="true" /><span><strong>{summary?.received ?? 0} reports</strong><small>Assigned to {barangay}</small></span></div>
        <h3 className="analytics-insight-heading">Reports by category</h3>
        <div className="analytics-insight-list" aria-label="Reports by category">{categoryTotals.map((item) => {
          const share = Math.round(item.received / reportTotal * 100);
          return <div key={item.name}><div className="analytics-insight-row"><ReportCategoryLabel name={item.name} compact /><strong>{item.received}</strong></div><div className="analytics-insight-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></div></div>;
        })}</div>
        <p className="fine">Counts reflect reports in the authorized data scope. Map pins and heat show only usable saved locations inside the barangay boundary.</p>
        <div className="analytics-coordination-links"><h3>Coordination &amp; notes</h3><button type="button" onClick={() => onCoordinate("Issue reports", id)}><span><FileText size={16} /><strong>{summary?.received ?? 0} reports assigned</strong><small>Review reports in this area</small></span><ArrowUpRight size={15} /></button><button type="button" onClick={() => onCoordinate("Announcements", id)}><span><Activity size={16} /><strong>{categoryTotals.length} issue categories</strong><small>See current local reporting mix</small></span><ArrowUpRight size={15} /></button><button type="button" onClick={() => onCoordinate("Meeting requests", id)}><span><CalendarDays size={16} /><strong>Community coordination</strong><small>Meetings and requests for {barangay}</small></span><ArrowUpRight size={15} /></button></div>
      </aside>
    </div>
    <div className="analytics-detail-workspace">
      <section className="panel analytics-active-reports"><div className="analytics-section-heading"><div><h2>Active reports &amp; assigned offices</h2><p className="overview-panel-subtitle">Up to 20 latest reports that need action or are currently in progress.</p></div><button type="button" className="analytics-text-action" onClick={() => onCoordinate("Issue reports", id)}>View all reports <ArrowUpRight size={14} /></button></div>
        {q.isPending ? <div className="analytics-detail-skeleton" aria-label="Loading active reports"><i /><i /><i /></div> : <div className="table-scroll"><table className="analytics-table analytics-active-table"><thead><tr><th scope="col">Report</th><th scope="col">Category</th><th scope="col">Assigned office</th><th scope="col">Status</th><th scope="col">Date reported</th></tr></thead><tbody>{activeReports.map((report) => <tr key={report.id}><th scope="row"><strong>{report.title}</strong><small>#{report.id.slice(0, 8).toUpperCase()}</small></th><td data-label="Category"><ReportCategoryLabel name={refs.categories.find((item) => item.id === report.category_id)?.name || ""} compact /></td><td data-label="Assigned office">{refs.organizations.find((item) => item.id === report.organization_id)?.name || "Awaiting assignment"}</td><td data-label="Status"><span className={`analytics-status status-${report.status}`}>{label(report.status)}</span></td><td data-label="Date reported"><time dateTime={report.created_at}>{fmtDate(report.created_at)}</time></td></tr>)}</tbody></table>{!activeReports.length && !q.error && <p className="empty">No active reports need action in {barangay}.</p>}</div>}
      </section>
      <section className="panel analytics-assessment"><h2>Human assessment</h2><p className="overview-panel-subtitle">Record the evidence, interpretation, and suggested next step.</p>
        {canAssess ? <form className="analytics-assessment-form" onSubmit={addAssessment}><label htmlFor="analytics-assessment-note">Assessment</label><textarea id="analytics-assessment-note" required minLength={5} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describe what you observed, who is affected, and what should happen next." /><small className="analytics-character-count">{note.length}/4000</small><div className="analytics-quick-prompts"><span>Quick prompts</span>{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => setNote((current) => current ? `${current.trim()}\n${prompt} ` : `${prompt} `)}>{prompt}</button>)}</div><button type="submit" disabled={busy || note.trim().length < 5}>{busy ? "Recording…" : "Record assessment"}</button><p role="status" className={message.includes("recorded") ? "success" : "analytics-form-message"}>{message}</p></form> : <p className="fine">Assessments are available to authorized barangay personnel and system administrators.</p>}
        {q.data?.assessments.length ? <div className="analytics-assessment-history"><h3>Recent assessments</h3>{q.data.assessments.map((assessment) => <article key={assessment.id}><p>{assessment.assessment}</p><time dateTime={assessment.created_at}>{new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(assessment.created_at))}</time></article>)}</div> : null}
      </section>
    </div>
    <section className="panel analytics-coordination-history"><div className="analytics-section-heading"><div><h2>Coordination history</h2><p className="overview-panel-subtitle">Consultations, meetings, and announcements for this barangay.</p></div></div>{q.isPending ? <p className="empty">Loading coordination activity…</p> : <div className="analytics-history-grid">{(["consultations", "meetings", "announcements"] as const).map((key) => <section key={key}><h3>{label(key)}</h3>{q.data?.[key].map((item) => <article key={item.id}><span className="analytics-history-icon">{key === "meetings" ? <CalendarDays size={16} /> : key === "announcements" ? <Activity size={16} /> : <UsersRound size={16} />}</span><span><strong>{item.title}</strong><small>{label(item.status)}</small></span><ArrowUpRight size={14} aria-hidden="true" /></article>)}{!q.data?.[key].length && <p className="muted">No {label(key).toLowerCase()} recorded.</p>}</section>)}</div>}</section>
  </div>;
}
