export const ANDROID_APK_ASSET = "Iligan-Connect-Resident.apk";
const LATEST_MANIFEST = "https://github.com/Licoresh/IliganConnect/releases/latest/download/android-update.json";
const RELEASE_PATH = "/Licoresh/IliganConnect/releases/download/";

export type AndroidUpdate = { version: string; downloadUrl: string };

function versionParts(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(candidate: string, installed: string): boolean {
  const next = versionParts(candidate), current = versionParts(installed);
  if (!next || !current) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== current[i]) return next[i] > current[i];
  }
  return false;
}

export function availableAndroidUpdate(release: unknown, installed: string): AndroidUpdate | null {
  if (!release || typeof release !== "object") return null;
  const data = release as { version?: unknown; downloadUrl?: unknown };
  if (typeof data.version !== "string" || !isNewerVersion(data.version, installed) || typeof data.downloadUrl !== "string") return null;
  try {
    const url = new URL(data.downloadUrl);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== `${RELEASE_PATH}v${data.version}/${ANDROID_APK_ASSET}`) return null;
    return { version: data.version, downloadUrl: url.toString() };
  } catch { return null; }
}

export async function checkAndroidUpdate(installed: string, signal?: AbortSignal): Promise<AndroidUpdate | null> {
  const response = await fetch(LATEST_MANIFEST, { headers: { Accept: "application/json" }, signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Update check failed (${response.status})`);
  return availableAndroidUpdate(await response.json(), installed);
}
