"use client";
import { useQuery } from "@tanstack/react-query";
import { withTitle, withTitles } from "../lib/report-title";
import { useEffect, useState } from "react";
import { ChevronDown, Copy, Image as ImageIcon, MapPin, RefreshCw } from "lucide-react";
import { label, type Report, type Status } from "@community/shared";
import { db, result } from "../lib/client";

type Candidate = {
  id: string; title: string; description: string; landmark: string; status: Status;
  created_at: string; distance_m: number; days_apart: number; same_problem: boolean;
  text_similarity: number; match_strength: "strong" | "possible";
  problem_label: string | null; barangay_name: string;
};
export type DuplicateCandidateOption = Pick<Candidate, "id" | "title">;
type ComparisonPhoto = { path: string; url: string | null };

async function loadComparisonPhotos(reportIds: [string, string], signal: AbortSignal): Promise<[ComparisonPhoto[], ComparisonPhoto[]]> {
  const fileLists = await Promise.all(reportIds.map((reportId) => result<{ path: string }[]>(
    db!.from("report_attachments").select("path").eq("report_id", reportId).is("action_id", null).order("created_at", { ascending: true }).limit(4).abortSignal(signal),
  )));
  const paths = fileLists.flatMap((files) => files.map(({ path }) => path));
  if (!paths.length) return [[], []];
  const { data, error } = await db!.storage.from("report-evidence").createSignedUrls(paths, 3600);
  if (error) throw new Error(error.message);
  const photos = fileLists.map((files) => files.map(({ path }) => ({ path, url: data?.find((item) => item.path === path)?.signedUrl ?? null })));
  return [photos[0], photos[1]];
}

const date = (value: string) => new Date(value).toLocaleString("en-PH", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila",
});

function DuplicateComparison({ report, candidate }: { report: Report; candidate: Candidate }) {
  const [open, setOpen] = useState(false);
  const photoQuery = useQuery({
    queryKey: ["duplicate-comparison-photos", report.id, candidate.id],
    enabled: open,
    staleTime: 30_000,
    queryFn: ({ signal }) => loadComparisonPhotos([report.id, candidate.id], signal),
  });
  const items = [
    { ...report, heading: "Report being reviewed", area: "" },
    { ...candidate, heading: "Possible main report", area: candidate.barangay_name },
  ];
  return <details className="duplicate-comparison" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Compare reports<ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="duplicate-comparison-grid">
      {items.map((item, index) => <article key={item.id} className={"duplicate-compare-card" + (index ? " is-candidate" : " is-current")}>
        <header className="duplicate-compare-top">
          <span className="duplicate-compare-tag">{index ? "Possible main report" : "Reviewing"}</span>
          <span className={`badge ${item.status}`}>{label(item.status)}</span>
        </header>
        <h5>{item.title}</h5>
        <p className="duplicate-compare-meta"><time dateTime={item.created_at}>{date(item.created_at)}</time>{item.area && <><span aria-hidden="true">·</span><span className="duplicate-compare-area"><MapPin size={13} aria-hidden="true" />{item.area}</span></>}</p>
        <blockquote className="duplicate-compare-quote" role="region" aria-label={`${item.heading} description`} tabIndex={0}>{item.description}</blockquote>
        <div className="duplicate-comparison-photos" aria-label={`${item.heading} photos`}>
          {photoQuery.isPending ? <p className="duplicate-comparison-photo-state" role="status">Loading photos…</p>
            : photoQuery.error ? <p className="duplicate-comparison-photo-state" role="status">Photos could not load.</p>
              : photoQuery.data?.[index]?.length ? <div className="duplicate-comparison-photo-grid">
                {photoQuery.data[index].map((photo, photoIndex) => photo.url
                  ? <a className="duplicate-comparison-photo" key={photo.path} href={photo.url} target="_blank" rel="noreferrer" aria-label={`Open photo ${photoIndex + 1} for ${item.heading}`}>
                    <img src={photo.url} alt={`${item.heading} photo ${photoIndex + 1}`} loading="lazy" />
                  </a>
                  : <span className="duplicate-comparison-photo duplicate-comparison-photo-unavailable" key={photo.path}><ImageIcon size={18} aria-label="Photo preview unavailable" /></span>)}
              </div>
                : <p className="duplicate-comparison-photo-state"><ImageIcon size={14} aria-hidden="true" /> No photos attached</p>}
        </div>
        <dl className="duplicate-compare-facts">
          <div><dt>Landmark</dt><dd>{item.landmark?.trim() || "Not provided"}</dd></div>
          <div><dt>Report ID</dt><dd className="mono" title={item.id}>{item.id.slice(0, 8).toUpperCase()}</dd></div>
        </dl>
      </article>)}
    </div>
    {candidate.problem_label && <p className="duplicate-comparison-note">Suggested report’s problem: {candidate.problem_label}</p>}
    {candidate.status === "resolved" && <p className="duplicate-comparison-note">This report was resolved. Check whether the new report describes a fresh incident before linking it.</p>}
  </details>;
}

export function DuplicateReview({ report, onCandidatesChange }: {
  report: Report;
  onCandidatesChange: (candidates: DuplicateCandidateOption[]) => void;
}) {
  const q = useQuery({
    queryKey: ["duplicate-candidates", report.id], staleTime: 30_000,
    queryFn: ({ signal }) => result<Candidate[]>(db!.rpc("report_duplicate_candidates", { p_id: report.id }).abortSignal(signal)).then(withTitles),
  });
  useEffect(() => {
    onCandidatesChange(q.data?.map(({ id, title }) => ({ id, title })) ?? []);
  }, [q.data, onCandidatesChange]);
  return <section className="report-workspace-section duplicate-review" aria-labelledby="duplicate-review-title">
    <div className="report-workspace-section-heading">
      <Copy size={22} aria-hidden="true" />
      <div><h3 id="duplicate-review-title">Possible duplicates</h3><p>Compare the details before deciding. Suggestions never change a report automatically.</p></div>
      {!!q.data?.length && <span className="duplicate-review-count">{q.data.length} to review</span>}
    </div>
    <details className="duplicate-review-method"><summary>How suggestions are found<ChevronDown size={16} aria-hidden="true" /></summary><p>Compares nearby reports you can access in the same category, within 150 m and reported within 30 days of this report. Location, problem type and shared title wording help identify possible matches. Nearby reports can still describe different issues.</p></details>
    {q.isPending ? <p className="duplicate-review-state" role="status">Checking nearby reports for possible duplicates…</p>
      : q.error ? <div className="duplicate-review-state" role="alert"><p>Possible duplicates could not be checked. You can continue reviewing this report.</p><button type="button" className="secondary" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw size={16} aria-hidden="true" />{q.isFetching ? "Checking…" : "Retry duplicate check"}</button></div>
      : !q.data?.length ? <p className="duplicate-review-state">No possible duplicates found in the checked area and period. This does not confirm the report is unique.</p>
      : <div className="duplicate-candidate-list">{q.data.map(candidate => <article className="duplicate-candidate" key={candidate.id}>
        <div className="duplicate-candidate-heading"><span className={`duplicate-match ${candidate.match_strength}`}>{candidate.match_strength === "strong" ? "Closer match" : "Possible match"}</span><span className="duplicate-candidate-status">{label(candidate.status)}</span></div>
        <h4>{candidate.title}</h4>
        <ul className="duplicate-signals" aria-label="Why this report was suggested">
          <li><MapPin size={13} aria-hidden="true" />{candidate.distance_m < 1 ? "Less than 1 m away" : `${Math.round(candidate.distance_m)} m away`}</li>
          <li>{candidate.days_apart < 1 ? "Reported less than a day apart" : `Reported ${Math.round(candidate.days_apart)} day${Math.round(candidate.days_apart) === 1 ? "" : "s"} apart`}</li>
          {candidate.same_problem && <li>Same problem type</li>}
          {candidate.text_similarity >= .35 && <li>Shared wording</li>}
        </ul>
        <DuplicateComparison report={report} candidate={candidate} />
      </article>)}</div>}
  </section>;
}
