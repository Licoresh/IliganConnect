import { test } from "node:test";
import assert from "node:assert/strict";
import { googleCalendarDraftUrl, meetingDateTimeInput, normalizeGoogleMeetUrl, parseManilaDateTimeInput } from "../shared/meeting-links";

test("meeting datetime inputs are interpreted and displayed in Philippine time", () => {
  const parsed = parseManilaDateTimeInput("2026-11-15T09:30");
  assert.equal(parsed?.toISOString(), "2026-11-15T01:30:00.000Z");
  assert.equal(meetingDateTimeInput(parsed), "2026-11-15T09:30");
  assert.equal(parseManilaDateTimeInput("2026-02-30T09:30"), null);
  assert.equal(parseManilaDateTimeInput("2026-11-15 09:30"), null);
});

test("Google Meet URLs must use the official host and a meeting path", () => {
  assert.equal(normalizeGoogleMeetUrl(" https://meet.google.com/abc-defg-hij "), "https://meet.google.com/abc-defg-hij");
  assert.equal(normalizeGoogleMeetUrl("https://meet.google.com/abc-defg-hij?authuser=0"), "https://meet.google.com/abc-defg-hij?authuser=0");
  assert.equal(normalizeGoogleMeetUrl("http://meet.google.com/abc-defg-hij"), null);
  assert.equal(normalizeGoogleMeetUrl("https://meet.google.com.evil.test/abc-defg-hij"), null);
  assert.equal(normalizeGoogleMeetUrl("https://example.com/abc-defg-hij"), null);
  assert.equal(normalizeGoogleMeetUrl("https://meet.google.com/"), null);
});

test("Calendar draft follows the selected instant and uses a one-hour event", () => {
  const start = parseManilaDateTimeInput("2026-11-15T09:30")!;
  const url = new URL(googleCalendarDraftUrl({ title: "Drainage coordination", details: "Review the reported blockage.", venue: "Barangay hall", startsAt: start, meetUrl: "https://meet.google.com/abc-defg-hij" })!);
  assert.equal(url.origin, "https://calendar.google.com");
  assert.equal(url.searchParams.get("dates"), "20261115T013000Z/20261115T023000Z");
  assert.equal(url.searchParams.get("location"), "Barangay hall");
  assert.match(url.searchParams.get("details") || "", /https:\/\/meet\.google\.com\/abc-defg-hij/);
});
