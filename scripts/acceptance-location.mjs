import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync("web/.env.local", "utf8").split(/\r?\n/)
  .filter(line => line.includes("=") && !line.trim().startsWith("#"))
  .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
const make = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const db = make(), anonymous = make();
const account = JSON.parse(readFileSync(".env.demo.json", "utf8")).resident;
let checks = 0;
const check = (value, name) => { assert.ok(value, name); console.log(`PASS ${name}`); checks++; };
try {
  const login = await db.auth.signInWithPassword(account);
  assert.ifError(login.error);
  for (const [name, latitude, longitude, city, barangay] of [
    ["Poblacion", 8.22947578, 124.23688253, "inside", "Poblacion"],
    ["Dalipuga", 8.309737269, 124.26988718, "inside", "Dalipuga"],
    ["Digkilaan", 8.26193818, 124.34639594, "inside", "Digkilaan"],
    ["Rogongon", 8.23547831, 124.44418217, "inside", "Rogongon"],
    ["Limunsudan", 8.1126, 124.5235, "inside", null],
    ["Manila", 14.5995, 120.9842, "outside", null],
  ]) {
    const response = await db.rpc("resolve_report_location", { p_latitude: latitude, p_longitude: longitude });
    assert.ifError(response.error);
    check(response.data.city === city && response.data.barangay === barangay, `${name}: city coverage and barangay suggestion`);
  }
  for (const coordinates of [{ p_latitude: null, p_longitude: 124 }, { p_latitude: 91, p_longitude: 124 }]) {
    check(!!(await db.rpc("resolve_report_location", coordinates)).error, "Invalid coordinates rejected");
  }
  check(!!(await anonymous.rpc("resolve_report_location", { p_latitude: 8.228, p_longitude: 124.2452 })).error,
    "Location RPC requires authentication");
  const legacy = await db.functions.invoke("reverse-geocode", { body: { latitude: 8.228, longitude: 124.2452 } });
  assert.ifError(legacy.error);
  check(legacy.data.source?.includes("OpenStreetMap") && legacy.data.results?.length === 1,
    "Older app location endpoint works without a Google Maps key");
  const invalid = await db.functions.invoke("reverse-geocode", { body: { latitude: null, longitude: 124 } });
  check(invalid.error?.context?.status === 400, "Location endpoint rejects blank coordinates");
  check(!!(await anonymous.functions.invoke("reverse-geocode", { body: { latitude: 8.228, longitude: 124.2452 } })).error,
    "Location endpoint rejects anonymous requests");
} finally { await db.auth.signOut({ scope: "local" }); }
console.log(`${checks} location checks passed; no report records created.`);
