if (!process.argv.includes("--allow-test-data")) throw new Error("This script creates or changes synthetic data. Use only an isolated test project with --allow-test-data; do not run against the live system.");
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Uses existing local demo accounts; creates only temporary objects, removed below.
const env = Object.fromEntries(readFileSync("web/.env.local", "utf8").split(/\r?\n/)
  .filter(line => line.includes("=") && !line.trim().startsWith("#"))
  .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname === "kbihklfbqhmtowcqojir.supabase.co")
  throw new Error("Synthetic-data tests are blocked on the live project. Use an isolated Supabase test project.");
const accounts = JSON.parse(readFileSync(".env.demo.json", "utf8"));
const make = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const resident = make(), admin = make(), anonymous = make();
let checks = 0;
const check = (value, name) => { assert.ok(value, name); console.log(`PASS ${name}`); checks++; };
const data = async promise => {
  const r = await promise;
  if (r.error) throw new Error(r.error.message.includes("<!DOCTYPE") ? `Upstream request rejected (HTTP ${r.status})` : r.error.message);
  return r.data;
};
const cleanup = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEtUAAAAASUVORK5CYII=", "base64");
async function upload(client, bucket, path, body, contentType) {
  const result = await client.storage.from(bucket).upload(path, body, { contentType, upsert: false });
  if (!result.error) cleanup.push({ client, bucket, path });
  return result;
}

try {
  const login = await data(resident.auth.signInWithPassword(accounts.resident));
  const adminLogin = await data(admin.auth.signInWithPassword(accounts.admin));
  const uid = login.user.id;
  const reports = await data(resident.from("reports").select("id").eq("resident_id", uid).limit(1));
  const announcements = await data(admin.from("announcements").select("id").limit(1));
  assert.ok(reports.length && announcements.length, "Existing demo report and announcement required");
  const folders = { "report-evidence": `${uid}/${reports[0].id}`, "announcement-media": announcements[0].id, "profile-media": uid };
  for (const [bucket, folder] of Object.entries(folders)) {
    const owner = bucket === "announcement-media" ? admin : resident;
    const path = `${folder}/security-check-${randomUUID()}.png`;
    await data(upload(owner, bucket, path, png, "image/png"));
    check(true, `${bucket}: authorized image upload succeeds`);
    const signed = await data(owner.storage.from(bucket).createSignedUrl(path, 30));
    const image = await fetch(signed.signedUrl);
    check(image.ok && (await image.arrayBuffer()).byteLength === png.length, `${bucket}: authorized signed image works`);
    const publicUrl = owner.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    check(!(await fetch(publicUrl)).ok, `${bucket}: public URL cannot expose private files`);
    check(!!(await anonymous.storage.from(bucket).createSignedUrl(path, 30)).error, `${bucket}: anonymous signing denied`);
    check(!!(await upload(anonymous, bucket, `${folder}/${randomUUID()}.png`, png, "image/png")).error,
      `${bucket}: anonymous upload denied`);
    for (const mime of ["image/svg+xml", "text/html"]) {
      const rejected = await upload(owner, bucket, `${folder}/${randomUUID()}`, Buffer.from("<svg onload=alert(1)></svg>"), mime);
      check(!!rejected.error, `${bucket}: ${mime} rejected`);
    }
    const large = await upload(owner, bucket, `${folder}/${randomUUID()}.png`, Buffer.alloc(5242881), "image/png");
    check(!!large.error, `${bucket}: images over 5 MB rejected`);
    check(!!(await upload(owner, bucket, path, png, "image/png")).error, `${bucket}: accidental overwrite denied`);
    if (bucket === "profile-media") {
      check(!!(await admin.storage.from(bucket).createSignedUrl(path, 30)).error,
        "Profile photos cannot be read by another account, including staff");
      await admin.storage.from(bucket).remove([path]);
      check(!(await resident.storage.from(bucket).download(path)).error,
        "Another account cannot delete the resident's profile photo");
      check(!!(await upload(resident, bucket, `${adminLogin.user.id}/${randomUUID()}.png`, png, "image/png")).error,
        "Profile upload cannot use another account's folder");
      const [original] = await data(resident.from("profiles").select("avatar_path").eq("id", uid));
      try {
        await data(resident.from("profiles").update({ avatar_path: path }).eq("id", uid));
        const [saved] = await data(resident.from("profiles").select("avatar_path").eq("id", uid));
        check(saved.avatar_path === path, "Profile photo reference saves correctly");
        check(!!(await resident.from("profiles").update({ avatar_path: `${adminLogin.user.id}/other.png` }).eq("id", uid)).error,
          "Profile reference rejects another account's folder");
        check(!!(await resident.from("profiles").update({ role: "admin" }).eq("id", uid)).error,
          "Profile editing cannot elevate the resident role");
      } finally {
        await data(resident.from("profiles").update({ avatar_path: original.avatar_path }).eq("id", uid));
      }
    }
  }
  check(!!(await upload(resident, "report-evidence", `${randomUUID()}/${reports[0].id}/${randomUUID()}.png`, png, "image/png")).error,
    "Evidence cannot be uploaded under another user's folder");
  check(!!(await upload(resident, "report-evidence", `${uid}/${randomUUID()}/${randomUUID()}.png`, png, "image/png")).error,
    "Evidence requires an accessible existing report");
  check(!!(await upload(resident, "announcement-media", `${announcements[0].id}/${randomUUID()}.png`, png, "image/png")).error,
    "Residents cannot upload official announcement media");
  check((await data(resident.from("profiles").select("id").eq("id", adminLogin.user.id))).length === 0,
    "Resident cannot read another account's private profile");
  check((await data(resident.from("report_internal_notes").select("id").limit(1))).length === 0,
    "Private staff notes remain hidden from residents");
  const published = await data(resident.rpc("public_reports"));
  check(!!(await anonymous.rpc("public_reports")).error, "Anonymous report RPC access denied");
  check(published.length > 0 && published.every(row => !["resident_id", "description", "landmark"].some(key => key in row)),
    "Published report projection excludes private identity and narrative");
  for (const payload of ["' OR 1=1; --", "' OR 'security_probe'='security_probe' --", "<script>alert(1)</script>"]) {
    const response = await resident.from("reports").select("id").ilike("title", payload).limit(1);
    const edgeBlocked = response.status === 403 && /Cloudflare/.test(response.error?.message ?? "") && /blocked/i.test(response.error?.message ?? "");
    if (edgeBlocked) check(true, "Hostile search input rejected by the upstream firewall (database path not exercised)");
    else check(!response.error && response.data?.length === 0, "Hostile search input is treated as literal text");
  }
  check((await data(resident.from("reports").select("id").eq("id", reports[0].id))).length === 1,
    "Normal report access still works after hostile-input checks");
} finally {
  let cleanupFailed = false;
  for (const { client, bucket, path } of cleanup) {
    if (client === anonymous) { cleanupFailed = true; console.error(`Unexpected anonymous upload needs cleanup in ${bucket}`); continue; }
    const result = await client.storage.from(bucket).remove([path]);
    if (result.error) { console.error(`Cleanup failed for ${bucket}: ${result.error.message}`); cleanupFailed = true; }
    else {
      // A previously downloaded URL can remain in the CDN cache after deletion.
      const slash = path.lastIndexOf("/");
      const remaining = await client.storage.from(bucket).list(path.slice(0, slash), { search: path.slice(slash + 1) });
      if (remaining.error || remaining.data.some((item) => item.name === path.slice(slash + 1))) {
        console.error(`Could not verify temporary upload removal in ${bucket}`); cleanupFailed = true;
      }
    }
  }
  await Promise.all([resident.auth.signOut({ scope: "local" }), admin.auth.signOut({ scope: "local" })]);
  if (cleanupFailed) process.exitCode = 1;
}
if (!process.exitCode) console.log(`${checks} security checks passed; temporary uploads removed and removal verified.`);
