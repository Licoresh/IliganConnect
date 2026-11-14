import assert from "node:assert/strict";
import test from "node:test";
import { availableAndroidUpdate, isNewerVersion } from "../app/lib/app-update";

const manifest = { version: "1.0.2", downloadUrl: "https://github.com/Licoresh/IliganConnect/releases/download/v1.0.2/Iligan-Connect-Resident.apk" };

test("only a higher numeric APK version is an update", () => {
  assert.equal(isNewerVersion("v1.0.2", "1.0.1"), true);
  assert.equal(isNewerVersion("v1.0.1", "1.0.1"), false);
  assert.equal(isNewerVersion("v1.0.0", "1.0.1"), false);
  assert.equal(isNewerVersion("v1.0.2-beta", "1.0.1"), false);
});

test("the manifest must point to the matching APK release in this repository", () => {
  assert.deepEqual(availableAndroidUpdate(manifest, "1.0.1"), { version: "1.0.2", downloadUrl: manifest.downloadUrl });
  assert.equal(availableAndroidUpdate({ ...manifest, downloadUrl: "https://example.com/other.apk" }, "1.0.1"), null);
  assert.equal(availableAndroidUpdate({ ...manifest, downloadUrl: "https://github.com/Other/Repo/releases/download/v1.0.2/Iligan-Connect-Resident.apk" }, "1.0.1"), null);
  assert.equal(availableAndroidUpdate({ ...manifest, downloadUrl: "https://github.com/Licoresh/IliganConnect/releases/download/v1.0.1/Iligan-Connect-Resident.apk" }, "1.0.1"), null);
  assert.equal(availableAndroidUpdate({ ...manifest, version: "1.0.2-beta" }, "1.0.1"), null);
});
