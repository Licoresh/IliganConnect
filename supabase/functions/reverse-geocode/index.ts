// Compatibility endpoint for older app builds. Uses stored boundaries, never paid geocoding.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Use a location check request." }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "Sign in to check a location." }, 401);
  const body = await request.json().catch(() => null);
  if (typeof body?.latitude !== "number" || typeof body?.longitude !== "number" ||
      !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) ||
      Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180) {
    return reply({ error: "Choose a valid point on the map." }, 400);
  }
  try {
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/resolve_report_location`, {
      method: "POST",
      headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ p_latitude: body.latitude, p_longitude: body.longitude }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return reply({ error: "Could not check this location. Sign in again and retry." }, response.status === 401 || response.status === 403 ? response.status : 502);
    const location = await response.json();
    if (location.city !== "inside") return reply({ error: location.city === "unknown" ? "This pin is near the mapped city boundary. Check the spot and try again." : "This pin is outside the mapped Iligan area. Check the pin or contact support if the boundary is incorrect." }, 422);
    return reply({ source: location.source, results: [{ formatted_address: location.address, address_components: [
      { long_name: "Iligan City", types: ["locality", "political"] },
      ...(location.barangay ? [{ long_name: location.barangay, types: ["administrative_area_level_4", "political"] }] : []),
    ] }] });
  } catch { return reply({ error: "Location checking is temporarily unavailable. Please retry." }, 502); }
});
