if (!process.argv.includes("--allow-test-data")) throw new Error("This script creates or changes synthetic data. Use only an isolated test project with --allow-test-data; do not run against the live system.");
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  readFileSync("web/.env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [
      l.slice(0, l.indexOf("=")),
      l.slice(l.indexOf("=") + 1).trim(),
    ]),
);
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname === "kbihklfbqhmtowcqojir.supabase.co")
  throw new Error("Synthetic-data tests are blocked on the live project. Use an isolated Supabase test project.");
const accounts = {
  ...JSON.parse(readFileSync(".env.demo.json", "utf8")),
  ...JSON.parse(readFileSync(".env.rbac-demo.json", "utf8")),
};
const make = (options = {}) =>
  createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, ...options } },
  );
const data = async (p) => {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const results = [];
const ok = (condition, label) => {
  assert.ok(condition, label);
  results.push(label);
  console.log("PASS " + label);
};
const clients = {},
  contexts = {};
const bounds = { west: 124, south: 8, east: 125, north: 9 };
for (const [name, a] of Object.entries(accounts)) {
  const client = make();
  await data(
    client.auth.signInWithPassword({ email: a.email, password: a.password }),
  );
  clients[name] = client;
  contexts[name] = await data(client.rpc("staff_context"));
  ok(
    contexts[name].profile.id === a.id &&
      contexts[name].profile.role === (a.role || name),
    `${name}: authenticated context is database-derived`,
  );
}
const {
  admin,
  resident,
  tibanga,
  cenro,
  engineer,
  cdrrmo,
  utility,
  dpwh,
  traffic,
} = clients;
const refs = {
  categories: await data(admin.from("report_categories").select("*")),
  barangays: await data(admin.from("barangays").select("*")),
};
const category = (name) => refs.categories.find((c) => c.name === name).id;
const barangay = (name) => refs.barangays.find((b) => b.name === name).id;
const all = await data(
  admin.from("reports").select("*").order("id").range(0, 999),
);
const allowed = (name, r) => {
  const a = contexts[name],
    p = a.profile;
  if (!a.authorized) return false;
  if (p.role === "admin") return true;
  if (p.role === "barangay") return p.barangay_id === r.barangay_id;
  return a.rules.some(
    (rule) =>
      rule.enabled &&
      a.organizations.some((o) => o.active && o.id === rule.organization_id) &&
      rule.category_id === r.category_id &&
      (!rule.barangay_id || rule.barangay_id === r.barangay_id) &&
      (!rule.assignment_only || rule.organization_id === r.organization_id),
  );
};
for (const name of [
  "admin",
  "barangay",
  "tibanga",
  "engineer",
  "cenro",
  "cdrrmo",
  "dpwh",
  "utility",
  "traffic",
]) {
  const client = clients[name],
    rows = await data(
      client.from("reports").select("*").order("id").range(0, 999),
    );
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    all
      .filter((r) => allowed(name, r))
      .map((r) => r.id)
      .sort(),
  );
  ok(
    true,
    `${name}: private reports exactly match category, jurisdiction and assignment rules`,
  );
  const map = await data(client.rpc("map_reports", bounds));
  ok(
    map.length > 0 &&
      map.every(
        (r) =>
          allowed(name, r) && !["rejected", "duplicate"].includes(r.status),
      ),
    `${name}: shared heatmap returns only permitted actual records`,
  );
  const metrics = await data(client.rpc("geographic_analytics"));
  ok(
    metrics.counts.total === rows.length,
    `${name}: dashboard and geographic aggregate match permitted records`,
  );
  const priorities = await data(client.rpc("barangay_summary"));
  ok(
    priorities.reduce((n, b) => n + Number(b.submitted), 0) === rows.length,
    `${name}: prioritization RPC cannot bypass report RLS`,
  );
}
for (const name of ["pending", "disabled"]) {
  ok(!contexts[name].authorized, `${name}: administrative login gate denied`);
  ok(
    (await data(clients[name].from("reports").select("id"))).length === 0,
    `${name}: direct private reports denied`,
  );
  ok(
    (await data(clients[name].rpc("map_reports", bounds))).length === 0,
    `${name}: direct heatmap denied`,
  );
  ok(
    (await data(clients[name].rpc("geographic_analytics"))).counts.total === 0,
    `${name}: aggregate contains no private report counts`,
  );
  ok(
    (await data(clients[name].from("announcements").select("id"))).length === 0,
    `${name}: community records denied`,
  );
}
ok(
  !contexts.resident.authorized &&
    (await data(resident.rpc("map_reports", bounds))).length === 0,
  "resident: no administrative map access",
);
const fixture = (place, cat) =>
  all.find(
    (r) =>
      r.title.startsWith("[DEMO RBAC]") &&
      r.barangay_id === barangay(place) &&
      r.category_id === category(cat),
  );
const waste = fixture("Tibanga", "Garbage and waste concerns"),
  road = fixture("Tibanga", "Damaged roads and potholes"),
  drain = fixture("Tibanga", "Drainage"),
  wire = fixture("Tibanga", "Hazardous, tangled, or obsolete wires");
assert.ok(waste && road && drain && wire, "Run demo fixture SQL first");
ok(
  (
    await data(
      tibanga
        .from("reports")
        .select("id")
        .eq("barangay_id", barangay("Poblacion")),
    )
  ).length === 0,
  "cross-barangay private report query denied",
);
ok(
  (
    await data(
      cenro.rpc("map_reports", { ...bounds, category: road.category_id }),
    )
  ).length === 0,
  "CENRO cannot force unrelated road category through map filters",
);
ok(
  (
    await data(
      dpwh.rpc("map_reports", { ...bounds, barangay: barangay("Poblacion") }),
    )
  ).length === 0,
  "DPWH assignment does not override geographic coverage",
);
ok(
  (await data(utility.from("reports").select("id").eq("id", road.id)))
    .length === 0,
  "utility cannot read unrelated government infrastructure",
);
ok(
  (
    await utility.rpc("change_report", {
      p_id: road.id,
      p_status: "in_progress",
      p_note: "[DEMO] unauthorized update",
    })
  ).error,
  "utility cannot update unrelated report",
);
ok(
  (
    await cdrrmo.rpc("change_report", {
      p_id: drain.id,
      p_status: "in_progress",
      p_note: "[DEMO] read-only denial",
    })
  ).error,
  "CDRRMO read-only configuration cannot update reports",
);
const original = wire.status;
if (original === "assigned") {
  await data(
    utility.rpc("change_report", {
      p_id: wire.id,
      p_status: "scheduled",
      p_note: "[DEMO] permitted utility work scheduled",
      p_scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  );
}
await data(
  utility.rpc("change_report", {
    p_id: wire.id,
    p_status: original === "assigned" ? "in_progress" : "resolved",
    p_note: "[DEMO] permitted utility progress",
  }),
);
ok(true, "utility can update assigned permitted infrastructure");
// Restore the demo workflow state using trusted administrative transitions.
let state = (
  await data(admin.from("reports").select("status").eq("id", wire.id).single())
).status;
if (state === "resolved") {
  await data(
    admin.rpc("change_report", {
      p_id: wire.id,
      p_status: "under_review",
      p_note: "[DEMO] restore reusable fixture",
    }),
  );
  await data(
    admin.rpc("change_report", {
      p_id: wire.id,
      p_status: "verified",
      p_severity: 2,
      p_urgency: 2,
      p_note: "[DEMO] restore verified fixture",
    }),
  );
}
await data(
  admin.rpc("change_report", {
    p_id: wire.id,
    p_status: "assigned",
    p_organization: accounts.utility.organization_id,
    p_note: "[DEMO] restore assigned fixture",
  }),
);
ok(
  (
    await utility.rpc("change_report", {
      p_id: wire.id,
      p_status: "duplicate",
      p_duplicate: road.id,
      p_note: "[DEMO] disallowed review",
    })
  ).error,
  "utility progress permission does not grant review or duplicate classification",
);
ok(
  (await data(utility.rpc("report_permissions", { p_id: wire.id }))).refer ===
    false,
  "UI action permission uses backend referral decision",
);
ok(
  (await cenro.rpc("set_role", { p_user: accounts.cenro.id, p_role: "admin" }))
    .error,
  "staff cannot grant administrator role",
);
ok(
  (
    await cenro
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", accounts.cenro.id)
  ).error,
  "direct profile role update denied",
);
ok(
  (
    await cenro
      .from("profiles")
      .update({ account_status: "active" })
      .eq("id", accounts.cenro.id)
  ).error,
  "direct account status update denied",
);
ok(
  (
    await cenro.from("organization_memberships").insert({
      user_id: accounts.cenro.id,
      organization_id: accounts.engineer.organization_id,
    })
  ).error,
  "staff cannot change their memberships",
);
ok(
  (
    await cenro.from("organization_access_rules").insert({
      organization_id: accounts.cenro.organization_id,
      category_id: road.category_id,
      enabled: true,
    })
  ).error,
  "staff cannot enlarge category permissions",
);
ok(
  (await data(cenro.from("audit_logs").select("id"))).length === 0,
  "audit history remains administrator-only",
);
ok(
  (
    await admin.rpc("set_account_status", {
      p_user: accounts.admin.id,
      p_status: "disabled",
    })
  ).error,
  "last active administrator cannot be disabled",
);
ok(
  (
    await tibanga
      .from("profiles")
      .update({ barangay_id: barangay("Poblacion") })
      .eq("id", accounts.tibanga.id)
  ).error,
  "barangay cannot change own jurisdiction",
);
await data(
  cenro.auth.updateUser({
    data: { role: "admin", organization_id: accounts.engineer.organization_id },
  }),
);
ok(
  (await data(cenro.rpc("staff_context"))).profile.role === "office" &&
    (await data(cenro.from("reports").select("id").eq("id", road.id)))
      .length === 0,
  "user-editable auth metadata cannot switch effective role",
);
await data(
  cenro.auth.updateUser({ data: { role: null, organization_id: null } }),
);
await data(
  admin.rpc("set_account_status", {
    p_user: accounts.cenro.id,
    p_status: "disabled",
  }),
);
try {
  ok(
    (await data(cenro.rpc("map_reports", bounds))).length === 0,
    "existing unexpired session loses access immediately when disabled",
  );
} finally {
  await data(
    admin.rpc("set_account_status", {
      p_user: accounts.cenro.id,
      p_status: "active",
    }),
  );
}
const cenroRule = contexts.cenro.rules[0];
await data(
  admin
    .from("organization_access_rules")
    .update({ enabled: false })
    .eq("id", cenroRule.id),
);
try {
  ok(
    (await data(cenro.from("reports").select("id"))).length === 0,
    "disabling category rule immediately removes private report access",
  );
} finally {
  await data(
    admin
      .from("organization_access_rules")
      .update({ enabled: true })
      .eq("id", cenroRule.id),
  );
}
await data(
  admin
    .from("organizations")
    .update({ active: false })
    .eq("id", accounts.cenro.organization_id),
);
try {
  ok(
    !(await data(cenro.rpc("staff_context"))).authorized &&
      (await data(cenro.rpc("map_reports", bounds))).length === 0,
    "inactive organization denies existing staff session and heatmap",
  );
} finally {
  await data(
    admin
      .from("organizations")
      .update({ active: true })
      .eq("id", accounts.cenro.organization_id),
  );
}
await data(
  admin
    .from("organization_memberships")
    .delete()
    .eq("user_id", accounts.cenro.id)
    .eq("organization_id", accounts.cenro.organization_id),
);
try {
  ok(
    !(await data(cenro.rpc("staff_context"))).authorized &&
      (await data(cenro.from("reports").select("id"))).length === 0,
    "removed membership immediately revokes office access",
  );
} finally {
  await data(
    admin
      .from("organization_memberships")
      .insert({
        user_id: accounts.cenro.id,
        organization_id: accounts.cenro.organization_id,
      }),
  );
}
await data(
  admin
    .from("organization_memberships")
    .insert({
      user_id: accounts.cenro.id,
      organization_id: accounts.engineer.organization_id,
    }),
);
try {
  const combined = await data(cenro.from("reports").select("*"));
  ok(
    combined.some((r) => r.id === road.id) &&
      combined.every((r) =>
        [waste.category_id, road.category_id, drain.category_id].includes(
          r.category_id,
        ),
      ),
    "multiple memberships combine only explicitly configured category access",
  );
} finally {
  await data(
    admin
      .from("organization_memberships")
      .delete()
      .eq("user_id", accounts.cenro.id)
      .eq("organization_id", accounts.engineer.organization_id),
  );
}
const targets = await data(engineer.rpc("referral_options", { p_id: road.id }));
ok(
  targets.some((o) => o.id === accounts.dpwh.organization_id) &&
    !targets.some((o) => o.id === accounts.cenro.organization_id),
  "referral choices include only approved matching office coverage",
);
ok(
  (await data(utility.rpc("referral_options", { p_id: wire.id }))).length === 0,
  "read/update permission cannot enumerate referral targets",
);
await data(
  admin.rpc("change_report", {
    p_id: road.id,
    p_status: "scheduled",
    p_note: "[DEMO] referral validation work scheduled",
    p_scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }),
);
await data(
  admin.rpc("change_report", {
    p_id: road.id,
    p_status: "in_progress",
    p_note: "[DEMO] referral validation setup",
  }),
);
try {
  ok(
    (
      await engineer.rpc("change_report", {
        p_id: road.id,
        p_status: "assigned",
        p_organization: accounts.cenro.organization_id,
        p_note: "[DEMO] unrelated category referral",
      })
    ).error,
    "referral to an office without matching responsibility is rejected",
  );
} finally {
  await data(
    admin.rpc("change_report", {
      p_id: road.id,
      p_status: "assigned",
      p_organization: accounts.dpwh.organization_id,
      p_note: "[DEMO] restore correct road assignment",
    }),
  );
}
ok(
  (await data(dpwh.from("notifications").select("id").eq("report_id", road.id)))
    .length > 0,
  "assigned office receives a private work notification",
);
await data(
  admin.rpc("set_role", { p_user: accounts.pending.id, p_role: "office" }),
);
try {
  ok(
    (await data(clients.pending.rpc("staff_context"))).profile
      .account_status === "pending",
    "staff role changes require explicit approval",
  );
  ok(
    (
      await admin.rpc("set_account_status", {
        p_user: accounts.pending.id,
        p_status: "active",
      })
    ).error,
    "office approval requires an active organization membership",
  );
} finally {
  await data(
    admin.rpc("set_role", { p_user: accounts.pending.id, p_role: "barangay" }),
  );
}
const privatePath = `${accounts.cenro.id}/${waste.id}/${randomUUID()}.png`;
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfAAAAABJRU5ErkJggg==",
  "base64",
);
await data(
  cenro.storage
    .from("report-evidence")
    .upload(privatePath, pixel, { contentType: "image/png" }),
);
try {
  ok(
    (
      await engineer.storage
        .from("report-evidence")
        .createSignedUrl(privatePath, 30)
    ).error,
    "unrelated office cannot read private evidence by guessed storage path",
  );
  ok(
    (
      await data(
        cenro.storage.from("report-evidence").createSignedUrl(privatePath, 30),
      )
    ).signedUrl,
    "authorized category staff can read protected evidence",
  );
  await data(
    admin.rpc("set_account_status", {
      p_user: accounts.cenro.id,
      p_status: "disabled",
    }),
  );
  try {
    ok(
      (
        await cenro.storage
          .from("report-evidence")
          .createSignedUrl(privatePath, 30)
      ).error,
      "disabled staff cannot create new evidence access links",
    );
  } finally {
    await data(
      admin.rpc("set_account_status", {
        p_user: accounts.cenro.id,
        p_status: "active",
      }),
    );
  }
} finally {
  await data(cenro.storage.from("report-evidence").remove([privatePath]));
}

const announcement = {
  title: "[DEMO RBAC] Authorized office announcement",
  body: "Synthetic announcement for checking configured community publication access.",
  organization_id: accounts.cenro.organization_id,
  barangay_id: barangay("Tibanga"),
  status: "published",
};
const posted = await data(
  cenro.from("announcements").insert(announcement).select("id").single(),
);
ok(
  !!posted.id,
  "CENRO configured publication permission allows scoped announcement",
);
ok(
  (
    await engineer.from("announcements").insert({
      ...announcement,
      organization_id: accounts.engineer.organization_id,
    })
  ).error,
  "office without publication capability cannot publish",
);
ok(
  (
    await tibanga.from("announcements").insert({
      ...announcement,
      organization_id: null,
      barangay_id: barangay("Poblacion"),
    })
  ).error,
  "barangay cannot publish outside jurisdiction",
);
const meeting = await data(
  resident
    .from("meeting_requests")
    .insert({
      barangay_id: barangay("Tibanga"),
      category_id: waste.category_id,
      report_id: waste.id,
      title: "[DEMO RBAC] Waste coordination meeting",
      body: "Synthetic request for testing office-specific meeting authorization and outcome visibility.",
    })
    .select("id")
    .single(),
);
ok(
  !(await data(
    engineer.rpc("community_permissions", {
      p_table: "meeting_requests",
      p_id: meeting.id,
    }),
  )),
  "unrelated office cannot manage waste meeting",
);
const deniedMeeting = await engineer
  .from("meeting_requests")
  .update({ status: "approved", decision_reason: "[DEMO] unrelated decision" })
  .eq("id", meeting.id)
  .select("id");
ok(
  !!deniedMeeting.error || deniedMeeting.data.length === 0,
  "unrelated office direct meeting approval denied",
);
await data(
  cenro
    .from("meeting_requests")
    .update({
      status: "approved",
      decision_reason: "[DEMO] authorized waste coordination",
    })
    .eq("id", meeting.id),
);
ok(
  (
    await data(
      admin
        .from("meeting_requests")
        .select("status")
        .eq("id", meeting.id)
        .single(),
    )
  ).status === "approved",
  "authorized office can approve matching coordination request",
);
ok(
  (
    await data(
      admin
        .from("audit_logs")
        .select("id")
        .eq("entity", "profiles")
        .eq("record_id", accounts.cenro.id),
    )
  ).length > 0,
  "account-status changes recorded in audit trail",
);
const unauthorized = make();
ok(
  (await unauthorized.rpc("staff_context")).error,
  "anonymous administrative context denied",
);
const forged = make();
await data(forged.auth.signInWithPassword(accounts.traffic));
const session = (await forged.auth.getSession()).data.session;
const parts = session.access_token.split("."),
  payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
payload.role = "service_role";
parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
const response = await fetch(
  env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/reports?select=id",
  {
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + parts.join("."),
    },
  },
);
ok(response.status === 401, "manipulated JWT role signature rejected");
const memory = new Map(),
  storage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
const persisted = make({ persistSession: true, storage });
await data(persisted.auth.signInWithPassword(accounts.traffic));
const reloaded = make({ persistSession: true, storage });
ok(
  (await reloaded.auth.getSession()).data.session.user.id ===
    accounts.traffic.id &&
    (await data(reloaded.rpc("staff_context"))).authorized,
  "persisted session restores authenticated account context",
);
const refresh = await data(reloaded.auth.refreshSession());
ok(!!refresh.session, "session refresh succeeds");
await data(reloaded.auth.signOut());
ok(
  !(await reloaded.auth.getSession()).data.session,
  "sign-out clears persisted session",
);
const expiring = make({ persistSession: true, storage });
await data(expiring.auth.signInWithPassword(accounts.traffic));
const savedKey = [...memory.keys()].find((k) => k.endsWith("-auth-token"));
const saved = JSON.parse(memory.get(savedKey));
saved.expires_at = Math.floor(Date.now() / 1000) - 60;
memory.set(savedKey, JSON.stringify(saved));
const recovered = make({ persistSession: true, storage });
const recoveredSession = (await recovered.auth.getSession()).data.session;
ok(
  !!recoveredSession &&
    recoveredSession.expires_at > Math.floor(Date.now() / 1000),
  "expired local session metadata triggers token refresh and recovery",
);
await data(recovered.auth.signOut());
memory.set(
  savedKey,
  JSON.stringify({
    ...recoveredSession,
    expires_at: Math.floor(Date.now() / 1000) - 60,
  }),
);
const expiredAndRevoked = make({ persistSession: true, storage });
ok(
  !(await expiredAndRevoked.auth.getSession()).data.session,
  "expired local session with revoked refresh token returns to signed-out state",
);

const revoked = await make().auth.refreshSession({
  refresh_token: refresh.session.refresh_token,
});
ok(!!revoked.error, "signed-out refresh token cannot renew a session");
writeFileSync(
  "docs/rbac-test-results.json",
  JSON.stringify(
    {
      executed_at: new Date().toISOString(),
      passed: results.length,
      checks: results,
      browser: "Not executed: local browser use disabled in Work settings.",
    },
    null,
    2,
  ),
);
console.log(`RBAC acceptance: ${results.length} checks passed.`);
for (const client of Object.values(clients))
  await client.auth.signOut({ scope: "local" });
