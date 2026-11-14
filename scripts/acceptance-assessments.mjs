// Read-only live checks: all RPC probes must reject before changing a report.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync("web/.env.local", "utf8").split(/\r?\n/)
  .filter(line => line.includes("=") && !line.trim().startsWith("#"))
  .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
const accounts = JSON.parse(readFileSync(".env.demo.json", "utf8"));
const make = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const clients = {};
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
async function data(query) { const response = await query; if (response.error) throw new Error(response.error.message); return response.data; }
try {
  for (const role of ["admin", "resident", "barangay"]) {
    const account = accounts[role], client = clients[role] = make();
    const login = await data(client.auth.signInWithPassword({ email: account.email, password: account.password }));
    check(login.user.id === account.id, `${role}: authenticated identity`);
  }
  const snapshot = () => data(clients.admin.from("reports").select("*").order("id"));
  const history = () => data(clients.admin.from("report_assessments").select("*").order("id"));
  const before = await snapshot(), beforeHistory = await history();
  check(before.length > 0 && before.every(row => "urgency" in row), "Urgency column is available through REST");
  const target = before.find(row => row.status === "under_review");
  assert.ok(target, "An existing under-review report is required for rejection-only probes");
  const valid = { p_id: target.id, p_severity: 3, p_urgency: 3, p_note: "Rejection-only validation probe; no assessment should be recorded." };
  for (const input of [{ p_severity: 0 }, { p_severity: 6 }, { p_urgency: 0 }, { p_urgency: 6 },
    { p_severity: null }, { p_urgency: null }, { p_note: "abcd" }, { p_note: "\u200b".repeat(10) }, { p_note: "x".repeat(4001) }]) {
    const response = await clients.admin.rpc("record_report_assessment", { ...valid, ...input });
    check(response.error?.code === "23514", "Invalid rating or rationale is rejected through the exposed RPC");
  }
  const fractional = await clients.admin.rpc("record_report_assessment", { ...valid, p_urgency: 2.5 });
  check(fractional.error?.code === "22P02", "REST rejects fractional integer ratings");
  const resident = await clients.resident.rpc("record_report_assessment", valid);
  check(resident.error?.code === "42501", "Residents cannot record official ratings");
  check((await data(clients.resident.from("report_assessments").select("id"))).length === 0, "Residents cannot read private assessment history");
  await data(clients.barangay.from("report_assessments").select("id").limit(1));
  check(true, "Staff can query the RLS-protected history endpoint");
  const verification = await clients.admin.rpc("change_report", { p_id: target.id, p_status: "verified", p_note: valid.p_note, p_severity: 3 });
  check(verification.error?.code === "23514", "Verification cannot omit urgency");
  const anonymous = make();
  check((await anonymous.rpc("record_report_assessment", valid)).error?.code === "42501", "Anonymous assessment execution is denied");
  assert.deepEqual(await snapshot(), before);
  check(true, "All report fields remain unchanged after API probes");
  assert.deepEqual(await history(), beforeHistory);
  check(true, "No assessment event was created by API probes");
  console.log(`Live assessment checks passed: ${checks}; no operational records created or changed.`);
} finally {
  await Promise.all(Object.values(clients).map(client => client.auth.signOut({ scope: "local" })));
}
