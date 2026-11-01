"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  MapPin,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { Profile } from "@community/shared";
import type { Organization } from "../lib/access";
import { roleNames } from "../lib/access";
import { db, result } from "../lib/client";

export function SettingsPanel({
  profile,
  organizations = [],
  barangayName,
  recovery = false,
  onDone,
}: {
  profile?: Profile;
  organizations?: Pick<Organization, "id" | "name">[];
  barangayName?: string;
  recovery?: boolean;
  onDone?: () => void;
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false),
    [showConfirm, setShowConfirm] = useState(false);
  const qc = useQueryClient();

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setMessage("Your changes have been saved.");
      await qc.invalidateQueries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not save those changes. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={recovery ? "settings-workspace settings-recovery" : "settings-workspace"}>
      <section className="panel settings-card settings-preferences" aria-labelledby="settings-workspace-title">
        <header className="settings-card-heading">
          <span className="settings-icon"><SlidersHorizontal size={21} /></span>
          <div>
            <h2 id="settings-workspace-title">{recovery ? "Choose a new password" : "Workspace settings"}</h2>
            <p>{recovery ? "Set a secure password for your account." : "Update your display name and security preferences."}</p>
          </div>
        </header>

        {message && <p className="settings-feedback" role="status" aria-live="polite">{message}</p>}

        {!recovery && profile && (
          <form className="settings-form settings-profile-form" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const displayName = String(data.get("name") || "").trim();
            if (!displayName) {
              setMessage("Enter a display name before saving.");
              return;
            }
            void run(() => result(db!.from("profiles").update({
              display_name: displayName,
              notifications_enabled: data.get("notifications") === "on",
            }).eq("id", profile.id)));
          }}>
            <label className="settings-field">
              <span>Display name</span>
              <small>This name appears on reports, meetings, and community records.</small>
              <input required name="name" minLength={2} maxLength={100} defaultValue={profile.display_name} autoComplete="name" />
            </label>

            <label className="settings-preference-row">
              <span className="settings-icon"><Bell size={20} /></span>
              <span className="settings-preference-copy">
                <strong>Receive in-app updates</strong>
                <small>Get notified about reports, assignments, and important updates.</small>
              </span>
              <input type="checkbox" name="notifications" defaultChecked={profile.notifications_enabled} />
            </label>
            <button className="settings-primary" disabled={busy}>{busy ? "Saving…" : "Save workspace settings"}</button>
          </form>
        )}

        <div className="settings-divider" />
        {!recovery && <header className="settings-subheading">
          <span className="settings-icon settings-icon-blue"><KeyRound size={20} /></span>
          <div><h3>Change password</h3><p>Choose a strong password you do not use elsewhere.</p></div>
        </header>}
        <form className="settings-form settings-password-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(event.currentTarget);
          if (data.get("password") !== data.get("confirm")) {
            setMessage("Those passwords do not match. Check both fields and try again.");
            return;
          }
          void run(async () => {
            const { error } = await db!.auth.updateUser({ password: String(data.get("password")) });
            if (error) throw error;
            form.reset();
            onDone?.();
          });
        }}>
          <label className="settings-field">
            <span>New password</span>
            <span className="settings-password-input">
              <input maxLength={1024} name="password" type={showPassword ? "text" : "password"} minLength={12} autoComplete="new-password" required />
              <button type="button" className="settings-reveal" aria-label={showPassword ? "Hide new password" : "Show new password"} aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </span>
          </label>
          <label className="settings-field">
            <span>Confirm new password</span>
            <span className="settings-password-input">
              <input maxLength={1024} name="confirm" type={showConfirm ? "text" : "password"} minLength={12} autoComplete="new-password" required />
              <button type="button" className="settings-reveal" aria-label={showConfirm ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={showConfirm} onClick={() => setShowConfirm((shown) => !shown)}>{showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </span>
          </label>
          <small className="settings-password-hint">Use at least 12 characters.</small>
          <button className="settings-primary" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
        </form>
      </section>

      {!recovery && profile && (
        <section className="panel settings-card settings-access" aria-labelledby="settings-access-title">
          <header className="settings-access-heading">
            <span className="settings-icon"><ShieldCheck size={22} /></span>
            <div><h2 id="settings-access-title">Access and accountability</h2><p>Your administrator manages your role and authorized scope.</p></div>
          </header>

          <div className="settings-access-list">
            <div className="settings-access-row">
              <span className="settings-line-icon"><UserRound size={20} /></span>
              <span><strong>Role</strong><small>Your current role and system permissions.</small></span>
              <span className="settings-value">{roleNames[profile.role]}</span>
            </div>
            <div className="settings-access-row">
              <span className="settings-line-icon"><MapPin size={20} /></span>
              <span><strong>{profile.role === "barangay" ? "Barangay jurisdiction" : "Assigned area"}</strong><small>{profile.role === "barangay" ? "The barangay you are assigned to." : "The area available to your account."}</small></span>
              <span className="settings-value">{profile.role === "barangay" ? barangayName || "Not assigned" : profile.role === "admin" ? "Iligan City" : "Set by permissions"}</span>
            </div>
            <div className="settings-access-row">
              <span className="settings-line-icon"><UsersRound size={20} /></span>
              <span><strong>Organization memberships</strong><small>Your active organization access.</small></span>
              <span className="settings-memberships">
                {organizations.length ? organizations.map((organization) => <span className="settings-value" key={organization.id}>{organization.name}</span>) : <span className="settings-value">None assigned</span>}
              </span>
            </div>
          </div>

          <div className="settings-audit-note">
            <Building2 size={18} />
            <p>Report and community actions are recorded in the audit trail. Private evidence is visible only within your authorized scope.</p>
          </div>
          <button className="settings-signout" disabled={busy} onClick={() => void run(async () => {
            const { error } = await db!.auth.signOut({ scope: "global" });
            if (error) throw error;
          })}>
            <LogOut size={17} /> Sign out of all sessions
          </button>
        </section>
      )}
    </div>
  );
}
