if (!process.argv.includes("--allow-test-data")) throw new Error("This script creates or changes synthetic data. Use only an isolated test project with --allow-test-data; do not run against the live system.");
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
// Generated credentials remain local and gitignored. Never ship them in either app.
if (existsSync(".env.demo.json"))
  throw new Error("Demo accounts already prepared; reuse .env.demo.json.");
const users = Object.fromEntries(
  ["resident", "barangay", "office", "admin"].map((role) => [
    role,
    {
      id: randomUUID(),
      email: `demo-${role}-${randomBytes(4).toString("hex")}@example.invalid`,
      password: randomBytes(24).toString("base64url"),
    },
  ]),
);
writeFileSync(".env.demo.json", JSON.stringify(users, null, 2));
let sql = "begin;\n";
for (const [role, u] of Object.entries(users)) {
  sql += `insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token) values('00000000-0000-0000-0000-000000000000','${u.id}','authenticated','authenticated','${u.email}',extensions.crypt('${u.password}',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"Demo ${role}","is_demo":true}',now(),now(),'','','','');\n`;
  sql += `insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values(gen_random_uuid(),'${u.id}','${u.id}','{"sub":"${u.id}","email":"${u.email}"}','email',now(),now(),now());\n`;
  sql += `update public.profiles set role='${role}',barangay_id=(select id from public.barangays where name='Poblacion') where id='${u.id}';\n`;
  if (role === "office")
    sql += `insert into public.organization_memberships(user_id,organization_id) select '${u.id}',id from public.organizations order by name limit 1;\n`;
}
sql += "commit;";
writeFileSync(".env.demo.sql", sql);
console.log(
  "Prepared four demo roles. Credentials saved locally in .env.demo.json.",
);
