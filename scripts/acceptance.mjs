if (!process.argv.includes("--allow-test-data")) throw new Error("This script creates or changes synthetic data. Use only an isolated test project with --allow-test-data; do not run against the live system.");
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const clients = {};
let checks = 0;
const ok = (condition, label) => {
  assert.ok(condition, label);
  console.log("PASS " + label);
  checks++;
};
const data = async (p) => {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
for (const [role, account] of Object.entries(accounts)) {
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  await data(client.auth.signInWithPassword(account));
  clients[role] = client;
  ok(true, role + " authentication");
}
const { resident, barangay, office, admin } = clients;
const b = await data(
  admin.from("barangays").select("id").eq("name", "Poblacion").single(),
);
const c = (
  await data(
    admin.from("report_categories").select("id").eq("active", true).limit(1),
  )
)[0];
const membership = await data(
  office
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", accounts.office.id)
    .limit(1)
    .single(),
);
const org = { id: membership.organization_id };
const id = randomUUID();
const problem = await data(resident.from("report_problem_types").select("code").eq("category_id", c.id).order("sort_order").limit(1).single());
const payload = {
  p_problem_type: problem.code,
  p_id: id,
  p_category: c.id,
  p_barangay: b.id,
  p_title: "[DEMO] Acceptance road concern",
  p_description:
    "Synthetic demonstration record for exercising the complete reporting workflow. No actual local defect is alleged.",
  p_latitude: 8.22915,
  p_longitude: 124.2376,
  p_landmark: "Synthetic demonstration location",
};
assert.equal(await data(resident.rpc("submit_report", payload)), id);
assert.equal(await data(resident.rpc("submit_report", payload)), id);
ok(
  (await data(resident.from("reports").select("id").eq("id", id))).length === 1,
  "submission retry creates one report",
);
const elevate = await resident.rpc("set_role", {
  p_user: accounts.resident.id,
  p_role: "admin",
});
ok(!!elevate.error, "resident cannot grant roles");
ok(
  (await data(office.from("reports").select("id").eq("id", id))).length === 0,
  "unassigned office cannot read report",
);
const act = async (status, extra = {}) =>
  data(
    barangay.rpc("change_report", {
      p_id: id,
      p_status: status,
      p_note: "[DEMO] Authorized acceptance action",
      ...extra,
    }),
  );
await act("under_review");
await act("verified", {
  p_severity: 2,
  p_urgency: 2,
  p_public_summary: "[DEMO] Moderated public road concern",
});
const publicRows = await data(
  resident.rpc("public_report_page", {
    p_search: "Moderated public road concern",
  }),
);
ok(
  publicRows.some(
    (r) => r.id === id && !("resident_id" in r) && !("description" in r),
  ),
  "public projection omits private identity and narrative",
);
await data(
  resident
    .from("report_followers")
    .insert({ report_id: id, endorsement: true }),
);
ok(
  !!(await resident.from("report_followers").insert({ report_id: id })).error,
  "duplicate follows prevented",
);
await data(
  barangay.from("report_internal_notes").insert({
    report_id: id,
    body: "[DEMO] Internal assessment should never reach residents.",
  }),
);
ok(
  (
    await data(
      resident.from("report_internal_notes").select("*").eq("report_id", id),
    )
  ).length === 0,
  "internal notes hidden from residents",
);
await act("assigned", { p_organization: org.id });
ok(
  (await data(office.from("reports").select("id").eq("id", id))).length === 1,
  "assigned office receives scoped access",
);
await data(
  office.rpc("change_report", {
    p_id: id,
    p_status: "scheduled",
    p_note: "[DEMO] Office inspection scheduled",
    p_scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }),
);
await data(
  office.rpc("change_report", {
    p_id: id,
    p_status: "in_progress",
    p_note: "[DEMO] Office work in progress",
  }),
);
await data(
  office.rpc("change_report", {
    p_id: id,
    p_status: "resolved",
    p_note: "[DEMO] Demonstration issue resolved",
  }),
);
ok(
  (
    await data(
      resident
        .from("report_status_history")
        .select("new_status,public_note")
        .eq("report_id", id),
    )
  ).length === 5,
  "resident sees complete public status timeline",
);
ok(
  !!(
    await resident
      .from("report_status_history")
      .select("actor_id")
      .eq("report_id", id)
  ).error,
  "actor identities protected by column privileges",
);
const path = `${accounts.resident.id}/${id}/${randomUUID()}.png`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN/0AAAAASUVORK5CYII=",
  "base64",
);
await data(
  resident.storage
    .from("report-evidence")
    .upload(path, png, { contentType: "image/png" }),
);
await data(resident.from("report_attachments").insert({ report_id: id, path }));
ok(
  !!(
    await data(office.storage.from("report-evidence").createSignedUrl(path, 60))
  ).signedUrl,
  "assigned office can access protected evidence",
);
const consultation = await data(
  barangay
    .from("consultations")
    .insert({
      title: "[DEMO] Community road consultation",
      body: "Synthetic consultation for demonstrating respectful public participation and documented official responses.",
      barangay_id: b.id,
      report_id: id,
      status: "open",
    })
    .select("id")
    .single(),
);
await data(
  resident
    .from("consultation_followers")
    .insert({ consultation_id: consultation.id }),
);
const comment = await data(
  resident
    .from("consultation_comments")
    .insert({
      consultation_id: consultation.id,
      body: "[DEMO] Please consider a community discussion.",
      official: true,
    })
    .select("id,official")
    .single(),
);
ok(!comment.official, "resident cannot impersonate official response");
const reply = await data(
  barangay
    .from("consultation_comments")
    .insert({
      consultation_id: consultation.id,
      body: "[DEMO] Thank you. This will be considered during assessment.",
      parent_id: comment.id,
    })
    .select("id,official")
    .single(),
);
ok(reply.official, "authorized staff reply has verified badge");
await data(
  resident.from("comment_flags").insert({
    comment_id: comment.id,
    reason: "[DEMO] Moderation acceptance check",
  }),
);
ok(
  (
    await data(
      barangay
        .from("comment_flags")
        .select("reason")
        .eq("comment_id", comment.id),
    )
  ).length === 1,
  "staff can review flagged comments",
);
await data(
  barangay
    .from("consultation_comments")
    .update({
      hidden: true,
      moderation_reason: "[DEMO] Content hidden for acceptance check",
    })
    .eq("id", comment.id),
);
ok(
  (
    await data(
      resident
        .from("consultation_comments")
        .select("id,body")
        .eq("id", comment.id),
    )
  ).length === 0,
  "moderated comment hidden from resident",
);
await data(
  barangay
    .from("consultation_comments")
    .update({
      hidden: false,
      moderation_reason: "[DEMO] Restored after review",
    })
    .eq("id", comment.id),
);
const request = await data(
  resident
    .from("meeting_requests")
    .insert({
      barangay_id: b.id,
      title: "[DEMO] Road coordination meeting",
      body: "Synthetic meeting request to demonstrate approval, scheduling, participating offices and follow-up.",
      category_id: c.id,
      report_id: id,
      consultation_id: consultation.id,
    })
    .select("id,status")
    .single(),
);
await data(
  resident.from("meeting_supporters").insert({ request_id: request.id }),
);
const unauthorized = await resident
  .from("meeting_requests")
  .update({
    status: "approved",
    decision_reason: "Unauthorized approval attempt",
  })
  .eq("id", request.id)
  .select("id");
ok(
  !!unauthorized.error || unauthorized.data.length === 0,
  "resident cannot approve meeting",
);
await data(
  barangay
    .from("meeting_requests")
    .update({
      status: "approved",
      decision_reason: "[DEMO] Approved for a synthetic coordination session.",
    })
    .eq("id", request.id),
);
const meeting = await data(
  barangay
    .from("meetings")
    .insert({
      request_id: request.id,
      venue: "[DEMO] University demonstration room",
      starts_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    })
    .select("id")
    .single(),
);
await data(
  barangay
    .from("meeting_participants")
    .insert({ meeting_id: meeting.id, organization_id: org.id }),
);
const action = await data(
  barangay
    .from("meeting_action_items")
    .insert({
      meeting_id: meeting.id,
      organization_id: org.id,
      description: "[DEMO] Record site assessment findings.",
    })
    .select("id")
    .single(),
);
await data(
  barangay
    .from("meeting_action_items")
    .update({ completed: true })
    .eq("id", action.id),
);
ok(
  (
    await data(
      resident
        .from("meeting_action_items")
        .select("completed")
        .eq("id", action.id)
        .single(),
    )
  ).completed,
  "resident sees meeting follow-up completion",
);
const announcement = await data(
  barangay
    .from("announcements")
    .insert({
      barangay_id: b.id,
      title: "[DEMO] Community coordination notice",
      body: "Synthetic announcement. This is an application demonstration and does not announce an actual public meeting.",
      status: "published",
      kind: "Meeting schedule",
    })
    .select("id")
    .single(),
);
const residentProfile = await data(resident.from("profiles").select("id,barangay_id").single());
try {
  // Demo users may change their home barangay while testing the app.
  await data(resident.from("profiles").update({ barangay_id: b.id }).eq("id", residentProfile.id));
  ok((await data(resident.from("announcements").select("id").eq("id", announcement.id))).length === 1,
    "barangay announcement reaches matching resident");
} finally {
  await data(resident.from("profiles").update({ barangay_id: residentProfile.barangay_id }).eq("id", residentProfile.id));
}
const analytics = await data(
  admin.rpc("geographic_analytics", { p_barangay: b.id }),
);
ok(
  analytics.counts.resolved >= 1 && analytics.categories.length === 6,
  "geographic aggregation uses stored reports",
);
const map = await data(
  admin.rpc("map_reports", {
    west: 124,
    south: 8,
    east: 125,
    north: 9,
    barangay: b.id,
  }),
);
ok(
  map.some((r) => r.id === id),
  "geographic viewport contains report",
);
ok(
  (await data(resident.from("notifications").select("id").is("read_at", null)))
    .length > 0,
  "report and community notifications persisted",
);
writeFileSync(
  ".env.demo-state.json",
  JSON.stringify(
    {
      report: id,
      consultation: consultation.id,
      request: request.id,
      meeting: meeting.id,
      announcement: announcement.id,
    },
    null,
    2,
  ),
);
console.log(
  `${checks} live acceptance checks passed. All created content is labelled DEMO.`,
);
