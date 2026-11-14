import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

// Read-only by default. --mark-read also tests synthetic notification updates,
// restoring their original unread state even when an assertion fails.
const testReadActions = process.argv.includes("--mark-read");
const testReportFilters = process.argv.includes("--reports");
const env = Object.fromEntries(readFileSync("web/.env.local", "utf8")
  .split(/\r?\n/).filter((line) => line.includes("="))
  .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
if (testReadActions && new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname === "kbihklfbqhmtowcqojir.supabase.co")
  throw new Error("Notification mutation tests are blocked on the live project. Run read-only checks or use an isolated test project.");
const accounts = {
  ...JSON.parse(readFileSync(".env.demo.json", "utf8")),
  ...JSON.parse(readFileSync(".env.rbac-demo.json", "utf8")),
};
async function response(query) {
  const value = await query;
  if (value.error) throw new Error(value.error.message);
  return value;
}
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}
let adminId;
for (const name of ["admin", "barangay", "cenro", "resident"]) {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await response(client.auth.signInWithPassword(accounts[name]));
  const userId = auth.user.id;
  if (name === "admin") adminId = userId;
  try {
    for (const unreadOnly of [false, true]) {
      const rows = [];
      let count;
      for (let page = 0; page === 0 || rows.length < count; page++) {
        let query = client.from("notifications")
          .select("id,user_id,title,read_at,created_at,report_id,consultation_id,meeting_request_id,announcement_id", { count: "exact" })
          .eq("user_id", userId).order("created_at", { ascending: false })
          .order("id", { ascending: false }).range(page * 30, page * 30 + 29);
        if (unreadOnly) query = query.is("read_at", null);
        const result = await response(query);
        count ??= result.count;
        check(result.count === count, `${name}: stable pagination count`);
        check(result.data.length > 0 || rows.length === count, `${name}: no premature empty page`);
        rows.push(...result.data);
      }
      check(rows.length === count, `${name}: exact page coverage`);
      check(new Set(rows.map((row) => row.id)).size === count, `${name}: no duplicate page records`);
      check(rows.every((row) => row.user_id === userId && (!unreadOnly || !row.read_at)), `${name}: private unread filter`);
      if (unreadOnly) {
        const result = await response(client.from("notifications").select("id", { count: "exact", head: true })
          .eq("user_id", userId).is("read_at", null));
        check(result.count === count, `${name}: badge counts all unread pages`);
      }
    }
    if (name !== "admin") {
      const result = await response(client.from("notifications").select("id", { count: "exact" }).eq("user_id", adminId));
      check(result.count === 0 && result.data.length === 0, `${name}: another account's notifications are denied`);
    }
    if (testReadActions) {
      const now = new Date().toISOString();
      const { data: original } = await response(client.from("notifications").select("id")
        .eq("user_id", userId).is("read_at", null).lte("created_at", now));
      const ids = original.map((row) => row.id);
      try {
        if (name !== "admin") {
          const { data: changed } = await response(client.from("notifications").update({ read_at: now })
            .eq("user_id", adminId).select("id"));
          check(changed.length === 0, `${name}: cannot mark another account's updates as read`);
        }
        if (ids.length) {
          const { data: single } = await response(client.from("notifications").update({ read_at: now })
            .eq("user_id", userId).is("read_at", null).eq("id", ids[0]).select("id,read_at"));
          check(single.length === 1 && Date.parse(single[0].read_at) === Date.parse(now), `${name}: open marks one notification as read`);
          const { data: repeated } = await response(client.from("notifications").update({ read_at: new Date().toISOString() })
            .eq("user_id", userId).is("read_at", null).eq("id", ids[0]).select("id"));
          check(repeated.length === 0, `${name}: reopening preserves the first read time`);
          const { data: bulk } = await response(client.from("notifications").update({ read_at: now })
            .eq("user_id", userId).is("read_at", null).lte("created_at", now).select("id"));
          check(bulk.length === ids.length - 1 && bulk.every((row) => ids.includes(row.id)), `${name}: bulk action updates remaining own unread records`);
          const unread = await response(client.from("notifications").select("id", { count: "exact", head: true })
            .eq("user_id", userId).is("read_at", null).lte("created_at", now));
          check(unread.count === 0, `${name}: bulk action clears older unread count`);
        } else {
          console.log(`SKIP ${name}: no unread fixtures for read actions`);
        }
      } finally {
        if (ids.length) {
          await response(client.from("notifications").update({ read_at: null })
            .eq("user_id", userId).in("id", ids).eq("read_at", now));
          const restored = await response(client.from("notifications").select("id", { count: "exact", head: true })
            .eq("user_id", userId).in("id", ids).is("read_at", null));
          check(restored.count === ids.length, `${name}: original unread state restored`);
        }
      }
    }
    if (testReportFilters) {
      const { data: visible, count } = await response(client.from("reports").select("*", { count: "exact" })
        .order("created_at", { ascending: false }).order("id").limit(1000));
      check(visible.length === count, `${name}: complete small demonstration dataset`);
      for (const [queue, states] of [["review", ["submitted", "under_review"]], ["active", ["assigned", "scheduled", "in_progress"]], ["resolved", ["resolved"]]]) {
        const { data: rows, count: total } = await response(client.from("reports").select("id,status", { count: "exact" })
          .in("status", states).order("created_at", { ascending: false }).order("id").range(0, 19));
        check(total === visible.filter((r) => states.includes(r.status)).length, `${name}: ${queue} count respects permissions`);
        check(rows.every((r) => states.includes(r.status) && visible.some((v) => v.id === r.id)), `${name}: ${queue} rows respect permissions`);
      }
      for (const sort of ["oldest", "newest", "severity"]) {
        let query = client.from("reports").select("id,created_at,severity");
        if (sort === "severity") query = query.order("severity", { ascending: false, nullsFirst: false });
        const { data: rows } = await response(query.order("created_at", { ascending: sort === "oldest" }).order("id").range(0, 19));
        const expected = [...visible].sort((a, b) => {
          if (sort === "severity" && a.severity !== b.severity) return (b.severity ?? -1) - (a.severity ?? -1);
          const dates = Date.parse(a.created_at) - Date.parse(b.created_at);
          return (sort === "oldest" ? dates : -dates) || a.id.localeCompare(b.id);
        }).slice(0, 20);
        check(rows.map((r) => r.id).join() === expected.map((r) => r.id).join(), `${name}: ${sort} ordering`);
      }
      if (visible.length) {
        const first = visible[0];
        const { data: exact } = await response(client.from("reports").select("id").eq("id", first.id));
        check(exact.length === 1 && exact[0].id === first.id, `${name}: full report ID lookup`);
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(first.created_at));
        const start = new Date(day + "T00:00:00+08:00").toISOString();
        const end = new Date(Date.parse(start) + 86400000).toISOString();
        const { data: rows } = await response(client.from("reports").select("id,created_at,category_id,barangay_id")
          .eq("category_id", first.category_id).eq("barangay_id", first.barangay_id).gte("created_at", start).lt("created_at", end));
        const expected = visible.filter((r) => r.category_id === first.category_id && r.barangay_id === first.barangay_id && Date.parse(r.created_at) >= Date.parse(start) && Date.parse(r.created_at) < Date.parse(end));
        check(rows.length === expected.length && rows.every((r) => expected.some((e) => e.id === r.id)), `${name}: combined category, barangay and Philippine date filter`);
        const assigned = visible.find((r) => r.organization_id);
        if (assigned) {
          const { data: rows } = await response(client.from("reports").select("id,organization_id").eq("organization_id", assigned.organization_id));
          check(rows.length === visible.filter((r) => r.organization_id === assigned.organization_id).length && rows.every((r) => r.organization_id === assigned.organization_id), `${name}: assigned office filter`);
        }
      }
    }
    for (const table of ["consultations", "meeting_requests", "announcements"]) {
      const columns = table === "meeting_requests"
        ? "id,title,body,status,barangay_id,decision_reason,consultation_id,category_id,report_id,created_at" : "*";
      const { data: rows } = await response(client.from(table).select(columns).limit(1));
      if (!rows.length) continue;
      const { data: record } = await response(client.from(table).select(columns).eq("id", rows[0].id).maybeSingle());
      check(record?.id === rows[0].id && record.status === rows[0].status, `${name}: current ${table} detail`);
      const { data: permission } = await response(client.rpc("community_permissions", { p_table: table, p_id: record.id }));
      check(typeof permission === "boolean", `${name}: current ${table} management permission`);
    }
    console.log(`PASS ${name}: notification history, unread count, private scope and community details`);
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}
console.log(`Navigation checks passed: ${checks}`);
