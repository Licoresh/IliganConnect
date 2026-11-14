if (!process.argv.includes("--allow-test-data")) throw new Error("This script creates or changes synthetic data. Use only an isolated test project with --allow-test-data; do not run against the live system.");
import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
// Local demo provisioning only. Credentials and generated SQL are ignored by Git.
if (existsSync(".env.rbac-demo.json"))
  throw new Error(
    "Reuse existing .env.rbac-demo.json; no credentials overwritten.",
  );
const definitions = {
  tibanga: { role: "barangay", barangay: "Tibanga" },
  engineer: {
    organization: "DEMO RBAC — City Engineer",
    categories: ["Drainage", "Damaged roads and potholes"],
    review: true,
    refer: true,
  },
  cenro: {
    organization: "DEMO RBAC — CENRO",
    categories: ["Garbage and waste concerns"],
    review: true,
    publish: true,
  },
  cdrrmo: {
    organization: "DEMO RBAC — CDRRMO",
    categories: ["Drainage"],
    update: false,
  },
  dpwh: {
    organization: "DEMO RBAC — DPWH",
    categories: ["Damaged roads and potholes"],
    assigned: true,
    barangay: "Tibanga",
    refer: true,
  },
  utility: {
    organization: "DEMO RBAC — Utility provider",
    categories: [
      "Hazardous, tangled, or obsolete wires",
      "Broken or defective streetlights",
    ],
    assigned: true,
  },
  traffic: {
    organization: "DEMO RBAC — City Traffic",
    categories: ["Missing or damaged road signs and markings"],
    review: true,
  },
  pending: { role: "barangay", barangay: "Tibanga", status: "pending" },
  disabled: { role: "barangay", barangay: "Tibanga", status: "disabled" },
};
const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;
const accounts = Object.fromEntries(
  Object.entries(definitions).map(([name, d]) => [
    name,
    {
      ...d,
      role: d.role || "office",
      status: d.status || "active",
      id: randomUUID(),
      organization_id: d.organization ? randomUUID() : null,
      email: `demo-rbac-${name}-${randomBytes(4).toString("hex")}@example.invalid`,
      password: randomBytes(24).toString("base64url"),
    },
  ]),
);
let sql = "begin;\n";
for (const [name, u] of Object.entries(accounts)) {
  sql += `insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token) values('00000000-0000-0000-0000-000000000000',${quote(u.id)},'authenticated','authenticated',${quote(u.email)},extensions.crypt(${quote(u.password)},extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}',${quote(JSON.stringify({ display_name: `DEMO RBAC ${name}`, is_demo: true }))},now(),now(),'','','','');\n`;
  sql += `insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values(gen_random_uuid(),${quote(u.id)},${quote(u.id)},${quote(JSON.stringify({ sub: u.id, email: u.email }))},'email',now(),now(),now());\n`;
  sql += `update public.profiles set role=${quote(u.role)},account_status=${quote(u.status)},barangay_id=(select id from public.barangays where name=${quote(u.barangay || "Poblacion")}) where id=${quote(u.id)};\n`;
  if (u.organization) {
    sql += `insert into public.organizations(id,name,responsibilities,can_consult,can_coordinate,can_publish) values(${quote(u.organization_id)},${quote(u.organization)},'Synthetic access profile for testing; not an approved government arrangement.',true,true,${!!u.publish});\n`;
    sql += `insert into public.organization_memberships(user_id,organization_id) values(${quote(u.id)},${quote(u.organization_id)});\n`;
    sql += `insert into public.organization_access_rules(organization_id,category_id,barangay_id,assignment_only,can_review,can_update,can_refer,enabled,notes) select ${quote(u.organization_id)},id,${u.barangay ? `(select id from public.barangays where name=${quote(u.barangay)})` : "null"},${!!u.assigned},${!!u.review},${u.update !== false},${!!u.refer},true,'DEMO ONLY. Confirm road ownership and local workflow before operational use.' from public.report_categories where name in (${u.categories.map(quote).join(",")});\n`;
  }
}
sql += "commit;\n";
writeFileSync(".env.rbac-demo.json", JSON.stringify(accounts, null, 2));
writeFileSync(".env.rbac-demo.sql", sql);
console.log(
  "Prepared nine labelled accounts; credentials and provisioning SQL saved in ignored local files.",
);
