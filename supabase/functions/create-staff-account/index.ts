import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "Use a staff invitation request." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "Sign in as a system administrator." }, 401);

  const rawBody = await request.text();
  if (rawBody.length > 8_000) return reply({ error: "The invitation details are too long." }, 413);
  let body: Record<string, unknown> | null;
  try {
    body = JSON.parse(rawBody || "null");
  } catch {
    return reply({ error: "Invitation details are invalid." }, 400);
  }
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body?.role;
  const barangayId = body?.barangay_id || null;
  const organizationId = body?.organization_id || null;

  if (displayName.length < 2 || displayName.length > 100) return reply({ error: "Enter a name between 2 and 100 characters." }, 400);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Enter a valid email address." }, 400);
  if (role === "barangay" ? (!uuid.test(String(barangayId)) || organizationId !== null) : role === "office" ? (!uuid.test(String(organizationId)) || barangayId !== null) : true) {
    return reply({ error: "Choose a valid barangay or organization for this staff account." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return reply({ error: "Staff invitations are not configured on this project." }, 503);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return reply({ error: "Your session expired. Sign in again." }, 401);
  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role,account_status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) return reply({ error: "Could not verify administrator access." }, 500);
  if (profile?.role !== "admin" || profile.account_status !== "active") return reply({ error: "Only an active system administrator can invite staff." }, 403);

  const scopeTable = role === "barangay" ? "barangays" : "organizations";
  let scopeQuery = userClient.from(scopeTable).select("id").eq("id", String(barangayId || organizationId));
  if (role === "office") scopeQuery = scopeQuery.eq("active", true);
  const { data: scope, error: scopeError } = await scopeQuery.maybeSingle();
  if (scopeError) return reply({ error: "Could not verify the selected staff scope. Try again." }, 503);
  if (!scope) return reply({ error: "Choose an existing barangay or active organization before sending an invitation." }, 400);

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
  });
  if (inviteError || !data.user) return reply({ error: "The invitation could not be created. Check that the email is new and try again." }, 409);

  const { error: provisionError } = await userClient.rpc("provision_staff_account", {
    p_user: data.user.id,
    p_role: role,
    p_barangay: barangayId,
    p_organization: organizationId,
  });
  if (provisionError) {
    console.error("Staff account provisioning failed", provisionError.message);
    const { error: rollbackError } = await adminClient.auth.admin.deleteUser(data.user.id);
    return reply({ error: rollbackError ? "The invitation was sent, but setup did not finish. Contact the system administrator before retrying." : "Setup did not finish, so the invitation was canceled. Check the selected scope and try again." }, 500);
  }

  return reply({ message: "Invitation sent. The stakeholder account is pending approval until an administrator activates it." }, 201);
});
