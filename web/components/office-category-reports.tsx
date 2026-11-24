"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Report, label, reportStatusLabel } from "@community/shared";
import { db, result } from "../lib/client";
import { useDebouncedValue } from "../lib/use-debounced-value";
import { permissionFingerprint } from "../lib/access";
import { reportCategoryPresentation, ReportCategoryLabel } from "./report-category";
import { ReportDetail } from "./reports";
import { useAccess } from "./access-context";
import type { References } from "./workspace";

const barangayHandledStatuses = ["verified", "scheduled", "in_progress", "resolved"] as const;

export function OfficeCategoryReports({ refs }: { refs: References }) {
  const access = useAccess();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [barangay, setBarangay] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Report | null>(null);
  const term = useDebouncedValue(search.trim());
  const organizations = access.organizations.filter((organization) => organization.active).map((organization) => organization.id);
  const rules = access.rules.filter((rule) => rule.enabled && organizations.includes(rule.organization_id));
  const allowedCategories = refs.categories.filter((item) => rules.some((rule) => rule.category_id === item.id));
  const hasCitywideCoverage = rules.some((rule) => rule.barangay_id === null);
  const allowedBarangays = hasCitywideCoverage ? refs.barangays : refs.barangays.filter((item) => rules.some((rule) => rule.barangay_id === item.id));
  const query = useQuery({
    queryKey: ["office-category-reports", page, term, category, barangay, status, permissionFingerprint(access)],
    queryFn: async () => {
      let request = db!.from("reports").select("*", { count: "exact" })
        .is("organization_id", null).not("verified_at", "is", null).in("status", [...barangayHandledStatuses]);
      if (!allowedCategories.length) request = request.eq("id", "00000000-0000-0000-0000-000000000000");
      else request = request.in("category_id", allowedCategories.map((item) => item.id));
      if (category) request = request.eq("category_id", category);
      if (barangay) request = request.eq("barangay_id", barangay);
      if (status) request = request.eq("status", status);
      if (term) request = request.ilike("title", `%${term.replace(/[\\%_]/g, "\\$&")}%`);
      const { data, count, error } = await request.order("created_at", { ascending: false }).order("id").range(page * 20, page * 20 + 19);
      if (error) throw new Error(error.message);
      return { rows: data as Report[], count: count ?? 0 };
    },
  });
  const pageCount = Math.max(1, Math.ceil((query.data?.count ?? 0) / 20));

  return <>
    <section className="office-category-reports panel">
      <div className="office-category-intro">
        <span className="office-category-readonly">Read-only</span>
        <button className="secondary" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15} aria-hidden="true" />Refresh</button>
      </div>
      <div className="office-category-filters">
        <label className="search-field staff-search-field"><span className="sr-only">Search report titles</span><input value={search} maxLength={160} placeholder="Search report titles" onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
        <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); setPage(0); }}><option value="">All permitted categories</option>{allowedCategories.map((item) => <option key={item.id} value={item.id}>{reportCategoryPresentation(item.name).label}</option>)}</select></label>
        <label>Barangay<select value={barangay} onChange={(event) => { setBarangay(event.target.value); setPage(0); }}><option value="">All permitted barangays</option>{allowedBarangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="">All reviewed statuses</option>{barangayHandledStatuses.map((item) => <option key={item} value={item}>{reportStatusLabel(item)}</option>)}</select></label>
      </div>
      <div className="results-heading"><p role="status">{query.isFetching || search.trim() !== term ? "Updating results…" : `${query.data?.count ?? 0} reports in your approved category coverage`}</p></div>
      {query.isPending ? <div className="loading-stack" role="status" aria-label="Loading category reports">{[1, 2, 3].map((item) => <div className="skeleton" key={item} />)}</div>
        : query.error ? <div className="error" role="alert"><p>{query.error.message}</p><button className="secondary" type="button" onClick={() => void query.refetch()}>Try again</button></div>
          : query.data.rows.length ? <div className="table-scroll">
            <table className="reports-table office-category-table"><caption className="sr-only">Barangay-managed reports within approved office coverage</caption>
              <thead><tr><th scope="col">Report</th><th scope="col">Location &amp; category</th><th scope="col">Status</th><th scope="col">Assessment</th><th scope="col">Received</th></tr></thead>
              <tbody>{query.data.rows.map((report) => {
                const categoryName = refs.categories.find((item) => item.id === report.category_id)?.name || "Other";
                const barangayName = refs.barangays.find((item) => item.id === report.barangay_id)?.name || "Iligan City";
                return <tr key={report.id} className="report-row-clickable" onClick={() => setSelected(report)}>
                  <th scope="row"><button className="report-title" onClick={() => setSelected(report)}><span>{report.title}</span><ChevronRight size={15} aria-hidden="true" /></button>{report.public_summary && report.public_summary.trim().toLowerCase() !== report.title.trim().toLowerCase() && <small className="office-category-summary">{report.public_summary}</small>}<small className="mono">{report.id.slice(0, 8).toUpperCase()}</small></th>
                  <td data-label="Location & category"><span className="office-category-location">{barangayName}</span><ReportCategoryLabel compact name={categoryName} className="report-category" /></td>
                  <td data-label="Status"><span className={`badge ${report.status}`}>{label(report.status)}</span></td>
                  <td data-label="Assessment">{report.severity == null && report.urgency == null ? "—" : `Severity ${report.severity ?? "—"}/5 · Urgency ${report.urgency ?? "—"}/5`}</td>
                  <td data-label="Received"><time dateTime={report.created_at}>{new Date(report.created_at).toLocaleDateString("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" })}</time></td>
                </tr>;
              })}</tbody>
            </table>
          </div> : <div className="office-category-empty"><strong>No barangay-managed reports match these filters</strong><span>Reports routed to an office appear under Ready for action or Resolved in Issue reports.</span></div>}
      <div className="pagination"><span>Page {page + 1} of {pageCount} · {query.data?.count ?? 0} reports</span><div><button className="secondary" type="button" disabled={page === 0 || query.isFetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button className="secondary" type="button" disabled={!query.data || (page + 1) * 20 >= query.data.count || query.isFetching} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </section>
    <p className="fine">Category reports are for reference. Status changes, scheduling, photos, and follow-up are available only after a report is routed to your organization.</p>
    {selected && <ReportDetail key={selected.id} report={selected} refs={refs} close={() => setSelected(null)} readOnly />}
  </>;
}
