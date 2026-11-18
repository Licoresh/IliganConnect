// Temporary, uniquely named uploads and draft announcement only; cleanup runs in finally.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync("web/.env.local", "utf8").split(/\r?\n/)
  .filter(line => line.includes("=") && !line.trim().startsWith("#"))
  .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
const accounts = JSON.parse(readFileSync(".env.demo.json", "utf8"));
for (const name of ["resident", "admin"]) {
  const key = `ACCEPTANCE_${name.toUpperCase()}`;
  if (process.env[`${key}_EMAIL`]) accounts[name].email = process.env[`${key}_EMAIL`];
  if (process.env[`${key}_PASSWORD`]) accounts[name].password = process.env[`${key}_PASSWORD`];
}
const make = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const resident = make(), admin = make(), anonymous = make();
const cleanup = [];
const png = process.env.ACCEPTANCE_TEST_IMAGE
  ? readFileSync(process.env.ACCEPTANCE_TEST_IMAGE)
  : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEtUAAAAASUVORK5CYII=", "base64");
let temporaryAnnouncementId = null;
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
async function upload(client, bucket, path, body = png, contentType = "image/png") {
  const response = await client.storage.from(bucket).upload(path, body, { contentType, upsert: false });
  if (!response.error) cleanup.push({ client, bucket, path });
  return response;
}
try {
  for (const [name, client] of [["resident", resident], ["admin", admin]]) {
    const account = accounts[name];
    const login = await client.auth.signInWithPassword({ email: account.email, password: account.password });
    assert.ifError(login.error);
    const path = `${login.data.user.id}/acceptance-${randomUUID()}.png`;
    assert.ifError((await upload(client, "profile-media", path)).error);
    check(true, `${name}: own profile photo upload`);
    check(!(await client.storage.from("profile-media").download(path)).error, `${name}: own private download`);
    const signed = await client.storage.from("profile-media").createSignedUrl(path, 30);
    assert.ifError(signed.error);
    check((await fetch(signed.data.signedUrl)).ok, `${name}: signed photo retrieves bytes`);
    check(!(await fetch(client.storage.from("profile-media").getPublicUrl(path).data.publicUrl)).ok, `${name}: public photo denied`);
    check(!!(await anonymous.storage.from("profile-media").createSignedUrl(path, 30)).error, `${name}: anonymous signing denied`);
    check(!!(await (name === "resident" ? admin : resident).storage.from("profile-media").download(path)).error, `${name}: cross-account download denied`);
    check(!!(await upload(client, "profile-media", path)).error, `${name}: overwrite denied`);
    for (const contentType of ["image/svg+xml", "text/html"]) {
      check(!!(await upload(client, "profile-media", `${login.data.user.id}/acceptance-${randomUUID()}`, Buffer.from("<svg />"), contentType)).error,
        `${name}: unsupported MIME rejected`);
    }
    check(!!(await upload(client, "profile-media", `${login.data.user.id}/acceptance-${randomUUID()}.png`, Buffer.alloc(5242881))).error,
      `${name}: oversized photo rejected`);
  }
  const created = await admin.from("announcements").insert({
    title: `Temporary announcement media check ${randomUUID().slice(0, 8)}`,
    body: "Temporary upload validation record. It is removed at the end of this check.",
    kind: "Acceptance check",
    status: "draft",
  }).select("id").single();
  assert.ifError(created.error);
  temporaryAnnouncementId = created.data.id;
  console.log(`Temporary announcement fixture: ${temporaryAnnouncementId}`);
  const announcementImage = `${temporaryAnnouncementId}/acceptance-${randomUUID()}.png`;
  assert.ifError((await upload(admin, "announcement-media", announcementImage)).error);
  const attach = await admin.from("announcements").update({ attachment_path: announcementImage })
    .eq("id", temporaryAnnouncementId).select("id").single();
  assert.ifError(attach.error);
  check(true, "staff: upload and attach an announcement image");
  check(!(await admin.storage.from("announcement-media").download(announcementImage)).error,
    "staff: private announcement image is readable in scope");
  const announcementSigned = await admin.storage.from("announcement-media").createSignedUrl(announcementImage, 30);
  assert.ifError(announcementSigned.error);
  check((await fetch(announcementSigned.data.signedUrl)).ok, "staff: announcement image signed URL returns image bytes");
  check(!!(await resident.storage.from("announcement-media").download(announcementImage)).error,
    "resident: unpublished announcement media is not visible");
  const missingReport = `${accounts.resident.id}/${randomUUID()}/acceptance-${randomUUID()}.png`;
  check(!!(await upload(resident, "report-evidence", missingReport)).error, "Evidence requires an accessible real report");
  check(!!(await upload(resident, "announcement-media", `${randomUUID()}/acceptance-${randomUUID()}.png`)).error,
    "Residents cannot upload announcement media");
  check(!!(await upload(anonymous, "profile-media", `${accounts.resident.id}/acceptance-${randomUUID()}.png`)).error,
    "Anonymous upload denied");
  console.log(`Live temporary-storage checks passed: ${checks}.`);
} finally {
  let failed = false;
  for (const { client, bucket, path } of cleanup) {
    const removed = await client.storage.from(bucket).remove([path]);
    const slash = path.lastIndexOf("/");
    const remaining = await client.storage.from(bucket).list(path.slice(0, slash), { search: path.slice(slash + 1) });
    if (removed.error || remaining.error || remaining.data.some(row => row.name === path.slice(slash + 1))) failed = true;
  }
  if (temporaryAnnouncementId) {
    const removed = await admin.from("announcements").delete().eq("id", temporaryAnnouncementId).select("id");
    if (removed.error || removed.data?.length !== 1) failed = true;
    const remaining = await admin.from("announcements").select("id").eq("id", temporaryAnnouncementId).maybeSingle();
    if (remaining.error || remaining.data) failed = true;
  }
  await Promise.all([resident, admin].map(client => client.auth.signOut({ scope: "local" })));
  assert.ok(!failed, "Temporary uploads must all be removed");
  console.log(`Verified removal of ${cleanup.length} temporary storage objects and the temporary announcement fixture.`);
}
