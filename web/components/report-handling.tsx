"use client";
import { useQuery } from "@tanstack/react-query";
import { type Lookup, type Report } from "@community/shared";
import { db, result } from "../lib/client";

export type Reporter = {
  report_id: string; resident_name: string | null; registered_barangay_id: string | null;
  submission_barangay_id: string | null; assigned_to_name: string | null; email: string | null;
  reporter_contact?: string | null; submission_source?: "resident" | "walk_in"; created_by_name?: string | null;
};
export function useReportResidents(ids: string[], contact = false) {
  return useQuery({
    queryKey: ["report-residents", ids, contact], enabled: ids.length > 0, staleTime: 30_000,
    queryFn: ({ signal }) => result<Reporter[]>(db!.rpc("report_residents", { p_ids: ids, p_contact: contact }).abortSignal(signal)),
  });
}
export function ReportHandling({ report, barangays }: { report: Report; barangays: Lookup[] }) {
  const reporter = useReportResidents([report.id], true);
  const person = reporter.data?.[0];
  const area = (id: string | null | undefined) => barangays.find(b => b.id === id)?.name || "Not recorded";
  return <section className="report-workspace-section report-document-section report-handling">
    <h3>{report.submission_source === "walk_in" ? "Walk-in reporter" : "Reporting resident"}</h3>
    {reporter.isPending ? <p role="status">Loading reporter information…</p> : reporter.error ? <div role="alert"><p>Reporter information could not be loaded.</p><button className="secondary" onClick={() => void reporter.refetch()}>Retry reporter details</button></div> : person ? <dl className="assessment-current">
      <div><dt>{report.submission_source === "walk_in" ? "Reported by" : "Submitted by"}</dt><dd>{person.resident_name || "Name not recorded"}</dd>
        {person.reporter_contact && <a href={person.reporter_contact.includes("@") ? `mailto:${person.reporter_contact}` : `tel:${person.reporter_contact}`}>{person.reporter_contact}</a>}
        {!person.reporter_contact && person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
        {report.submission_source === "walk_in" && <small>Recorded by {person.created_by_name || "barangay staff"}</small>}
      </div>
      {report.submission_source === "walk_in"
        ? <div><dt>Intake barangay</dt><dd>{area(report.barangay_id)}</dd><small>No resident account is linked to this report.</small></div>
        : <div><dt>Resident’s registered barangay</dt><dd>{area(person.registered_barangay_id)}</dd><small>At submission: {person.submission_barangay_id ? area(person.submission_barangay_id) : "Not captured for this older report"}</small></div>}
    </dl> : <p>Reporter information is unavailable for this report.</p>}
    <h3>Handling responsibility</h3>
    <p>{report.organization_id ? "Forwarded to an office. Its name and referral reason are shown in the report details and history." : area(report.barangay_id) + " barangay handles the report."}</p>
    {person?.assigned_to_name && <p>Barangay personnel responsible: <strong>{person.assigned_to_name}</strong></p>}
  </section>;
}
