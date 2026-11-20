"use client";

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FilePlus2, MapPin, UserRound } from "lucide-react";
import { createReportSchema, emailInputError, mobileInputError, normalizePhilippineMobile, personNameInputError } from "@community/shared";
import { db, result } from "../lib/client";
import { Dialog } from "./dialog";
import { WalkInLocationMap, type WalkInPin } from "./walk-in-location-map";
import type { References } from "./workspace";

type Field = "reporter_name" | "reporter_email" | "reporter_phone" | "category_id" | "problem_type" | "problem_other" | "title" | "description" | "purok" | "zone" | "landmark" | "latitude";

export function WalkInReport({ refs, barangayId, onClose, onCreated }: {
  refs: References;
  barangayId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const barangayName = refs.barangays.find((item) => item.id === barangayId)?.name || "your barangay";
  const [categoryId, setCategoryId] = useState("");
  const category = refs.categories.find((item) => item.id === categoryId);
  const problemTypes = category?.problem_types || [];
  const [problemType, setProblemType] = useState("");
  const [pin, setPin] = useState<WalkInPin>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const initialProblemType = problemTypes[0]?.code || "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const reporterName = String(form.get("reporter_name") || "").trim();
    const reporterEmail = String(form.get("reporter_email") || "").trim();
    const reporterPhone = String(form.get("reporter_phone") || "").trim();
    const report = createReportSchema(refs.categories).safeParse({
      category_id: categoryId,
      barangay_id: barangayId,
      title: String(form.get("title") || ""),
      description: String(form.get("description") || ""),
      latitude: pin?.latitude ?? null,
      longitude: pin?.longitude ?? null,
      landmark: String(form.get("landmark") || ""),
      purok: String(form.get("purok") || ""),
      zone: String(form.get("zone") || ""),
      location_source: pin ? "pin" : null,
      problem_type: problemType || initialProblemType,
      problem_other: String(form.get("problem_other") || ""),
    });
    const nextErrors: Partial<Record<Field, string>> = {};
    const reporterNameError = personNameInputError(reporterName, true, 100);
    if (reporterNameError) nextErrors.reporter_name = reporterNameError;
    if (reporterEmail && emailInputError(reporterEmail)) nextErrors.reporter_email = emailInputError(reporterEmail);
    if (reporterPhone && mobileInputError(reporterPhone)) nextErrors.reporter_phone = mobileInputError(reporterPhone);
    if (!report.success) {
      for (const issue of report.error.issues) {
        const field = issue.path[0] as Field;
        if (!nextErrors[field]) nextErrors[field] = issue.message;
      }
    }
    setFieldErrors(nextErrors);
    setError("");
    const firstInvalid = Object.keys(nextErrors)[0] as Field | undefined;
    if (firstInvalid) {
      document.getElementById(`walk-in-${firstInvalid}`)?.focus();
      if (firstInvalid === "latitude") document.getElementById("walk-in-location")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!report.success) return;

    setBusy(true);
    try {
      const id = crypto.randomUUID();
      await result<string>(db!.rpc("submit_walk_in_report_with_contacts", {
        p_id: id,
        p_category: report.data.category_id,
        p_barangay: barangayId,
        p_reporter_name: reporterName,
        p_reporter_email: reporterEmail.toLowerCase() || null,
        p_reporter_phone: normalizePhilippineMobile(reporterPhone) || null,
        p_title: report.data.title,
        p_description: report.data.description,
        p_latitude: report.data.latitude,
        p_longitude: report.data.longitude,
        p_landmark: report.data.landmark,
        p_problem_type: report.data.problem_type,
        p_problem_other: report.data.problem_other,
        p_purok: report.data.purok,
        p_zone: report.data.zone,
      }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["reports"] }),
        qc.invalidateQueries({ queryKey: ["report-queue-counts"] }),
        qc.invalidateQueries({ queryKey: ["report-residents"] }),
      ]);
      onCreated(id);
    } catch (cause) {
      setError((cause as Error).message || "The walk-in report could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function setFieldError(field: Field) {
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }
  function validateOptionalContact(field: "reporter_email" | "reporter_phone", value: string) {
    const message = !value.trim() ? "" : field === "reporter_email" ? emailInputError(value) : mobileInputError(value);
    setFieldErrors((current) => ({ ...current, [field]: message || undefined }));
  }
  const fieldHint = (field: Field, hint?: string, hintId?: string) => fieldErrors[field]
    ? <small className="walk-in-field-error" id={`walk-in-${field}-error`}>{fieldErrors[field]}</small>
    : hint ? <small className="walk-in-field-hint" id={hintId}>{hint}</small> : null;

  return <Dialog title="Record walk-in report" description={`${barangayName} · Record a concern raised in person`} icon={<FilePlus2 size={22} />} close={() => { if (!busy) onClose(); }} className="walk-in-report-dialog">
    <form className="walk-in-report-form" onSubmit={submit} noValidate>
      <div className="walk-in-report-content">
      <div className="walk-in-report-intro"><span className="walk-in-intro-icon"><UserRound size={18} aria-hidden="true" /></span><p><strong>For a resident visiting the barangay office</strong><span>No resident account or photo is needed to record it. Staff can add evidence later from the report workspace.</span></p></div>

      <section className="walk-in-report-section" aria-labelledby="walk-in-reporter-heading">
        <div className="walk-in-section-heading"><span>1</span><div><h3 id="walk-in-reporter-heading">Reporter</h3><p>Record who brought the concern to the office.</p></div></div>
        <div className="walk-in-field-grid walk-in-reporter-grid">
          <label className="walk-in-field"><span>Reporter’s full name <b aria-hidden="true">*</b></span><input id="walk-in-reporter_name" name="reporter_name" autoComplete="name" maxLength={100} required aria-invalid={!!fieldErrors.reporter_name} aria-describedby={fieldErrors.reporter_name ? "walk-in-reporter_name-error" : "walk-in-reporter-hint"} onChange={() => setFieldError("reporter_name")} />{fieldHint("reporter_name", "This is recorded for staff follow-up; it does not create an account.", "walk-in-reporter-hint")}</label>
          <label className="walk-in-field"><span>Email address <small>Optional</small></span><input id="walk-in-reporter_email" name="reporter_email" type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="name@example.com" aria-invalid={!!fieldErrors.reporter_email} aria-describedby={fieldErrors.reporter_email ? "walk-in-reporter_email-error" : "walk-in-email-hint"} onBlur={(event) => validateOptionalContact("reporter_email", event.currentTarget.value)} onChange={() => setFieldError("reporter_email")} />{fieldHint("reporter_email", "If provided, this address receives email updates when the report changes.", "walk-in-email-hint")}</label>
          <label className="walk-in-field"><span>Phone number <small>Optional</small></span><input id="walk-in-reporter_phone" name="reporter_phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder="0917 123 4567" aria-invalid={!!fieldErrors.reporter_phone} aria-describedby={fieldErrors.reporter_phone ? "walk-in-reporter_phone-error" : "walk-in-phone-hint"} onBlur={(event) => validateOptionalContact("reporter_phone", event.currentTarget.value)} onChange={() => setFieldError("reporter_phone")} />{fieldHint("reporter_phone", "For staff follow-up only; no automatic SMS is sent.", "walk-in-phone-hint")}</label>
        </div>
      </section>

      <section className="walk-in-report-section" aria-labelledby="walk-in-details-heading">
        <div className="walk-in-section-heading"><span>2</span><div><h3 id="walk-in-details-heading">Report details</h3><p>Describe the issue clearly so it can be assessed and routed correctly.</p></div></div>
        <div className="walk-in-field-grid">
          <label className="walk-in-field"><span>Report category <b aria-hidden="true">*</b></span><select id="walk-in-category_id" value={categoryId} required aria-invalid={!!fieldErrors.category_id} onChange={(event) => { setCategoryId(event.target.value); setProblemType(""); setFieldError("category_id"); setFieldError("problem_type"); }}><option value="">Choose a category</option>{refs.categories.filter((item) => item.problem_types?.length).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{fieldHint("category_id")}</label>
          <label className="walk-in-field"><span>Specific issue <b aria-hidden="true">*</b></span><select id="walk-in-problem_type" value={problemType || initialProblemType} required disabled={!category} aria-invalid={!!fieldErrors.problem_type} onChange={(event) => { setProblemType(event.target.value); setFieldError("problem_type"); }}><option value="">Choose a specific issue</option>{problemTypes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>{fieldHint("problem_type")}</label>
          {problemType === "other" && <label className="walk-in-field walk-in-field-wide"><span>Describe the other issue <b aria-hidden="true">*</b></span><input id="walk-in-problem_other" name="problem_other" maxLength={240} required aria-invalid={!!fieldErrors.problem_other} onChange={() => setFieldError("problem_other")} />{fieldHint("problem_other", "Up to 240 characters.")}</label>}
          <label className="walk-in-field walk-in-field-wide"><span>Report title <b aria-hidden="true">*</b></span><input id="walk-in-title" name="title" required minLength={8} maxLength={160} placeholder="Example: Damaged drainage cover near the market" aria-invalid={!!fieldErrors.title} onChange={() => setFieldError("title")} />{fieldHint("title", "8–160 characters. Use a short, specific description.")}</label>
          <label className="walk-in-field walk-in-field-wide"><span>What happened? <b aria-hidden="true">*</b></span><textarea id="walk-in-description" name="description" required minLength={20} maxLength={4000} rows={4} placeholder="Describe the concern, when it was noticed, and who or what may be affected." aria-invalid={!!fieldErrors.description} onChange={() => setFieldError("description")} />{fieldHint("description", "20–4,000 characters. Avoid including sensitive personal details.")}</label>
        </div>
      </section>

      <section className="walk-in-report-section" aria-labelledby="walk-in-location-heading">
        <div className="walk-in-section-heading"><span>3</span><div><h3 id="walk-in-location-heading">Location</h3><p>The report pin must be inside your assigned barangay.</p></div></div>
        <div className="walk-in-field-grid walk-in-address-grid">
          <label className="walk-in-field"><span>Purok <small>Optional</small></span><input id="walk-in-purok" name="purok" maxLength={80} placeholder="Purok number or name" />{fieldHint("purok", "Up to 80 characters.")}</label>
          <label className="walk-in-field"><span>Zone <small>Optional</small></span><input id="walk-in-zone" name="zone" maxLength={80} placeholder="Zone number or name" />{fieldHint("zone", "Up to 80 characters.")}</label>
          <label className="walk-in-field walk-in-field-wide"><span>Street, landmark, or directions <small>Optional</small></span><input id="walk-in-landmark" name="landmark" maxLength={240} placeholder="Near a recognizable place or access point" />{fieldHint("landmark", "Up to 240 characters.")}</label>
        </div>
        <div id="walk-in-location"><WalkInLocationMap barangayId={barangayId} barangays={refs.barangays} value={pin} onChange={(next) => { setPin(next); setFieldError("latitude"); }} /></div>
        {fieldErrors.latitude && <p className="walk-in-field-error" id="walk-in-latitude-error" role="alert">{fieldErrors.latitude}</p>}
      </section>

      <div className="walk-in-report-note"><MapPin size={17} aria-hidden="true" /><p>After saving, this report enters the barangay’s <strong>Needs review</strong> queue. Staff can assess severity and urgency, route it to an eligible office, and attach photos from the report workspace.</p></div>
      {error && <p className="walk-in-submit-error" role="alert">{error}</p>}
      </div>
      <footer className="walk-in-report-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy}><FilePlus2 size={16} aria-hidden="true" />{busy ? "Saving report…" : "Save and review report"}</button></footer>
    </form>
  </Dialog>;
}
