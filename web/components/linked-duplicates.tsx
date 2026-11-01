"use client";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Copy, RefreshCw } from "lucide-react";
import { label, type Status } from "@community/shared";
import { db, result } from "../lib/client";

type LinkedReports = {
  items: { id: string; title: string; status: "duplicate"; created_at: string; reason: string }[];
  total_count: number; offset: number; page_size: number;
};
type MainProgress = {
  main_report_id: string; status: Status; organization_name: string | null;
  main_title: string | null; can_open_main: boolean;
  history: { id: number; new_status: Status; created_at: string }[];
};
const date = (value: string) => new Date(value).toLocaleString("en-PH", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila",
});

export function LinkedDuplicateReports({ reportId, onOpen }: { reportId: string; onOpen?: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const q = useQuery({
    queryKey: ["linked-duplicates", reportId, page], staleTime: 30_000, refetchInterval: expanded ? 30_000 : false, placeholderData: keepPreviousData,
    queryFn: ({ signal }) => result<LinkedReports>(db!.rpc("report_linked_duplicates", { p_id: reportId, p_offset: page * 20 }).abortSignal(signal)),
  });
  const isStale = q.isStale;
  useEffect(() => {
    if (q.data) setPage(value => Math.min(value, Math.max(0, Math.ceil(q.data.total_count / 20) - 1)));
  }, [q.data]);
  if (q.data?.total_count === 0 && !q.error) return null;
  return <section className="report-workspace-section linked-duplicates" aria-label="Linked duplicate reports">
    {q.isPending ? <p className="linked-report-state" role="status">Checking linked duplicate reports…</p>
      : q.error ? <div className="linked-report-state" role="alert"><p>Linked duplicate reports could not be loaded.</p><button type="button" className="secondary" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw size={16} />Retry linked reports</button></div>
      : q.data && <details className="linked-report-group" open={expanded} onToggle={event => { const open = event.currentTarget.open; setExpanded(open); if (open && isStale) void q.refetch(); }}>
        <summary><Copy size={21} aria-hidden="true" /><strong>Linked duplicate reports</strong><span className="linked-report-count" aria-label={`${q.data.total_count} linked report${q.data.total_count === 1 ? "" : "s"}`}>{q.data.total_count}</span><ChevronDown size={18} aria-hidden="true" /></summary>
        <p className="linked-report-intro">Confirmed duplicates linked to this main report, within your access. Their progress follows this report.</p>
        <div className="linked-report-list">{q.data.items.map(item => <article key={item.id}>
          <div className="linked-report-copy"><h4>{item.title}</h4><p className="linked-report-meta">Submitted {date(item.created_at)}</p></div>
          {onOpen && <button type="button" className="secondary linked-report-open" onClick={() => onOpen(item.id)} aria-label={`Open linked duplicate report: ${item.title}`}>Open report<ArrowUpRight size={16} aria-hidden="true" /></button>}
          <details className="linked-report-details"><summary aria-label={`Link details for ${item.title}`}>Link details<ChevronDown size={16} aria-hidden="true" /></summary><p className="linked-report-reason"><strong>Link reason:</strong> {item.reason}</p><span className="linked-report-id">Report ID: {item.id}</span></details>
        </article>)}</div>
        {q.data.total_count > 20 && <nav className="linked-report-pagination" aria-label="Linked duplicate pages" aria-busy={q.isFetching}><span role="status">{q.isPlaceholderData ? "Loading linked reports…" : `Page ${page + 1} of ${Math.max(1, Math.ceil(q.data.total_count / 20))}`}</span><div><button type="button" className="secondary" aria-label="Previous linked duplicate page" aria-disabled={!page || q.isFetching} onClick={() => { if (page && !q.isFetching) setPage(value => value - 1); }}><ChevronLeft size={17} /></button><button type="button" className="secondary" aria-label="Next linked duplicate page" aria-disabled={(page + 1) * 20 >= q.data.total_count || q.isFetching} onClick={() => { if ((page + 1) * 20 < q.data.total_count && !q.isFetching) setPage(value => value + 1); }}><ChevronRight size={17} /></button></div></nav>}
      </details>}
  </section>;
}

export function DuplicateMainProgress({ reportId, onOpen }: { reportId: string; onOpen?: (id: string) => void }) {
  const q = useQuery({
    queryKey: ["duplicate-progress", reportId], staleTime: 30_000, refetchInterval: 30_000,
    queryFn: ({ signal }) => result<MainProgress | null>(db!.rpc("report_duplicate_progress", { p_id: reportId }).abortSignal(signal)),
  });
  return <section className="report-workspace-section duplicate-main-progress" aria-labelledby="duplicate-main-heading">
    <div className="report-workspace-section-heading"><Copy size={22} aria-hidden="true" /><div><h3 id="duplicate-main-heading">Linked to a main report</h3><p>This submission describes the same incident. Work and progress are tracked on the main report.</p></div></div>
    {q.isPending ? <p className="linked-report-state" role="status">Loading main report progress…</p>
      : q.error ? <div className="linked-report-state" role="alert"><p>Main report progress could not be refreshed.</p><button type="button" className="secondary" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw size={16} />Retry main report progress</button></div>
      : !q.data ? <p className="linked-report-state">Main report progress is unavailable. Ask the reviewing team to check this report’s link.</p>
      : <>
        <div className="duplicate-main-overview"><div><span className="linked-report-meta">Main report progress</span><strong className="duplicate-main-status">{label(q.data.status)}</strong>{q.data.main_title && <p>{q.data.main_title}</p>}<p className="linked-report-meta">Assigned office: {q.data.organization_name || "Awaiting assignment"}</p></div>{onOpen && q.data.can_open_main && <button type="button" className="secondary" onClick={() => onOpen(q.data!.main_report_id)}>Open main report<ArrowUpRight size={16} aria-hidden="true" /></button>}</div>
        {!!q.data.history.length && <details className="duplicate-main-timeline"><summary>Main report progress history<ChevronDown size={17} aria-hidden="true" /></summary><ol>{[...q.data.history].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(event => <li key={event.id}><strong>{label(event.new_status)}</strong><time dateTime={event.created_at}>{date(event.created_at)}</time></li>)}</ol></details>}
      </>}
  </section>;
}
