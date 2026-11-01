import type { Profile, Report, Status } from "@community/shared";

export type Organization = {
  id: string;
  name: string;
  active: boolean;
  responsibilities: string;
  can_consult: boolean;
  can_coordinate: boolean;
  can_publish: boolean;
};
export type AccessRule = {
  id: string;
  organization_id: string;
  category_id: string;
  barangay_id: string | null;
  assignment_only: boolean;
  can_review: boolean;
  can_update: boolean;
  can_refer: boolean;
  enabled: boolean;
  notes: string;
};
export type StaffContext = {
  profile: Profile & { account_status: "pending" | "active" | "disabled" };
  authorized: boolean;
  organizations: Organization[];
  rules: AccessRule[];
};
export const roleNames = {
  admin: "System administrator",
  barangay: "Barangay staff",
  office: "Office staff",
  resident: "Resident",
};
export function permissionFingerprint(access: StaffContext | null | undefined) {
  if (!access) return "";
  const { id, role, barangay_id, account_status } = access.profile;
  return JSON.stringify({
    authorized: access.authorized,
    profile: { id, role, barangay_id, account_status },
    organizations: access.organizations.map((o) =>
      [o.id, o.active, o.can_consult, o.can_coordinate, o.can_publish],
    ).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    rules: access.rules.map((r) => [
      r.id, r.organization_id, r.category_id, r.barangay_id,
      r.assignment_only, r.can_review, r.can_update, r.can_refer, r.enabled,
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}
export function canPrioritize(access: StaffContext) {
  return (
    access.authorized && ["admin", "barangay"].includes(access.profile.role)
  );
}
export function canOpenSection(access: StaffContext, section: string) {
  if (!access.authorized) return false;
  if (["Administration", "Organizations"].includes(section))
    return access.profile.role === "admin";
  if (section === "Barangay prioritization") return canPrioritize(access);
  return [
    "Overview",
    "Issue reports",
    "Issue Mapping & Heatmap",
    "Geographic analytics",
    "Consultations",
    "Meeting requests",
    "Announcements",
    "Settings",
  ].includes(section);
}
export function canCreate(
  access: StaffContext,
  module: "consultations" | "announcements",
) {
  if (module === "announcements")
    return (
      access.authorized &&
      (access.profile.role === "admin" ||
        (access.profile.role === "barangay" && !!access.profile.barangay_id) ||
        (access.profile.role === "office" &&
          access.organizations.some(
            (o) =>
              o.active &&
              access.rules.some((r) => r.organization_id === o.id && r.enabled),
          )))
    );
  return (
    access.authorized &&
    (access.profile.role !== "office" ||
      access.organizations.some(
        (o) =>
          (module === "consultations" ? o.can_consult : o.can_publish) &&
          access.rules.some((r) => r.organization_id === o.id && r.enabled),
      ))
  );
}
export function reportAction(status: Status): "review" | "refer" | "update" {
  return status === "assigned"
    ? "refer"
    : ["in_progress", "resolved"].includes(status)
      ? "update"
      : "review";
}
export function canAccessReport(
  access: StaffContext,
  report: Pick<Report, "barangay_id" | "category_id" | "organization_id">,
  action: "read" | "review" | "update" | "refer" = "read",
) {
  if (!access.authorized) return false;
  if (access.profile.role === "admin") return true;
  if (access.profile.role === "barangay")
    return access.profile.barangay_id === report.barangay_id;
  return (
    access.profile.role === "office" &&
    access.rules.some(
      (r) =>
        r.enabled &&
        access.organizations.some(
          (o) => o.id === r.organization_id && o.active,
        ) &&
        r.category_id === report.category_id &&
        (!r.barangay_id || r.barangay_id === report.barangay_id) &&
        (!r.assignment_only || r.organization_id === report.organization_id) &&
        (action === "read" || r[`can_${action}`]),
    )
  );
}
