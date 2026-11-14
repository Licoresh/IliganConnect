// Root creates exact private QA fixtures and deletes their rows after this run.
// This harness only attaches files to validated UUID/tag-scoped fixtures.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync("web/.env.local", "utf8").split(/\r?\n/)
  .filter(line => line.includes("=") && !line.trim().startsWith("#"))
  .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
const accounts = JSON.parse(readFileSync(".env.demo.json", "utf8"));
const fixture = JSON.parse(readFileSync(".env.qa-files.json", "utf8"));
assert.match(fixture.tag, /^(?:[0-9a-f]{12}|[0-9a-f-]{36})$/i, "Valid fixture tag required");
for (const field of ["report", "announcement"]) assert.match(fixture[field], /^[0-9a-f-]{36}$/i, `Valid fixture ${field} required`);
const make = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const resident = make(), admin = make(), anonymous = make();
const cleanup = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEtUAAAAASUVORK5CYII=", "base64");
let checks = 0;
let fixturesVerified = false;
function check(value, label) { assert.ok(value, label); checks++; }
async function data(query) { const response = await query; assert.ifError(response.error); return response.data; }
try {
  for (const [name, client] of [["resident", resident], ["admin", admin]]) {
    await data(client.auth.signInWithPassword({ email: accounts[name].email, password: accounts[name].password }));
  }
  const report = await data(resident.from("reports").select("id,resident_id,title,status,public_visible").eq("id", fixture.report).single());
  const announcement = await data(admin.from("announcements").select("id,created_by,title,status,attachment_path").eq("id", fixture.announcement).single());
  assert.equal(report.title, `[QA TEMP ${fixture.tag}] Report evidence`);
  assert.equal(report.resident_id, accounts.resident.id);
  assert.equal(report.status, "submitted");
  assert.equal(report.public_visible, false);
  assert.equal(announcement.title, `[QA TEMP ${fixture.tag}] Announcement media`);
  assert.equal(announcement.created_by, accounts.admin.id);
  assert.equal(announcement.status, "draft");
  assert.equal(announcement.attachment_path, null);
  fixturesVerified = true;
  for (const [owner, bucket, path] of [
    [resident, "report-evidence", `${accounts.resident.id}/${fixture.report}/acceptance-${randomUUID()}.png`],
    [admin, "announcement-media", `${fixture.announcement}/acceptance-${randomUUID()}.png`],
  ]) {
    await data(owner.storage.from(bucket).upload(path, png, { contentType: "image/png", upsert: false }));
    cleanup.push({ owner, bucket, path });
    check(true, `${bucket}: scoped upload`);
    const signed = await data(owner.storage.from(bucket).createSignedUrl(path, 30));
    check((await fetch(signed.signedUrl)).ok, `${bucket}: signed image bytes`);
    check(!!(await anonymous.storage.from(bucket).download(path)).error, `${bucket}: anonymous access denied`);
    check(!(await fetch(owner.storage.from(bucket).getPublicUrl(path).data.publicUrl)).ok, `${bucket}: public access denied`);
    if (bucket === "report-evidence") {
      const saved = await data(resident.from("report_attachments").insert({ report_id: fixture.report, path }).select("id,path").single());
      check(saved.path === path, "Resident evidence attachment persisted");
      const officeView = await data(admin.from("report_attachments").select("id,path").eq("id", saved.id).single());
      check(officeView.path === path, "Administrator sees connected evidence attachment");
      check(!(await admin.storage.from(bucket).download(path)).error, "Authorized administrator retrieves resident evidence");
    } else {
      const saved = await data(admin.from("announcements").update({ attachment_path: path }).eq("id", fixture.announcement).select("attachment_path").single());
      check(saved.attachment_path === path, "Announcement media path persisted");
      check(!!(await resident.storage.from(bucket).createSignedUrl(path, 30)).error, "Draft announcement media denied to resident");
      check((await data(resident.from("announcements").select("id").eq("id", fixture.announcement))).length === 0, "Draft announcement hidden from resident");
    }
  }
  console.log(`Connected evidence/announcement storage checks passed: ${checks}.`);
} finally {
  let failed = false;
  if (fixturesVerified) {
    const detached = await admin.from("announcements").update({ attachment_path: null }).eq("id", fixture.announcement);
    if (detached.error) failed = true;
  }
  for (const { owner, bucket, path } of cleanup) {
    const removed = await owner.storage.from(bucket).remove([path]);
    const slash = path.lastIndexOf("/");
    const remaining = await owner.storage.from(bucket).list(path.slice(0, slash), { search: path.slice(slash + 1) });
    if (removed.error || remaining.error || remaining.data.some(row => row.name === path.slice(slash + 1))) failed = true;
  }
  await Promise.all([resident, admin].map(client => client.auth.signOut({ scope: "local" })));
  assert.ok(!failed, "All temporary files must be detached and removed");
  console.log(`Verified removal of ${cleanup.length} temporary connected storage objects; root must remove exact QA fixture rows.`);
}
