"use client";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, MapPin, RefreshCw } from "lucide-react";
import { label, type Report, type Status } from "@community/shared";
import { db, result } from "../lib/client";

type Candidate = {
  id: string; title: string; description: string; landmark: string; status: Status;
  created_at: string; distance_m: number; days_apart: number; same_problem: boolean;
  text_similarity: number; match_strength: "strong" | "possible";
  problem_label: string | null; barangay_name: string;
};
const date = (value: string) => new Date(value).toLocaleString("en-PH", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila",
});

export function DuplicateReview({ report, canChoose, selectedId, onChoose }: {
  report: Report; canChoose: boolean; selectedId: string;
  onChoose: (candidate: Pick<Candidate, "id" | "title">) => void;
}) {
  const q = useQuery({
    queryKey: ["duplicate-candidates", report.id], staleTime: 30_000,
    queryFn: ({ signal }) => result<Candidate[]>(db!.rpc("report_duplicate_candidates", { p_id: report.id }).abortSignal(signal)),
  });
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
        <details className="duplicate-comparison"><summary>Compare reports<ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="duplicate-comparison-grid">
            {[{ ...report, heading: "Report being reviewed", area: "" }, { ...candidate, heading: "Possible main report", area: candidate.barangay_name }].map(item => <div key={item.id}>
              <strong className="duplicate-comparison-label">{item.heading}</strong><h5>{item.title}</h5>
              <p className="duplicate-comparison-meta">{label(item.status)} · {date(item.created_at)}</p>
              {item.area && <p className="duplicate-comparison-meta">{item.area}</p>}
              <div className="duplicate-comparison-description" role="region" aria-label={`${item.heading} description`} tabIndex={0}>{item.description}</div>
              <p className="duplicate-comparison-meta"><strong>Landmark:</strong> {item.landmark?.trim() || "Not provided"}</p>
              <p className="duplicate-comparison-id">{item.id}</p>
            </div>)}
          </div>
          {candidate.problem_label && <p className="duplicate-comparison-note">Suggested report’s problem: {candidate.problem_label}</p>}
          {candidate.status === "resolved" && <p className="duplicate-comparison-note">This report was resolved. Check whether the new report describes a fresh incident before linking it.</p>}
          {canChoose ? <div className="duplicate-choice"><p>Choose a main report only if both describe the same incident. Add a reason and save to confirm the link.</p><button type="button" aria-pressed={selectedId === candidate.id} className={selectedId === candidate.id ? "secondary" : ""} onClick={() => onChoose(candidate)}><Check size={16} aria-hidden="true" />{selectedId === candidate.id ? "Main report selected" : "Choose as main report"}</button></div>
            : <p className="duplicate-comparison-note">No duplicate action is available for your permissions and this report’s current status. You can still compare the details.</p>}
        </details>
      </article>)}</div>}
  </section>;
}
