if (!process.argv.includes("--allow-test-data")) throw new Error("This script creates or changes synthetic data. Use only an isolated test project with --allow-test-data; do not run against the live system.");
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
const env = Object.fromEntries(
  readFileSync("web/.env.local", "utf8")
    .split(/\r?\n/)
    .filter((x) => x.includes("="))
    .map((x) => [
      x.slice(0, x.indexOf("=")),
      x.slice(x.indexOf("=") + 1).trim(),
    ]),
);
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname === "kbihklfbqhmtowcqojir.supabase.co")
  throw new Error("Synthetic-data tests are blocked on the live project. Use an isolated Supabase test project.");
const accounts = JSON.parse(readFileSync(".env.demo.json", "utf8"));
const state = JSON.parse(readFileSync(".env.demo-state.json", "utf8"));
const clients = {};
let checks = 0;
const data = async (p) => {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const check = (x, name) => {
  assert.ok(x, name);
  console.log("PASS " + name);
  checks++;
};
for (const [role, credentials] of Object.entries(accounts)) {
  const c = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  await data(c.auth.signInWithPassword(credentials));
  clients[role] = c;
}
const { admin, resident, barangay, office } = clients;
const b = await data(
  admin.from("barangays").select("id").eq("name", "Poblacion").single(),
);
const a = await data(admin.rpc("geographic_analytics", { p_barangay: b.id }));
const summary = await data(admin.rpc("barangay_summary"));
const row = summary.find((x) => x.id === b.id);
check(
  row.verified === a.counts.verified && row.unresolved === a.counts.unresolved,
  "dashboard and priority counts agree",
);
const settings = await data(
  admin.from("analytics_settings").select("*").single(),
);
check(
  Math.abs(
    Number(row.score) -
      (row.unresolved * settings.count_weight +
        row.severity_total * settings.severity_weight +
        Number(row.oldest_days) * settings.age_weight),
  ) < 0.001,
  "priority score matches transparent formula",
);
const none = await data(
  admin.rpc("map_reports", { west: -1, south: -1, east: 1, north: 1 }),
);
check(none.length === 0, "geographic viewport excludes distant reports");
const recurrent = await data(
  admin.rpc("map_reports", {
    west: 124,
    south: 8,
    east: 125,
    north: 9,
    recurring_only: true,
  }),
);
check(
  recurrent.length > 0,
  "recurrence-only map finds nearby category matches",
);
const unresolved = await data(
  admin.rpc("map_reports", {
    west: 124,
    south: 8,
    east: 125,
    north: 9,
    verified_only: true,
    unresolved_only: true,
  }),
);
check(
  unresolved.every(
    (r) =>
      r.verified_at &&
      !["resolved", "rejected", "duplicate"].includes(r.status),
  ),
  "verified unresolved map excludes terminal records",
);
check(
  (await data(office.from("audit_logs").select("id"))).length === 0,
  "office cannot inspect administrator audit log",
);
const role = await resident
  .from("profiles")
  .update({ role: "admin" })
  .eq("id", accounts.resident.id);
check(!!role.error, "column grants prevent direct role escalation");
const invalidScope = await barangay
  .from("profiles")
  .update({ barangay_id: null })
  .eq("id", accounts.barangay.id);
check(!!invalidScope.error, "staff cannot self-expand jurisdiction");
const demotion = await admin.rpc("set_role", {
  p_user: accounts.admin.id,
  p_role: "resident",
});
check(!!demotion.error, "last administrator cannot be removed");
const reapprove = await barangay
  .from("meeting_requests")
  .update({
    status: "declined",
    decision_reason: "A second decision is invalid",
  })
  .eq("id", state.request);
check(
  !!reapprove.error,
  "meeting decision cannot silently change after approval",
);
check(
  (
    await data(
      resident
        .from("meeting_participants")
        .select("organizations(name)")
        .eq("meeting_id", state.meeting),
    )
  ).length > 0,
  "resident can read participating offices",
);
const draft = await data(
  barangay
    .from("announcements")
    .insert({
      title: "[DEMO] Scheduled visibility check",
      body: "Synthetic publication test. This future notice must not appear to residents before its publication date.",
      barangay_id: b.id,
      status: "published",
      publish_at: new Date(Date.now() + 86400000).toISOString(),
    })
    .select("id")
    .single(),
);
check(
  (await data(resident.from("announcements").select("id").eq("id", draft.id)))
    .length === 0,
  "scheduled announcement stays hidden until due",
);
const emptyModeration = await barangay
  .from("consultation_comments")
  .update({ hidden: true, moderation_reason: "" })
  .eq("consultation_id", state.consultation);
check(!!emptyModeration.error, "moderation requires a meaningful reason");
const anon = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);
check(
  !!(await anon.rpc("public_report_page")).error,
  "public report RPC requires authentication",
);
const notifications = await data(
  resident
    .from("notifications")
    .select(
      "title,report_id,consultation_id,meeting_request_id,announcement_id",
    ),
);
check(
  notifications.some((n) => n.consultation_id) &&
    notifications.some((n) => n.meeting_request_id) &&
    notifications.some((n) => n.announcement_id),
  "community event notifications reach the intended resident",
);
const engagement = await data(resident.rpc("report_engagement", {p_id:state.report}));
check(engagement.followers===1&&engagement.endorsements===1,"engagement counts followers separately from defects");
check(!!(await anon.rpc("report_engagement",{p_id:state.report})).error,"anonymous callers cannot inspect report engagement");
console.log(`${checks} extended acceptance checks passed.`);
