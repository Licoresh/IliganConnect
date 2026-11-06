"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ClipboardCheck, RefreshCw, Save } from "lucide-react";
import { SEVERITY_OPTIONS, URGENCY_OPTIONS, reportAssessmentSchema, type Status } from "@community/shared";
import { db, result } from "../lib/client";

type Errors = Partial<Record<"severity" | "urgency" | "note", string>>;
type Assessment = { id: string; severity: number; urgency: number; note: string; created_at: string };
const editableStatuses: Status[] = ["under_review", "verified", "assigned", "in_progress"];
const rating = (options: typeof SEVERITY_OPTIONS | typeof URGENCY_OPTIONS, value: number | null | undefined) => {
  const option = options.find((item) => item.value === value);
  return option ? `${option.value}/5 · ${option.label}` : "Not assessed";
};

export function AssessmentFields({ idPrefix, severity, urgency, errors = {}, disabled = false }: {
  idPrefix: string; severity?: number | null; urgency?: number | null; errors?: Errors; disabled?: boolean;
}) {
  const [selectedSeverity, setSeverity] = useState(severity == null ? "" : String(severity));
  const [selectedUrgency, setUrgency] = useState(urgency == null ? "" : String(urgency));
  return <fieldset className="assessment-fields" disabled={disabled}>
    <legend>Staff assessment</legend>
    <p className="assessment-fields-intro">Severity describes the impact. Urgency describes how soon staff attention is needed.</p>
    <div className="assessment-rating-grid">
      {([
        ["severity", "Severity · impact", SEVERITY_OPTIONS, selectedSeverity, setSeverity],
        ["urgency", "Urgency · time sensitivity", URGENCY_OPTIONS, selectedUrgency, setUrgency],
      ] as const).map(([name, title, options, value, setValue]) => {
        const id = `${idPrefix}-${name}`;
        return <div key={name} className="assessment-rating-field">
          <label htmlFor={id}>{title} <span aria-hidden="true">*</span></label>
          <select id={id} name={name} value={value} required aria-invalid={!!errors[name] || undefined}
            aria-describedby={`${id}-hint${errors[name] ? ` ${id}-error` : ""}`} onChange={(event) => setValue(event.target.value)}>
            <option value="">Choose {name}</option>
            {options.map((option) => <option key={option.value} value={option.value}>{option.value} · {option.label}</option>)}
          </select>
          <small id={`${id}-hint`}>{options.find((option) => String(option.value) === value)?.description || `Choose an assessed ${name} from 1 to 5.`}</small>
          {errors[name] && <p id={`${id}-error`} className="field-validation-message" role="alert">{errors[name]}</p>}
        </div>;
      })}
    </div>
    <p className="assessment-fields-footnote">Ratings guide human review. They do not promise a response or repair deadline.</p>
  </fieldset>;
}

export function ReportAssessment({ reportId, canReview }: { reportId: string; canReview: boolean }) {
  const qc = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const saveLock = useRef(false);
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({}), [message, setMessage] = useState(""), [saved, setSaved] = useState(false);
  const q = useQuery({
    queryKey: ["report-assessment", reportId], staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const [current, history] = await Promise.all([
        result<{ severity: number | null; urgency: number | null; status: Status }>(
          db!.from("reports").select("severity,urgency,status").eq("id", reportId).abortSignal(signal).single()),
        result<Assessment[]>(db!.from("report_assessments").select("id,severity,urgency,note,created_at")
          .eq("report_id", reportId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10).abortSignal(signal)),
      ]);
      return { current, history };
    },
  });
  const canAssess = canReview && !!q.data && editableStatuses.includes(q.data.current.status);
  return <section className="report-workspace-section report-document-section report-assessment" aria-labelledby={`assessment-title-${reportId}`}>
    <div className="report-workspace-section-heading"><ClipboardCheck size={22} aria-hidden="true" /><div><h3 id={`assessment-title-${reportId}`}>Severity and urgency</h3><p>Official staff ratings based on the report and available evidence.</p></div></div>
    {q.isPending ? <p className="report-workspace-muted" role="status">Loading staff assessment…</p> : q.error ?
      <div role="alert" className="assessment-load-error"><p>Staff assessments could not be loaded.</p><button type="button" className="secondary" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw size={16} aria-hidden="true" />Retry assessment</button></div>
      : q.data && <>
        <dl className="assessment-current"><div><dt>Severity · impact</dt><dd>{rating(SEVERITY_OPTIONS, q.data.current.severity)}</dd></div><div><dt>Urgency · time sensitivity</dt><dd>{rating(URGENCY_OPTIONS, q.data.current.urgency)}</dd></div></dl>
        {!editing && canAssess && <button type="button" className="secondary" onClick={() => { setEditing(true); setMessage(""); setErrors({}); setSaved(false); }}>{q.data.current.urgency == null ? "Record staff assessment" : "Reassess report"}</button>}
        {!canAssess && <p className="report-form-hint">{q.data.current.status === "submitted" ? "Start the report review to record an assessment." : ["rejected", "duplicate", "resolved"].includes(q.data.current.status) ? "This report’s assessment is kept for reference. Reopen the case, or open its main report, when further review is needed." : "Assessment changes require review permission for this report."}</p>}
        {editing && canAssess && <form ref={formRef} className="report-assessment-form" onSubmit={async (event) => {
          event.preventDefault();
          if (saveLock.current) return;
          const form = new FormData(event.currentTarget);
          const parsed = reportAssessmentSchema.safeParse({ severity: Number(form.get("severity")), urgency: Number(form.get("urgency")), note: String(form.get("note") || "") });
          if (!parsed.success) {
            const nextErrors: Errors = {};
            for (const issue of parsed.error.issues) { const name = issue.path[0] as keyof Errors; if (!nextErrors[name]) nextErrors[name] = issue.message; }
            setErrors(nextErrors);
            (formRef.current?.elements.namedItem(String(parsed.error.issues[0]?.path[0])) as HTMLElement | null)?.focus();
            return;
          }
          saveLock.current = true;
          setBusy(true); setMessage(""); setErrors({}); setSaved(false);
          try {
            await result(db!.rpc("record_report_assessment", { p_id: reportId, p_severity: parsed.data.severity, p_urgency: parsed.data.urgency, p_note: parsed.data.note }));
            await qc.invalidateQueries();
            setEditing(false); setSaved(true); setMessage("Staff assessment recorded.");
          } catch (cause) { setMessage((cause as Error).message || "Assessment could not be saved. Your inputs are retained."); }
          finally { saveLock.current = false; setBusy(false); }
        }}>
          <AssessmentFields idPrefix={`reassess-${reportId}`} severity={q.data.current.severity} urgency={q.data.current.urgency} errors={errors} disabled={busy} />
          <label htmlFor={`assessment-note-${reportId}`}>Assessment rationale <span aria-hidden="true">*</span></label>
          <textarea id={`assessment-note-${reportId}`} name="note" required minLength={5} maxLength={4000} disabled={busy} aria-invalid={!!errors.note || undefined}
            aria-describedby={`assessment-note-hint-${reportId}${errors.note ? ` assessment-note-error-${reportId}` : ""}`} placeholder="Explain the observed impact, time sensitivity and supporting evidence." />
          <small id={`assessment-note-hint-${reportId}`}>5–4,000 characters. Visible only to authorized staff.</small>
          {errors.note && <p id={`assessment-note-error-${reportId}`} className="field-validation-message" role="alert">{errors.note}</p>}
          <div className="assessment-form-actions"><button type="submit" disabled={busy}><Save size={17} aria-hidden="true" />{busy ? "Saving assessment…" : "Save assessment"}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(false); setMessage(""); setErrors({}); }}>Cancel</button></div>
        </form>}
        {q.data.history.length ? <details className="assessment-history"><summary>Assessment history{q.data.history.length === 10 ? " · latest 10" : ` · ${q.data.history.length}`}<ChevronDown size={16} aria-hidden="true" /></summary><ol>{q.data.history.map((item) => <li key={item.id}>
          <div className="assessment-history-heading"><strong>Severity {rating(SEVERITY_OPTIONS, item.severity)} · Urgency {rating(URGENCY_OPTIONS, item.urgency)}</strong><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}</time></div>
          <p>{item.note}</p>
        </li>)}</ol></details> : <p className="report-workspace-muted">No structured staff assessments have been recorded. Existing severity values are retained; urgency remains unassessed until recorded.</p>}
      </>}
    {message && <p className={saved ? "success" : "field-validation-message"} role={saved ? "status" : "alert"}>{message}</p>}
  </section>;
}
