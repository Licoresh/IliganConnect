import { mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
for (const app of ["web", "app"]) {
  const target = join(root, app, "public", "maplibre");
  mkdirSync(target, { recursive: true });
  for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])
    copyFileSync(
      join(root, "node_modules", "maplibre-gl", "dist", name),
      join(target, name),
    );
}
