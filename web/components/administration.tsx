"use client";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db, result } from "../lib/client";
import { label, Lookup, Profile } from "@community/shared";
import type { References } from "./workspace";
import { AccessAdministration } from "./access-administration";
import { roleNames } from "../lib/access";
import { ReportCategoryLabel, reportCategoryPresentation } from "./report-category";
import { Building2, ChevronDown, GitBranch, History, Info, Layers3, MailPlus, PencilLine, Plus, Settings2, ShieldCheck, Trash2, UsersRound } from "lucide-react";
type Rule = {
  id: string;
  category_id: string;
  barangay_id: string | null;
  organization_id: string;
  notes: string;
};
type AuditEntry = {
  id: number;
  actor_id: string | null;
  actor: { display_name: string | null } | null;
  entity: string;
  action: string;
  record_id: string | null;
  created_at: string;
  old_value: unknown;
  new_value: unknown;
};
export function Administration({
  refs,
  profile,
}: {
  refs: References;
  profile: Profile;
}) {
  const [message, setMessage] = useState(""),
    [messageKind, setMessageKind] = useState<"success" | "error">("success"),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [user, setUser] = useState(""),
    [inviteRole, setInviteRole] = useState<"barangay" | "office">("barangay"),
    [page, setPage] = useState(0),
    [auditFilter, setAuditFilter] = useState(""),
    [auditPage, setAuditPage] = useState(0),
    [includeInactiveOrganizations, setIncludeInactiveOrganizations] = useState(false),
    [organizationSection, setOrganizationSection] = useState("accounts");
  const qc = useQueryClient();
  const admin = profile.role === "admin";
  const q = useQuery({
    queryKey: ["administration", page],
    enabled: admin && organizationSection === "accounts",
    queryFn: async () => {
      const [people, memberships] = await Promise.all([result<(Profile & { account_status: string })[]>(
        db!
          .from("profiles")
          .select(
            "id,display_name,role,barangay_id,notifications_enabled,account_status",
          )
          .order("display_name")
          .range(page * 50, page * 50 + 49),
      ), result<{ user_id: string; organization_id: string }[]>(
        db!.from("organization_memberships").select("*"),
      )]);
      return { people, memberships };
    },
  });
  const settings = useQuery({
    queryKey: ["administration-settings"],
    enabled: admin && organizationSection === "configuration",
    queryFn: () => result<Record<string, number> & { include_samples: boolean }>(
        db!.from("analytics_settings").select("*").single(),
      ),
  });
  const audit = useQuery({
    queryKey: ["administration-audit"],
    enabled: admin && organizationSection === "audit",
    queryFn: () => result<AuditEntry[]>(
        db!
          .from("audit_logs")
          .select("id,actor_id,entity,action,record_id,created_at,old_value,new_value,actor:profiles!audit_logs_actor_id_fkey(display_name)")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(50)
          .overrideTypes<AuditEntry[], { merge: false }>(),
      ),
  });
  const rules = useQuery({
    queryKey: ["routing-rules"],
    enabled: admin && organizationSection === "routing",
    queryFn: () => result<Rule[]>(db!.from("routing_rules").select("*")),
  });
  async function run(
    p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ) {
    setBusy(true);
    setMessage("");
    try {
      await result(p);
      setMessageKind("success");
      setMessage("Saved.");
      await qc.invalidateQueries();
    } catch (e) {
      setMessageKind("error");
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function inviteStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await db!.functions.invoke("create-staff-account", {
        body: {
          display_name: String(form.get("invite_name") || "").trim(),
          email: String(form.get("invite_email") || "").trim(),
          role: inviteRole,
          barangay_id: inviteRole === "barangay" ? form.get("invite_barangay") : null,
          organization_id: inviteRole === "office" ? form.get("invite_organization") : null,
        },
      });
      if (error) {
        const response = (error as Error & { context?: Response }).context;
        const payload = response instanceof Response ? await response.clone().json().catch(() => null) : null;
        throw new Error(payload?.error || error.message);
      }
      if (data?.error) throw new Error(data.error);
      setMessageKind("success");
      setMessage(data?.message || "Invitation sent. The account is pending approval.");
      formElement.reset();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["administration"] }),
        qc.invalidateQueries({ queryKey: ["administration-audit"] }),
      ]);
    } catch (e) {
      setMessageKind("error");
      setMessage((e as Error).message || "The invitation could not be sent.");
    } finally {
      setBusy(false);
    }
  }
  const person = q.data?.people.find((p) => p.id === user);
  const activeOrganizations = refs.organizations.filter(o => (o as Lookup & { active?: boolean }).active !== false);
  const inactiveOrganizationCount = refs.organizations.length - activeOrganizations.length;
  const directoryOrganizations = includeInactiveOrganizations ? refs.organizations : activeOrganizations;
  const auditRows = (audit.data || []).filter((entry) => !auditFilter || entry.entity === auditFilter);
  const visibleAuditPage = Math.min(auditPage, Math.max(0, Math.ceil(auditRows.length / 15) - 1));
  const organizationSections = [
    { id: "accounts", title: "Stakeholder accounts", shortTitle: "Accounts", Icon: UsersRound },
    { id: "organizations", title: "Organizations", shortTitle: "Organizations", Icon: Building2 },
    { id: "routing", title: "Department routing", shortTitle: "Routing", Icon: GitBranch },
    { id: "permissions", title: "Office permissions", shortTitle: "Permissions", Icon: ShieldCheck },
    { id: "configuration", title: "Configuration", shortTitle: "Configuration", Icon: Settings2 },
    { id: "audit", title: "Audit trail", shortTitle: "Audit trail", Icon: History },
  ];
  return (
    <>
      <p
        role={messageKind === "error" ? "alert" : "status"}
        className={messageKind}
        hidden={!message}
      >
        {message}
      </p>
      {(organizationSection === "accounts" ? q.error : organizationSection === "configuration" ? settings.error : organizationSection === "audit" ? audit.error : null) && (
        <p className="error" role="alert">
          {(organizationSection === "accounts" ? q.error : organizationSection === "configuration" ? settings.error : audit.error)?.message}
        </p>
      )}
      <div className="organization-navigation administration-navigation" role="tablist" aria-label="Administration settings" onKeyDown={(event) => {
        const current = organizationSections.findIndex((item) => item.id === organizationSection);
        const next = event.key === "ArrowRight" ? (current + 1) % organizationSections.length
          : event.key === "ArrowLeft" ? (current + organizationSections.length - 1) % organizationSections.length
          : event.key === "Home" ? 0 : event.key === "End" ? organizationSections.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        setOrganizationSection(organizationSections[next].id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
      }}>
        {organizationSections.map(({ id, title, shortTitle, Icon }) => <button key={id} type="button" role="tab" aria-label={title} id={`organization-tab-${id}`} aria-controls={`organization-panel-${id}`} aria-selected={organizationSection === id} tabIndex={organizationSection === id ? 0 : -1} onClick={() => setOrganizationSection(id)}>
          <Icon size={18} aria-hidden="true" /><span className="management-tab-title">{title}</span><span className="management-tab-short-title" aria-hidden="true">{shortTitle}</span>
        </button>)}
      </div>
      <div className="organization-workspace">
        <section className="organization-main">
          <section className="panel organization-panel organization-directory" id="organization-panel-organizations" role="tabpanel" aria-labelledby="organization-tab-organizations" hidden={organizationSection !== "organizations"}>
          <header className="organization-section-heading"><span className="organization-section-icon"><UsersRound size={22} aria-hidden="true" /></span><div><h2>Participating organizations</h2><p>Maintain confirmed office responsibilities and routing guidance.</p></div><span className="management-section-count">{directoryOrganizations.length} {includeInactiveOrganizations ? "organizations" : "active organizations"}</span></header>
          {inactiveOrganizationCount > 0 && <label className="check organization-inactive-filter"><input type="checkbox" checked={includeInactiveOrganizations} onChange={event => setIncludeInactiveOrganizations(event.target.checked)} />Show inactive organizations ({inactiveOrganizationCount})</label>}
          <div className="organization-directory-layout"><div className="organization-list" aria-label="Participating organizations">
          {!directoryOrganizations.length && <p className="empty">No active organizations. Add an office or show inactive organizations to review earlier entries.</p>}
          {directoryOrganizations.map((o) => (
            <div className="report-row organization-row" key={o.id}>
              <div className="organization-row-name">
                <strong>{o.name}</strong>
              </div>
                <span className={`organization-status${(o as Lookup & { active: boolean }).active ? " active" : " inactive"}`}>
                  {(o as Lookup & { active: boolean }).active
                    ? "Active"
                    : "Inactive"}
                </span>
              {admin && (
                <button
                  className="secondary organization-toggle"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      db!
                        .from("organizations")
                        .update({
                          active: !(o as Lookup & { active: boolean }).active,
                        })
                        .eq("id", o.id),
                    )
                  }
                >
                  {(o as Lookup & { active: boolean }).active
                    ? "Deactivate"
                    : "Activate"}
                </button>
              )}
            </div>
          ))}
          </div>
          {admin && (
            <form
              className="organization-form organization-create-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(
                  db!.from("organizations").insert({ name: f.get("name") }),
                );
              }}
            >
              <div className="organization-form-heading"><span className="organization-section-icon"><Building2 size={20} aria-hidden="true" /></span><div><h3>Add organization</h3><p>Register a participating office. Set its access separately under Office permissions.</p></div></div>
              <label>
                Organization name
                <input name="name" required minLength={2} maxLength={120} placeholder="Enter organization name…" />
              </label>
              <div className="organization-form-actions"><button disabled={busy}><Plus size={17} aria-hidden="true" />Add organization</button></div>
            </form>
          )}
          </div>
          </section>
          <section className="panel organization-panel organization-routing" id="organization-panel-routing" role="tabpanel" aria-labelledby="organization-tab-routing" hidden={organizationSection !== "routing"}>
          <header className="organization-section-heading"><span className="organization-section-icon"><GitBranch size={22} aria-hidden="true" /></span><div><h2>Department routing</h2><p>
            Configure category and barangay guidance for staff handoffs. These
            rules suggest a destination after review; they do not auto-assign
            reports or grant office access. Eligible destinations also need an
            enabled access rule under Office permissions.
          </p></div></header>
          <div className="organization-routing-layout"><div className="organization-route-list">
          {rules.error && <p className="error">{rules.error.message}</p>}
          {rules.isPending && <p className="muted">Loading routing guidance…</p>}
          {!rules.isPending && !rules.error && !rules.data?.length && (
            <div className="routing-guidance-empty organization-routing-empty"><Info size={20} aria-hidden="true" /><div>
              <strong>No department routes configured</strong>
              <p>
                Reports will remain in the review queue until staff route them.
                Add guidance only after the city approves the responsible office
                for a category and area, then enable matching office access.
              </p>
            </div></div>
          )}
          {rules.data?.map((r) => (
            <article className="community-card organization-route-card" key={r.id}>
              <strong>
                <ReportCategoryLabel name={refs.categories.find((c) => c.id === r.category_id)?.name || "Other"} compact />
              </strong>
              <p>
                {refs.barangays.find((b) => b.id === r.barangay_id)?.name ||
                  "All barangays"}{" "}
                →{" "}
                {
                  refs.organizations.find((o) => o.id === r.organization_id)
                    ?.name
                }
              </p>
              <small>{r.notes}</small>
              {admin && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(db!.from("routing_rules").delete().eq("id", r.id))
                  }
                >
                  Remove rule
                </button>
              )}
            </article>
          ))}
          </div>
          {admin && (
            <form
              className="organization-form organization-routing-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(
                  db!.from("routing_rules").insert({
                    category_id: f.get("category"),
                    barangay_id: f.get("barangay") || null,
                    organization_id: f.get("organization"),
                    notes: f.get("notes"),
                  }),
                );
              }}
            >
              <h3>Add routing rule</h3>
              <label>
                Category
                <select name="category" required>
                  {refs.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {reportCategoryPresentation(c.name).label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Barangay
                <select name="barangay">
                  <option value="">All barangays</option>
                  {refs.barangays.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Organization
                <select required name="organization">
                  {activeOrganizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Handoff guidance
                <textarea name="notes" maxLength={1000} placeholder="When this office should receive the report…" />
              </label>
              <div className="organization-form-actions"><button disabled={busy}><Plus size={17} aria-hidden="true" />Add routing rule</button></div>
            </form>
          )}
          </div>
          </section>
        </section>
        {admin && (
          <section className="panel organization-panel administration-accounts" id="organization-panel-accounts" role="tabpanel" aria-labelledby="organization-tab-accounts" hidden={organizationSection !== "accounts"}>
            <header className="organization-section-heading"><span className="organization-section-icon"><UsersRound size={22} aria-hidden="true" /></span><div><h2>Stakeholder accounts</h2><p>Invite staff, assign their scope, and manage account approval.</p></div></header>
            <div className="administration-account-grid">
            <form className="organization-form administration-invite-form" onSubmit={(event) => void inviteStaff(event)}>
              <div className="organization-form-heading"><span className="organization-section-icon"><MailPlus size={20} aria-hidden="true" /></span><div><h3>Create a stakeholder account</h3><p>Send an invitation to an authorized staff member. New accounts require approval.</p></div></div>
              <label>
                Staff member name
                <input name="invite_name" required minLength={2} maxLength={100} autoComplete="name" placeholder="Enter full name" />
              </label>
              <label>
                Email for invitation
                <input name="invite_email" type="email" required maxLength={254} autoComplete="email" placeholder="Enter email address" />
              </label>
              <label>
                Stakeholder type
                <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "barangay" | "office")}>
                  <option value="barangay">Barangay staff</option>
                  <option value="office">City office or service provider</option>
                </select>
              </label>
              {inviteRole === "barangay" ? (
                <label>
                  Assigned barangay
                  <select name="invite_barangay" required defaultValue="">
                    <option value="" disabled>Choose a barangay</option>
                    {refs.barangays.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              ) : (
                <label>
                  Office or service provider
                  <select name="invite_organization" required defaultValue="">
                    <option value="" disabled>Choose an active organization</option>
                    {activeOrganizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
              )}
              <p className="fine">
                Office memberships identify the stakeholder. Configure report categories and geographic coverage separately under Office responsibilities &amp; permissions.
              </p>
              <button disabled={busy || (inviteRole === "office" && !activeOrganizations.length)}><MailPlus size={17} aria-hidden="true" />
                {busy ? "Sending invitation…" : "Create account and send invitation"}
              </button>
            </form>
            <section className="administration-account-management">
            <div className="organization-form-heading"><span className="organization-section-icon"><ShieldCheck size={20} aria-hidden="true" /></span><div><h3>Manage existing accounts</h3><p>Review roles, jurisdiction, memberships, and approval status.</p></div></div>
            <label>
              Search current account page
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or account identifier"
              />
            </label>
            <label>
              Account
              <select value={user} onChange={(e) => setUser(e.target.value)}>
                <option value="">Choose an account</option>
                {q.data?.people
                  .filter((p) =>
                    (p.display_name + p.id)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name || p.id} · {roleNames[p.role]} ·{" "}
                      {p.account_status}
                    </option>
                  ))}
              </select>
            </label>
            {q.isPending && <p className="notice" role="status">Loading accounts…</p>}
            {!q.isPending && !q.error && !q.data?.people.length && <p className="notice">No accounts found on this page.</p>}
            <div className="pagination administration-account-pagination">
              <button
                className="secondary"
                disabled={!page}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>Page {page + 1}</span>
              <button
                className="secondary"
                disabled={(q.data?.people.length ?? 0) < 50}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
            {person && (
              <div key={`${person.id}:${person.role}:${person.barangay_id}:${person.account_status}`} className="administration-account-editor">
                <small className="mono">{person.id}</small>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      db!.rpc("set_role", {
                        p_user: user,
                        p_role: new FormData(e.currentTarget).get("role"),
                      }),
                    );
                  }}
                >
                  <label>
                    Role
                    <select name="role" defaultValue={person.role}>
                      {["resident", "barangay", "office", "admin"].map((r) => (
                        <option key={r} value={r}>
                          {roleNames[r as keyof typeof roleNames]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={busy}>Assign role</button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      db!.rpc("set_staff_scope", {
                        p_user: user,
                        p_barangay:
                          new FormData(e.currentTarget).get("barangay") || null,
                      }),
                    );
                  }}
                >
                  <label>
                    Barangay jurisdiction
                    <select
                      name="barangay"
                      defaultValue={person.barangay_id || ""}
                    >
                      <option value="">No barangay</option>
                      {refs.barangays.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={busy}>Save jurisdiction</button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      db!.rpc("set_account_status", {
                        p_user: user,
                        p_status: new FormData(e.currentTarget).get("status"),
                      }),
                    );
                  }}
                >
                  <label>
                    Account approval & status
                    <select name="status" defaultValue={person.account_status}>
                      <option value="pending">Pending approval</option>
                      <option value="active">Active / approved</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>
                  <p className="fine">
                    Changing a staff role requires approval again. Assign
                    jurisdiction or organization before activating. Disabled
                    accounts lose backend access immediately.
                  </p>
                  <button disabled={busy}>Save account status</button>
                </form>
                <h3>Organization memberships</h3>
                {q.data?.memberships
                  .filter((m) => m.user_id === user)
                  .map((m) => (
                    <div className="report-row" key={m.organization_id}>
                      <strong>
                        {
                          refs.organizations.find(
                            (o) => o.id === m.organization_id,
                          )?.name
                        }
                      </strong>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            db!
                              .from("organization_memberships")
                              .delete()
                              .eq("user_id", user)
                              .eq("organization_id", m.organization_id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      db!.from("organization_memberships").upsert({
                        user_id: user,
                        organization_id: new FormData(e.currentTarget).get(
                          "organization",
                        ),
                      }),
                    );
                  }}
                >
                  <label>
                    Add membership
                    <select name="organization">
                      {activeOrganizations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={busy || !activeOrganizations.length}>Save membership</button>
                </form>
              </div>
            )}
            {!person && !q.isPending && <div className="administration-account-placeholder"><UsersRound size={28} aria-hidden="true" /><strong>Choose an account to manage</strong><p>Its role, barangay, approval status, and memberships will appear here.</p></div>}
            </section>
            </div>
          </section>
        )}
        {admin && <section className="panel organization-panel administration-configuration" id="organization-panel-configuration" role="tabpanel" aria-labelledby="organization-tab-configuration" hidden={organizationSection !== "configuration"}>
            <header className="organization-section-heading"><span className="organization-section-icon"><Settings2 size={22} aria-hidden="true" /></span><div><h2>System configuration</h2><p>Manage approved categories and the parameters used for local assessment.</p></div></header>
            <div className="administration-configuration-grid">
            <section className="administration-category-panel">
            <div className="organization-form-heading"><span className="organization-section-icon"><Layers3 size={20} aria-hidden="true" /></span><div><h3>Approved issue categories</h3><p>Control which categories residents can use for new reports.</p></div></div>
            {refs.categories.map((c) => (
              <div className="report-row administration-category-row" key={c.id}>
                <ReportCategoryLabel name={c.name} compact />
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      db!
                        .from("report_categories")
                        .update({
                          active: !(c as Lookup & { active: boolean }).active,
                        })
                        .eq("id", c.id),
                    )
                  }
                >
                  {(c as Lookup & { active: boolean }).active
                    ? "Disable"
                    : "Enable"}
                </button>
              </div>
            ))}
            </section>
            <section className="administration-assessment-panel">
            <div className="organization-form-heading"><span className="organization-section-icon"><Settings2 size={20} aria-hidden="true" /></span><div><h3>Assessment configuration</h3><p>Adjust recurrence detection and assessment weights. Staff still review every priority.</p></div></div>
            {settings.isPending && <p className="notice" role="status">Loading assessment settings…</p>}
            {settings.data && (
              <form className="organization-form administration-settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    db!
                      .from("analytics_settings")
                      .update(
                        { ...Object.fromEntries(
                          [...new FormData(e.currentTarget).entries()].filter(([k]) => k !== "include_samples").map(
                            ([k, v]) => [k, Number(v)],
                          ),
                        ), include_samples: new FormData(e.currentTarget).get("include_samples") === "on" },
                      )
                      .eq("id", true),
                  );
                }}
              >
                {[
                  "radius_m",
                  "window_days",
                  "count_weight",
                  "severity_weight",
                  "age_weight",
                ].map((k) => (
                  <label key={k}>
                    {label(k)}
                    <input
                      type="number"
                      step={k.endsWith("weight") ? "0.1" : "1"}
                      min={k === "radius_m" ? 10 : k === "window_days" ? 1 : 0}
                      max={
                        k === "radius_m"
                          ? 1000
                          : k === "window_days"
                            ? 365
                            : 1000
                      }
                      required
                      name={k}
                      defaultValue={settings.data[k]}
                    />
                  </label>
                ))}
                <label className="presentation-record-setting"><input type="checkbox" name="include_samples" defaultChecked={settings.data.include_samples} /><span><strong>Include presentation records</strong><small>Include prepared records in workspace views and analytics. Turn off to view incoming submissions only.</small></span></label>
                <button disabled={busy}>Save settings</button>
              </form>
            )}
            </section></div>
          </section>}
      </div>
      {admin && <div className="organization-permissions-panel" id="organization-panel-permissions" role="tabpanel" aria-labelledby="organization-tab-permissions" hidden={organizationSection !== "permissions"}><AccessAdministration refs={refs} /></div>}
      {admin && (
        <section className="panel organization-panel administration-audit" id="organization-panel-audit" role="tabpanel" aria-labelledby="organization-tab-audit" hidden={organizationSection !== "audit"}>
          <header className="administration-audit-heading"><div className="organization-section-heading"><span className="organization-section-icon"><History size={22} aria-hidden="true" /></span><div><h2>Recent audit trail</h2><p>Review the latest 50 recorded changes. Expand an event to inspect its details.</p></div></div><label><span className="sr-only">Filter audit activity</span><select aria-label="Filter audit activity" value={auditFilter} onChange={(event) => {setAuditFilter(event.target.value);setAuditPage(0);}}><option value="">All activities</option>{[...new Set(audit.data?.map((entry) => entry.entity))].sort().map((entity) => <option key={entity} value={entity}>{label(entity)}</option>)}</select></label></header>
          {audit.isPending && <p className="notice" role="status">Loading audit trail…</p>}
          {!audit.isPending && !audit.error && !auditRows.length && <p className="notice">No recorded activity matches this filter.</p>}
          <div className="administration-audit-list">
          {auditRows.slice(visibleAuditPage * 15, visibleAuditPage * 15 + 15).map((a) => {
            const action = a.action === "INSERT" ? { text: "Created", kind: "created", Icon: Plus }
              : a.action === "UPDATE" ? { text: "Updated", kind: "updated", Icon: PencilLine }
              : a.action === "DELETE" ? { text: "Deleted", kind: "deleted", Icon: Trash2 }
              : { text: label(a.action.toLowerCase()), kind: "other", Icon: History };
            const snapshot = (a.new_value || a.old_value) as Record<string, unknown> | null;
            const subjectValue = snapshot?.title || snapshot?.name || snapshot?.display_name;
            const subject = typeof subjectValue === "string" && subjectValue.trim() ? subjectValue : "View recorded details";
            const actorName = a.actor?.display_name?.trim() || (a.actor_id ? "Unavailable account" : "System");
            const initials = actorName.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
            return (
            <details className="audit-item" key={a.id}>
              <summary>
                <span className={`administration-audit-symbol ${action.kind}`}><action.Icon size={16} aria-hidden="true" /></span><span className="administration-audit-event"><strong>{label(a.entity)}</strong><small>{action.text}</small></span><span className="administration-audit-subject" title={subject}>{subject}</span>
                <span className="administration-audit-actor"><span aria-hidden="true">{initials}</span><span>{actorName}</span></span>
                <time dateTime={a.created_at}>{new Intl.DateTimeFormat("en-PH", {dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Manila"}).format(new Date(a.created_at))}</time>
                <ChevronDown className="administration-audit-chevron" size={16} aria-hidden="true" />
              </summary>
              <p className="mono">{a.record_id}</p>
              <div className="two-col">
                <div>
                  <h3>Before</h3>
                  <pre>{JSON.stringify(a.old_value, null, 2)}</pre>
                </div>
                <div>
                  <h3>After</h3>
                  <pre>{JSON.stringify(a.new_value, null, 2)}</pre>
                </div>
              </div>
            </details>
          );})}
          </div>
          {!!auditRows.length && <div className="pagination administration-audit-pagination"><span role="status">{visibleAuditPage * 15 + 1}–{Math.min(visibleAuditPage * 15 + 15, auditRows.length)} of {auditRows.length} recent events</span><div><button className="secondary" disabled={!visibleAuditPage} onClick={() => setAuditPage(visibleAuditPage - 1)}>Previous</button><button className="secondary" disabled={(visibleAuditPage + 1) * 15 >= auditRows.length} onClick={() => setAuditPage(visibleAuditPage + 1)}>Next</button></div></div>}
        </section>
      )}
    </>
  );
}
