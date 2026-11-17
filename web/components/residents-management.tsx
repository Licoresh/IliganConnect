"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mobileInputError, normalizePhilippineMobile, residentNamePartsError, residentAgeError, type Lookup } from "@community/shared";
import { CalendarDays, Mail, Smartphone, UserRound } from "lucide-react";
import { db, result } from "../lib/client";
import { useDebouncedValue } from "../lib/use-debounced-value";
import { Dialog } from "./dialog";

type Resident = {
  id: string; display_name: string; first_name: string | null; middle_name: string | null; last_name: string | null; age: number | null; barangay_id: string | null; email: string | null;
  phone: string | null; account_status: string; notifications_enabled: boolean;
  created_at: string; last_sign_in_at: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export function ResidentsManagement({ barangays, active }: { barangays: Lookup[]; active: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState(""), [barangay, setBarangay] = useState("");
  const [status, setStatus] = useState(""), [sort, setSort] = useState("name"), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Resident | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [phoneError, setPhoneError] = useState(""), [phoneTouched, setPhoneTouched] = useState(false);
  const term = useDebouncedValue(search.trim());
  const q = useQuery({
    queryKey: ["admin-residents", term, barangay, status, sort, page], enabled: active,
    queryFn: ({ signal }) => result<{ items: Resident[]; total: number }>(db!.rpc("admin_residents", {
      p_search: term, p_barangay: barangay || null, p_status: status || null, p_sort: sort, p_offset: page * 25,
    }).abortSignal(signal)),
  });
  return <section className="resident-management">
    <header className="organization-section-heading"><div><h2>Residents Management</h2><p>Find resident profiles and manage account access. Changes are recorded in the audit trail.</p></div></header>
    <div className="resident-filters">
      <label>Search residents<input type="search" value={search} maxLength={160} placeholder="Name, email, or mobile" onChange={e => { setSearch(e.target.value); setPage(0); }} /></label>
      <label>Registered barangay<select value={barangay} onChange={e => { setBarangay(e.target.value); setPage(0); }}><option value="">All barangays</option>{barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>Account status<select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option>{["active", "pending", "disabled"].map(s => <option key={s} value={s}>{s}</option>)}</select></label>
      <label>Sort by<select value={sort} onChange={e => { setSort(e.target.value); setPage(0); }}><option value="name">Name</option><option value="newest">Newest registrations</option><option value="oldest">Oldest registrations</option></select></label>
    </div>
    {message && <p className="success" role="status">{message}</p>}
    {q.isPending ? <p role="status">Loading residents…</p> : q.error ? <div role="alert"><p className="error">Residents could not be loaded. {q.error.message}</p><button className="secondary" onClick={() => void q.refetch()}>Retry</button></div> :
      q.data?.items.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Name</th><th scope="col">Age</th><th scope="col">Contact</th><th scope="col">Registered barangay</th><th scope="col">Status</th><th scope="col">Profile</th></tr></thead><tbody>{q.data.items.map(r => <tr key={r.id}>
        <th scope="row">{r.display_name}</th><td data-label="Age">{r.age ?? "Not recorded"}</td><td data-label="Contact">{r.email || "Email unavailable"}{r.phone && <small className="record-meta">{r.phone}</small>}</td>
        <td data-label="Registered barangay">{barangays.find(b => b.id === r.barangay_id)?.name || "Not registered"}</td><td data-label="Account status">{r.account_status}</td>
        <td><button className="secondary" onClick={() => { setSelected(r); setError(""); setPhoneError(""); setPhoneTouched(false); }}>Manage<span className="sr-only"> {r.display_name}</span></button></td>
      </tr>)}</tbody></table></div> : <p className="empty">No residents match these filters.</p>}
    <div className="pagination"><span>{q.data ? q.data.total + " residents · " : ""}Page {page + 1}</span><button className="secondary" disabled={!page || q.isFetching} onClick={() => setPage(page - 1)}>Previous</button><button className="secondary" disabled={q.isFetching || !q.data || (page + 1) * 25 >= q.data.total} onClick={() => setPage(page + 1)}>Next</button></div>
    {selected && <Dialog className="resident-edit-dialog" title="Manage resident" description="Update resident information and account access." icon={<UserRound size={23} />} close={() => { if (!busy) setSelected(null); }}>
      <form key={selected.id} className="resident-edit-form" onSubmit={async e => {
        e.preventDefault(); if (busy) return;
        const f = new FormData(e.currentTarget);
        const phoneInput = String(f.get("phone") ?? "").trim();
        const phone = normalizePhilippineMobile(phoneInput);
        const firstName = String(f.get("first_name") ?? "").trim();
        const middleName = String(f.get("middle_name") ?? "").trim();
        const lastName = String(f.get("last_name") ?? "").trim();
        const ageInput = String(f.get("age") ?? "").trim();
        if (phone === null) {
          setPhoneTouched(true); setPhoneError(mobileInputError(phoneInput));
          document.getElementById("resident-edit-phone")?.focus();
          return;
        }
        const nameProblem = firstName || middleName || lastName ? residentNamePartsError(firstName, middleName, lastName) : "";
        if (nameProblem) {
          setError(nameProblem);
          document.getElementById("resident-edit-first-name")?.focus();
          return;
        }
        const ageProblem = ageInput ? residentAgeError(ageInput) : "";
        if (ageProblem) {
          setError(ageProblem);
          document.getElementById("resident-edit-age")?.focus();
          return;
        }
        setBusy(true); setError("");
        try {
          await result(db!.rpc("admin_update_resident", {
            p_user: selected.id, p_first_name: firstName || null, p_middle_name: middleName || null,
            p_last_name: lastName || null, p_age: ageInput ? Number(ageInput) : null,
            p_barangay: f.get("barangay"), p_phone: phone || null,
            p_status: f.get("status"), p_notifications: f.get("notifications") === "on", p_reason: String(f.get("reason")).trim(),
          }));
          await qc.invalidateQueries();
          setMessage("Resident profile and account access updated."); setSelected(null);
        } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
      }}>
        <div className="resident-edit-meta" aria-label="Resident account information">
          <div className="resident-edit-meta-item"><Mail size={19} aria-hidden="true" /><div><span>Email address</span><strong>{selected.email || "Email unavailable"}</strong></div></div>
          <div className="resident-edit-meta-item"><CalendarDays size={19} aria-hidden="true" /><div><span>Account activity</span><strong>Registered {formatDate(selected.created_at)} <i aria-hidden="true">·</i> Last sign-in {formatDate(selected.last_sign_in_at)}</strong></div></div>
        </div>
        <fieldset className="resident-edit-fields" disabled={busy}>
          <p className="resident-edit-name-hint">Current name: <strong>{selected.display_name}</strong>. Leave all three fields blank to keep it, or enter both first and last name to update it.</p>
          <label>First name<input id="resident-edit-first-name" name="first_name" autoComplete="given-name" maxLength={60} defaultValue={selected.first_name || ""} /></label>
          <label>Middle name (optional)<input name="middle_name" autoComplete="additional-name" maxLength={60} defaultValue={selected.middle_name || ""} /></label>
          <label>Last name<input name="last_name" autoComplete="family-name" maxLength={60} defaultValue={selected.last_name || ""} /></label>
          <label>Age (optional for existing accounts)<input id="resident-edit-age" name="age" type="text" inputMode="numeric" maxLength={3} defaultValue={selected.age == null ? "" : String(selected.age)} /><small>Whole number from 1 to 120.</small></label>
          <label>Mobile number
            <span className="resident-edit-phone-wrap"><Smartphone size={17} aria-hidden="true" /><input id="resident-edit-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} defaultValue={selected.phone || ""} aria-invalid={!!phoneError} aria-describedby={phoneError ? "resident-edit-phone-hint resident-edit-phone-error" : "resident-edit-phone-hint"} onBlur={e => { setPhoneTouched(true); setPhoneError(mobileInputError(e.currentTarget.value)); }} onChange={e => { if (phoneTouched) setPhoneError(mobileInputError(e.currentTarget.value)); }} /></span>
            <small id="resident-edit-phone-hint">Optional · saved as the resident’s contact number. Use a Philippine mobile number.</small>
            {phoneError && <small id="resident-edit-phone-error" className="error" role="alert">{phoneError}</small>}
          </label>
          <label>Registered barangay<select name="barangay" required defaultValue={selected.barangay_id || ""}><option value="">Choose barangay</option>{barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label>Account status<select name="status" defaultValue={selected.account_status}><option value="active">Active</option><option value="pending">Pending approval</option><option value="disabled">Deactivated</option></select></label>
          <label className="resident-edit-notifications"><input type="checkbox" name="notifications" defaultChecked={selected.notifications_enabled} /><span><strong>In-app notifications enabled</strong><small>Allow this account to receive resident updates in the app.</small></span></label>
          <label className="resident-edit-reason">Reason for change<textarea name="reason" required minLength={5} maxLength={500} placeholder="Explain this profile or access change." /><small>5–500 characters. Recorded in the administrator audit trail.</small></label>
          <p className="report-form-hint">Deactivated residents lose protected access. Their report and meeting records are retained.</p>
          {error && <p className="error resident-edit-error" role="alert">{error}</p>}
        </fieldset>
        <div className="resident-edit-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setSelected(null)}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save resident changes"}</button></div>
      </form>
    </Dialog>}
  </section>;
}
