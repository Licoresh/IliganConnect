import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAccessReport,
  canCreate,
  canPrioritize,
  canOpenSection,
  reportAction,
  permissionFingerprint,
  type StaffContext,
} from "../web/lib/access";

test("every approved functional staff role has the same heatmap navigation", () => {
  for (const role of ["admin", "barangay", "office"] as const) {
    const context = { ...access, profile: { ...access.profile, role } };
    assert.equal(canOpenSection(context, "Issue Mapping & Heatmap"), true);
    assert.equal(canOpenSection(context, "Administration"), role === "admin");
    assert.equal(canOpenSection(context, "Organizations"), role === "admin");
  }
  assert.equal(
    canOpenSection({ ...access, authorized: false }, "Issue Mapping & Heatmap"),
    false,
  );
  assert.equal(canOpenSection(access, "unknown"), false);
});
const access: StaffContext = {
  authorized: true,
  profile: {
    id: "u",
    role: "office",
    display_name: "Demo",
    barangay_id: null,
    account_status: "active",
    notifications_enabled: true,
  },
  organizations: [
    {
      id: "o",
      name: "Office",
      active: true,
      responsibilities: "",
      can_consult: true,
      can_coordinate: true,
      can_publish: false,
    },
  ],
  rules: [
    {
      id: "rule",
      organization_id: "o",
      category_id: "c",
      barangay_id: "b",
      assignment_only: true,
      can_review: false,
      can_update: true,
      can_refer: false,
      enabled: true,
      notes: "",
    },
  ],
};
const report = { barangay_id: "b", category_id: "c", organization_id: "o" };
test("office display permissions intersect category, jurisdiction and assignment", () => {
  assert.equal(canAccessReport(access, report), true);
  for (const change of [
    { barangay_id: "other" },
    { category_id: "other" },
    { organization_id: "other" },
  ])
    assert.equal(canAccessReport(access, { ...report, ...change }), false);
  assert.equal(
    canAccessReport({ ...access, authorized: false }, report),
    false,
  );
});
test("progress permission does not imply review, referral or publishing", () => {
  assert.equal(canAccessReport(access, report, "update"), true);
  assert.equal(canAccessReport(access, report, "review"), false);
  assert.equal(canAccessReport(access, report, "refer"), false);
  assert.equal(canCreate(access, "consultations"), true);
  assert.equal(canCreate(access, "announcements"), true);
  assert.equal(canPrioritize(access), false);
});
test("barangay display access spans all categories only within assigned barangay", () => {
  const barangay = {
    ...access,
    profile: { ...access.profile, role: "barangay" as const, barangay_id: "b" },
  };
  assert.equal(
    canAccessReport(barangay, {
      ...report,
      category_id: "other",
      organization_id: null,
    }),
    true,
  );
  assert.equal(
    canAccessReport(barangay, { ...report, barangay_id: "other" }),
    false,
  );
  assert.equal(canPrioritize(barangay), true);
});
test("workflow actions map to explicit review, progress and referral permissions", () => {
  assert.equal(reportAction("verified"), "review");
  assert.equal(reportAction("under_review"), "review");
  assert.equal(reportAction("assigned"), "refer");
  assert.equal(reportAction("scheduled"), "update");
  assert.equal(reportAction("resolved"), "update");
});

test("cosmetic profile and office edits preserve the permission fingerprint", () => {
  assert.equal(permissionFingerprint(access), permissionFingerprint({
    ...access,
    profile: { ...access.profile, display_name: "Updated", notifications_enabled: false },
    organizations: access.organizations.map((o) => ({ ...o, name: "Renamed", responsibilities: "Updated" })),
    rules: access.rules.map((r) => ({ ...r, notes: "Updated guidance" })),
  }));
});

test("permission fingerprints ignore database row ordering without mutating rows", () => {
  const context = {
    ...access,
    organizations: [...access.organizations, { ...access.organizations[0], id: "another" }],
    rules: [...access.rules, { ...access.rules[0], id: "another-rule" }],
  };
  const original = structuredClone(context);
  assert.equal(permissionFingerprint(context), permissionFingerprint({
    ...context, organizations: [...context.organizations].reverse(), rules: [...context.rules].reverse(),
  }));
  assert.deepEqual(context, original);
});

test("account, membership, jurisdiction and capability changes invalidate permissions", () => {
  const changes: StaffContext[] = [
    { ...access, authorized: false },
    { ...access, profile: { ...access.profile, account_status: "disabled" } },
    { ...access, profile: { ...access.profile, role: "barangay" } },
    { ...access, profile: { ...access.profile, barangay_id: "different" } },
    { ...access, organizations: [] },
    { ...access, rules: [] },
  ];
  for (const field of ["active", "can_consult", "can_coordinate", "can_publish"] as const)
    changes.push({ ...access, organizations: [{ ...access.organizations[0], [field]: !access.organizations[0][field] }] });
  for (const field of ["enabled", "assignment_only", "can_review", "can_update", "can_refer"] as const)
    changes.push({ ...access, rules: [{ ...access.rules[0], [field]: !access.rules[0][field] }] });
  for (const field of ["organization_id", "category_id", "barangay_id"] as const)
    changes.push({ ...access, rules: [{ ...access.rules[0], [field]: "different" }] });
  for (const changed of changes)
    assert.notEqual(permissionFingerprint(access), permissionFingerprint(changed));
  assert.equal(permissionFingerprint(null), "");
  assert.equal(permissionFingerprint(undefined), "");
});
