// Read-only application data checks. Authentication creates temporary sessions only.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync("web/.env.local", "utf8").split(/\r?\n/)
  .filter(line => line.includes("=") && !line.trim().startsWith("#"))
  .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
const accounts = process.env.ILIGAN_ACCEPTANCE_ACCOUNTS_JSON
  ? JSON.parse(process.env.ILIGAN_ACCEPTANCE_ACCOUNTS_JSON)
  : Object.assign({}, ...[".env.demo.json", ".env.rbac-demo.json"].map(path => JSON.parse(readFileSync(path, "utf8"))));
const make = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const clients = {};
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
async function data(query) { const response = await query; if (response.error) throw new Error(response.error.message); return response.data; }
const ids = rows => rows.map(row => row.id).sort().join();
try {
  for (const [name, account] of Object.entries(accounts)) {
    const client = clients[name] = make();
    const login = await data(client.auth.signInWithPassword({ email: account.email, password: account.password }));
    check(!account.id || login.user.id === account.id, `${name}: account identity`);
    account.id ??= login.user.id;
  }
  const allReports = await data(clients.admin.from("reports").select("*").order("id").range(0, 999));
  const publicReports = clients.resident ? await data(clients.resident.rpc("public_reports")) : [];
  const {include_samples:includeSamples}=await data(clients.admin.from("analytics_settings").select("include_samples").single());
  const permittedSample=row=>!row.is_demo || includeSamples;
  check(allReports.every(row => permittedSample(row) && !/^\s*\[(?:DEMO|TEST|SYNTHETIC)/i.test(row.title)), "Record origins follow the configured visibility mode");
  if (clients.resident) check(publicReports.every(permittedSample), "Public reports follow the configured sample mode");
  for (const [name, client] of Object.entries(clients)) {
    const context = await data(client.rpc("staff_context"));
    const profile = context.profile;
    check(profile.id === accounts[name].id && profile.role === (accounts[name].role || name), `${name}: database-derived profile`);
    const active = profile.account_status === "active";
    const staff = context.authorized;
    const publicAccess = active && (profile.role === "resident" || staff);
    // Office reads follow category, barangay and assignment_only scope.
    const expected = allReports.filter(row => active && (profile.role === "resident" ? row.resident_id === profile.id :
      staff && (profile.role === "admin" || profile.role === "barangay" && profile.barangay_id === row.barangay_id ||
        profile.role === "office" && context.rules.some(rule => rule.enabled &&
          context.organizations.some(organization => organization.id === rule.organization_id && organization.active) &&
          rule.category_id === row.category_id && (!rule.barangay_id || rule.barangay_id === row.barangay_id) &&
          (!rule.assignment_only || rule.organization_id === row.organization_id)))));
    const reports = await data(client.from("reports").select("id,status").order("id").range(0, 999));
    check(ids(reports) === ids(expected), `${name}: exact permitted report scope`);
    const directory = await client.rpc("admin_residents", { p_offset: 0 });
    if (active && profile.role === "admin") {
      check(!directory.error && Array.isArray(directory.data.items) && directory.data.items.length <= 25,
        `${name}: bounded resident directory`);
      check(directory.data.items.every(row => typeof row.display_name === "string" && "email" in row && "account_status" in row),
        `${name}: complete authorized resident profiles`);
    } else check(directory.error?.code === "42501", `${name}: resident directory denied`);
    const probeIds = allReports.slice(0, 20).map(row => row.id);
    const residents = await client.rpc("report_residents", { p_ids: probeIds, p_contact: false });
    if (staff) {
      check(!residents.error && ids(residents.data.map(row => ({ id: row.report_id }))) === ids(expected.filter(row => probeIds.includes(row.id))),
        `${name}: reporter identities follow exact report scope`);
      check(residents.data.every(row => row.email === null && typeof row.resident_name === "string"),
        `${name}: report listings omit contact details`);
    } else check(residents.error?.code === "42501", `${name}: staff reporter projection denied`);
    const historyTarget = expected[0] || allReports[0];
    const actions = await client.rpc("report_action_history", { p_id: historyTarget.id });
    if (expected.length) check(!actions.error && actions.data.every(row => typeof row.actor_name === "string" && "old_status" in row && "action_kind" in row),
      `${name}: authorized action provenance`);
    else check(actions.error?.code === "42501", `${name}: unauthorized action history denied`);
    const dashboard = await data(client.rpc("dashboard_counts"));
    check(Number(dashboard.total) === (staff ? expected.length : 0), `${name}: dashboard agrees with stored scoped reports`);
    const analytics = await data(client.rpc("geographic_analytics"));
    check(Number(analytics.counts.total) === (staff ? expected.length : 0), `${name}: analytics agrees with stored scoped reports`);
    check(analytics.trend.reduce((total, row) => total + Number(row.received), 0) === Number(analytics.counts.total), `${name}: trend uses actual reports`);
    check(analytics.categories.reduce((total, row) => total + Number(row.received), 0) === Number(analytics.counts.total), `${name}: categories use actual reports`);
    const map = await data(client.rpc("map_reports", { west: 124, south: 8, east: 125, north: 9 }));
    const expectedMap = staff ? expected.filter(row => !["rejected", "duplicate"].includes(row.status) && row.longitude >= 124 && row.longitude <= 125 && row.latitude >= 8 && row.latitude <= 9) : [];
    check(ids(map) === ids(expectedMap), `${name}: map uses actual scoped coordinates`);
    for (const table of ["consultations", "announcements", "meeting_requests", "meetings", "notifications"]) {
      const columns = table === "meeting_requests" ? "id,title,status" : table === "notifications" ? "id,user_id" : table === "meetings" ? "id" : "id,title,status";
      const rows = await data(client.from(table).select(columns).limit(1000));
      check(rows.every(row => !row.title || !/^\s*\[(?:DEMO|TEST|SYNTHETIC)/i.test(row.title)), `${name}: ${table} contains no labelled demo content`);
      if (table === "notifications") check(rows.every(row => row.user_id === profile.id), `${name}: private notifications`);
      if (!active) check(rows.length === 0, `${name}: inactive account denied ${table}`);
    }
    const page = await data(client.rpc("public_report_page", { p_category: null, p_barangay: null, p_search: "", p_offset: 0, p_status: "all", p_recent: false }));
    check(page.every(row => permittedSample(row) && !["resident_id", "description"].some(key => key in row)), `${name}: public discovery privacy`);
    if (!publicAccess) check(page.length === 0, `${name}: ineligible account public discovery denied`);
    for (const target of [allReports[0], publicReports[0]].filter((row, index, rows) => row && rows.findIndex(other => other?.id === row.id) === index)) {
      const lookup = await data(client.rpc("public_report_by_id", { p_id: target.id }));
      const published = allReports.find(row => row.id === target.id);
      const eligible = publicAccess && (!published.is_demo || includeSamples) && published.public_visible && published.public_summary && !["rejected", "duplicate"].includes(published.status);
      check(lookup.length === (eligible ? 1 : 0), `${name}: direct public lookup respects record visibility and active account`);
      check(lookup.every(row => !["resident_id", "description", "landmark"].some(key => key in row)), `${name}: direct public lookup privacy`);
    }
    console.log(`PASS ${name}: live identity, permissions, reports, dashboard, analytics, map, community and notifications`);
  }
  const anonymous = make();
  check(!!(await anonymous.rpc("public_reports")).error, "Anonymous discovery denied");
  check(!!(await anonymous.rpc("staff_context")).error, "Anonymous staff context denied");
  check(!!(await anonymous.rpc("public_report_by_id", { p_id: allReports[0]?.id || "00000000-0000-0000-0000-000000000000" })).error,
    "Anonymous direct public lookup denied");
  console.log(`Live read-only checks passed: ${checks}; no operational records created or changed.`);
} finally {
  await Promise.all(Object.values(clients).map(client => client.auth.signOut({ scope: "local" })));
}
