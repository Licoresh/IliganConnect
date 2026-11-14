import assert from "node:assert/strict";
import { test } from "node:test";
import { readWorkspaceLocation, shouldResetWorkspace, workspaceLocationUrl } from "../web/lib/workspace-location";

const sections = ["Overview", "Issue reports", "Settings"];
const id = "123e4567-e89b-42d3-a456-426614174000";

test("workspace URLs preserve unrelated query and hash while storing a page", () => {
  const url = workspaceLocationUrl(new URL("https://example.test/?theme=light#main"), {
    section: "Issue reports", scope: id, recordId: id, queue: "review",
  });
  assert.equal(url, `/?theme=light&section=Issue+reports&scope=${id}&record=${id}&queue=review#main`);
});

test("workspace URL parsing restores valid page context", () => {
  assert.deepEqual(
    readWorkspaceLocation(new URL(`https://example.test/?section=Issue%20reports&scope=${id}&record=${id}&queue=route`), sections),
    { section: "Issue reports", scope: id, recordId: id, queue: "route" },
  );
});

test("legacy barangay prioritization links open Geographic analytics", () => {
  assert.deepEqual(
    readWorkspaceLocation(new URL("https://example.test/?section=Barangay+prioritization"), [...sections, "Geographic analytics"]),
    { section: "Geographic analytics", scope: "", recordId: "", queue: "all" },
  );
});

test("legacy profile links open the consolidated account settings page", () => {
  assert.deepEqual(
    readWorkspaceLocation(new URL("https://example.test/?section=Profile"), sections),
    { section: "Settings", scope: "", recordId: "", queue: "all" },
  );
});

test("legacy organization links open the consolidated administration page", () => {
  const url = new URL("https://example.test/?section=Organizations");
  assert.equal(readWorkspaceLocation(url, [...sections, "Administration"]).section, "Administration");
  assert.equal(readWorkspaceLocation(url, sections).section, "Overview");
});

test("invalid or unauthorized route values fall back safely", () => {
  assert.deepEqual(
    readWorkspaceLocation(new URL("https://example.test/?section=Administration&scope=bad&record=bad&queue=admin"), sections),
    { section: "Overview", scope: "", recordId: "", queue: "all" },
  );
});

test("overview removes workspace route parameters but keeps other URL state", () => {
  assert.equal(
    workspaceLocationUrl(new URL(`https://example.test/?section=Profile&record=${id}&theme=dark`), {
      section: "Overview", scope: "", recordId: "", queue: "all",
    }),
    "/?theme=dark",
  );
});

test("first sign-in keeps a deep link; later account changes clear it", () => {
  assert.equal(shouldResetWorkspace(null, id), false);
  assert.equal(shouldResetWorkspace(id, null), true);
  assert.equal(shouldResetWorkspace(id, "223e4567-e89b-42d3-a456-426614174000"), true);
});
