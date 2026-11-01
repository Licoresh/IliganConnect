import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  let supabaseOrigin = "";
  try {
    supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").origin;
  } catch {}
  const realtimeOrigin = supabaseOrigin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next's development overlay injects styles without a nonce.
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabaseOrigin}`,
    `font-src 'self' data: ${supabaseOrigin}`,
    `connect-src 'self' ${supabaseOrigin} ${realtimeOrigin} https://tile.openstreetmap.org https://a.tile.opentopomap.org https://b.tile.opentopomap.org https://c.tile.opentopomap.org https://services.arcgisonline.com`,
    `worker-src 'self' blob:`,
    `media-src 'self' blob: ${supabaseOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
