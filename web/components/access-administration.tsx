"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Plus, Building2, UsersRound, Layers3, LockKeyhole, Info } from "lucide-react";
import { db, result } from "../lib/client";
import type { AccessRule, Organization } from "../lib/access";
import type { References } from "./workspace";
import { ReportCategoryLabel, reportCategoryPresentation } from "./report-category";

export function AccessAdministration({ refs }: { refs: References }) {
  const activeOrganizations = refs.organizations.filter(o => (o as Organization).active !== false);
  const [id, setId] = useState(activeOrganizations[0]?.id || ""),
    [editing, setEditing] = useState<AccessRule | null>(null);
  const [message, setMessage] = useState(""),
    [messageKind, setMessageKind] = useState<"success" | "error">("success"),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const editorHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (refs.organizations.some(o => o.id === id && (o as Organization).active !== false)) return;
    setId(refs.organizations.find(o => (o as Organization).active !== false)?.id || "");
    setEditing(null);
  }, [refs.organizations, id]);
  function editRule(rule: AccessRule | null) {
    setEditing(rule);
    setMessage("");
    setMessageKind("success");
    requestAnimationFrame(() => {
      editorHeading.current?.focus({ preventScroll: true });
      editorHeading.current?.scrollIntoView({ block: "start" });
    });
  }
  const organization = refs.organizations.find((o) => o.id === id) as
    Organization | undefined;
  const q = useQuery({
    queryKey: ["access-rules", id],
    enabled: activeOrganizations.some(o => o.id === id),
    queryFn: () =>
      result<AccessRule[]>(
        db!
          .from("organization_access_rules")
          .select("*")
          .eq("organization_id", id)
          .order("category_id"),
      ),
  });
  async function save(
    query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ) {
    setBusy(true);
    setMessage("");
    try {
      await result(query);
      await qc.invalidateQueries();
      setMessageKind("success");
      setMessage(
        "Access configuration saved. It takes effect on the next database request.",
      );
      setEditing(null);
    } catch (e) {
      setMessageKind("error");
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel office-permission-workspace">
      <div className="organization-section-heading">
        <span className="organization-section-icon"><ShieldCheck size={23} aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">SERVER-ENFORCED ACCESS</p>
          <h2>Office responsibilities & permissions</h2>
          <p>Define approved local responsibilities. Organization names do not grant access. Each report must match an enabled category and jurisdiction rule; assignment-only rules additionally require an explicit referral.</p>
        </div>
      </div>
      <label className="office-permission-selector">
        <span className="organization-section-icon"><Building2 size={21} aria-hidden="true" /></span>
        <span>
        Configure organization
        <select
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setEditing(null);
            setMessage("");
            setMessageKind("success");
          }}
        >
          <option value="">Choose an organization</option>
          {activeOrganizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        </span>
      </label>
      {message && (
        <p className={`office-permission-message ${messageKind === "error" ? "error" : "notice"}`} role={messageKind === "error" ? "alert" : "status"}>
          {message}
        </p>
      )}
      {q.error && (
        <p className="error" role="alert">
          {q.error.message}
        </p>
      )}
      {organization && (
        <div className="office-permission-grid">
          <div className="office-permission-main">
            <form
              className="office-permission-community"
              key={id + JSON.stringify(organization)}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void save(
                  db!
                    .from("organizations")
                    .update({
                      responsibilities: f.get("responsibilities"),
                      can_consult: f.has("can_consult"),
                      can_coordinate: f.has("can_coordinate"),
                      can_publish: f.has("can_publish"),
                    })
                    .eq("id", id),
                );
              }}
            >
              <div className="organization-section-heading"><span className="organization-section-icon"><UsersRound size={21} aria-hidden="true" /></span><div><h3>Community responsibilities</h3><p>Set what this office can do within its approved coverage.</p></div></div>
              <fieldset className="office-permission-checks"><legend className="sr-only">Community capabilities</legend>
              {(
                [
                  ["can_consult", "Manage consultations and official replies"],
                  [
                    "can_coordinate",
                    "Coordinate meetings in permitted coverage",
                  ],
                  [
                    "can_publish",
                    "Publish announcements in permitted coverage",
                  ],
                ] as const
              ).map(([key, title]) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    name={key}
                    defaultChecked={organization[key]}
                  />
                  {title}
                </label>
              ))}
              </fieldset>
              <label>
                Approved responsibility statement
                <textarea
                  name="responsibilities"
                  defaultValue={organization.responsibilities}
                  maxLength={2000}
                  placeholder="Record the agreed responsibilities and approval reference."
                />
              </label>
              <p className="fine">
                Community actions also require enabled geographic coverage.
                Meeting decisions require review permission on the request’s
                category or linked report. Citywide announcements require an
                all-barangay rule.
              </p>
              <button disabled={busy}><LockKeyhole size={16} aria-hidden="true" />Save community permissions</button>
            </form>
            <section className="office-permission-configured">
            <div className="organization-section-heading"><span className="organization-section-icon"><Layers3 size={21} aria-hidden="true" /></span><div><h3>Configured report access</h3><p>Category-based permissions for this organization.</p></div></div>
            {q.isPending ? (
              <p role="status" className="office-permission-empty">Loading rules…</p>
            ) : !q.data?.length ? (
              <p className="office-permission-empty">
                No rules configured. Members can open the heatmap, but no
                private reports are available.
              </p>
            ) : (
              q.data.map((r) => (
                <article className="office-permission-rule" key={r.id}>
                  <div className="office-permission-rule-copy">
                    <ReportCategoryLabel compact name={refs.categories.find((c) => c.id === r.category_id)?.name || "Other"} />
                  <span>
                    {refs.barangays.find((b) => b.id === r.barangay_id)?.name ||
                      "All barangays"}{" "}
                    ·{" "}
                    {r.assignment_only
                      ? "Assigned reports only"
                      : "All matching reports"}
                  </span>
                  <small>
                    {[
                      "View",
                      r.can_review && "Review",
                      r.can_update && "Progress updates",
                      r.can_refer && "Refer",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  {r.notes && <p className="office-permission-rule-note">{r.notes}</p>}
                  </div>
                  <div className="office-permission-rule-actions">
                    <span className={`office-permission-status${r.enabled ? " enabled" : ""}`}>{r.enabled ? "Enabled" : "Draft"}</span>
                    <button type="button" className="secondary" onClick={() => editRule(r)}>
                      Edit rule
                    </button>
                    <button
                      disabled={busy}
                      type="button"
                      className={r.enabled ? "office-permission-disable" : "secondary"}
                      onClick={() =>
                        void save(
                          db!
                            .from("organization_access_rules")
                            .update({ enabled: !r.enabled })
                            .eq("id", r.id),
                        )
                      }
                    >
                      {r.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </article>
              ))
            )}
            </section>
          </div>
          <form
            className="office-permission-editor"
            key={id + (editing?.id || "new")}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const row = {
                organization_id: id,
                category_id: String(f.get("category")),
                barangay_id: f.get("barangay") || null,
                assignment_only: f.get("access") === "assigned",
                can_review: f.has("can_review"),
                can_update: f.has("can_update"),
                can_refer: f.has("can_refer"),
                enabled: f.has("enabled"),
                notes: String(f.get("notes")),
              };
              void save(
                editing
                  ? db!
                      .from("organization_access_rules")
                      .update(row)
                      .eq("id", editing.id)
                  : db!.from("organization_access_rules").insert(row),
              );
            }}
          >
            <div className="office-permission-editor-heading">
              <div className="organization-section-heading"><span className="organization-section-icon"><LockKeyhole size={21} aria-hidden="true" /></span><div><h3 ref={editorHeading} tabIndex={-1}>{editing ? "Edit access rule" : "Add category access"}</h3><p>Grant category-based access and define permissions for this organization.</p></div></div>
              {editing && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => editRule(null)}
                >
                  <Plus size={16} />
                  New rule
                </button>
              )}
            </div>
            <label>
              Issue category
              <select
                name="category"
                required
                defaultValue={editing?.category_id}
              >
                {refs.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {reportCategoryPresentation(c.name).label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Geographic coverage
              <select name="barangay" defaultValue={editing?.barangay_id || ""}>
                <option value="">All barangays</option>
                {refs.barangays.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Report access
              <select
                name="access"
                defaultValue={
                  editing?.assignment_only === false ? "coverage" : "assigned"
                }
              >
                <option value="assigned">
                  Only reports assigned to this organization
                </option>
                <option value="coverage">
                  All matching category reports in this coverage
                </option>
              </select>
            </label>
            <fieldset className="office-permission-checks"><legend>Permissions</legend><p>Select the actions this office can perform for this category.</p>
            {(
              [
                ["can_review", "Review, verify, reject and reopen"],
                ["can_update", "Update progress and resolve"],
                ["can_refer", "Assign or refer to an approved office"],
              ] as const
            ).map(([key, title]) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  name={key}
                  defaultChecked={editing?.[key] ?? false}
                />
                {title}
              </label>
            ))}
            </fieldset>
            <label>
              Approval reference / notes
              <textarea
                name="notes"
                maxLength={2000}
                defaultValue={editing?.notes || ""}
                placeholder="For example: national-road referrals only; jurisdiction confirmed by assigned office."
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={editing?.enabled ?? false}
              />
              Enable this approved rule
            </label>
            <button disabled={busy}>
              <LockKeyhole size={16} aria-hidden="true" />
              {busy ? "Saving…" : "Save access rule"}
            </button>
          </form>
        </div>
      )}
      {!organization && <p className="office-permission-empty"><Info size={18} aria-hidden="true" />Choose an organization to review its responsibilities and access rules.</p>}
    </section>
  );
}
