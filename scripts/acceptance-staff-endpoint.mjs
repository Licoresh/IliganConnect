// Rejected requests only: never sends a valid staff invitation.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync("web/.env.local", "utf8").split(/\r?\n/)
  .filter(line => line.includes("=") && !line.trim().startsWith("#"))
  .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
const accounts = Object.assign({}, ...[".env.demo.json", ".env.rbac-demo.json"].map(path => JSON.parse(readFileSync(path, "utf8"))));
const clients = [];
const tokens = {};
let checks = 0;
async function request(token, body, expected, label, method = "POST") {
  const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const result = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-staff-account`, {
    method, headers, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  assert.equal(result.status, expected, label);
  checks++;
}
try {
  for (const name of ["admin", "resident", "pending", "disabled"]) {
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    clients.push(client);
    const response = await client.auth.signInWithPassword({ email: accounts[name].email, password: accounts[name].password });
    assert.ifError(response.error);
    tokens[name] = response.data.session.access_token;
  }
  const scope = await clients[0].from("barangays").select("id").limit(1).single();
  assert.ifError(scope.error);
  const validShape = { display_name: "Rejected acceptance request", email: "no-invitation@example.invalid", role: "barangay", barangay_id: scope.data.id, organization_id: null };
  await request(null, validShape, 401, "Anonymous invitation denied");
  await request("invalid-token", validShape, 401, "Invalid session denied");
  for (const name of ["resident", "pending", "disabled"]) await request(tokens[name], validShape, 403, `${name}: staff invitation denied`);
  await request(tokens.admin, { ...validShape, role: "admin" }, 400, "Administrator role invitation rejected");
  await request(tokens.admin, { ...validShape, display_name: "X" }, 400, "Invalid name rejected");
  await request(tokens.admin, { ...validShape, email: "invalid" }, 400, "Invalid email rejected");
  await request(tokens.admin, "{", 400, "Malformed JSON rejected");
  await request(tokens.admin, { ...validShape, barangay_id: randomUUID() }, 400, "Nonexistent scope rejected before invitation");
  await request(tokens.admin, validShape, 405, "Unsupported method rejected", "GET");
  console.log(`Staff endpoint rejected-request checks passed: ${checks}; no valid invitations submitted.`);
} finally {
  await Promise.all(clients.map(client => client.auth.signOut({ scope: "local" })));
}
