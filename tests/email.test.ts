import assert from "node:assert/strict";
import test from "node:test";
import { brevoTemplateIds, emailEvents, escapeEmailText, firstName, notificationEmailEvent } from "../supabase/functions/_shared/email.ts";

test("every transactional event is mapped to its active Brevo template", () => {
  assert.deepEqual(Object.keys(brevoTemplateIds).sort(), [...emailEvents].sort());
  assert.equal(new Set(Object.values(brevoTemplateIds)).size, emailEvents.length);
  assert.deepEqual(brevoTemplateIds, {
    report_received: 1,
    report_update: 2,
    report_triage: 3,
    meeting_request: 4,
    meeting_invitation: 5,
    meeting_update: 6,
    meeting_declined: 7,
    announcement: 8,
    consultation: 9,
  });
});

test("notification email routing covers report, meeting, announcement, and consultation events", () => {
  assert.equal(notificationEmailEvent({ title: "A followed report has an update", reportId: "r" }), "report_update");
  assert.equal(notificationEmailEvent({ title: "Work has been scheduled for your report", reportId: "r" }), "report_update");
  assert.equal(notificationEmailEvent({ title: "Work on your report has been rescheduled", reportId: "r" }), "report_update");
  assert.equal(notificationEmailEvent({ title: "Work on your report is complete", reportId: "r" }), "report_update");
  assert.equal(notificationEmailEvent({ title: "A report was forwarded to your office", reportId: "r" }), "report_triage");
  assert.equal(notificationEmailEvent({ title: "You are invited to a community meeting", meetingRequestId: "m" }), "meeting_invitation");
  assert.equal(notificationEmailEvent({ title: "A resident requested a meeting in your barangay", meetingRequestId: "m" }), "meeting_request");
  assert.equal(notificationEmailEvent({ title: "All invited offices declined the meeting", meetingRequestId: "m" }), "meeting_declined");
  assert.equal(notificationEmailEvent({ title: "An invited office accepted a meeting", meetingRequestId: "m" }), "meeting_update");
  assert.equal(notificationEmailEvent({ title: "A new official announcement is available", announcementId: "a" }), "announcement");
  assert.equal(notificationEmailEvent({ title: "An official response was posted", consultationId: "c" }), "consultation");
  assert.equal(notificationEmailEvent({ title: "Unlinked event" }), null);
});

test("dynamic email text is bounded, control-free, and HTML escaped", () => {
  assert.equal(escapeEmailText("<script>&\"x\"</script>"), "&lt;script&gt;&amp;&quot;x&quot;&lt;/script&gt;");
  assert.equal(escapeEmailText("ok\u0000\nnext"), "ok\nnext");
  assert.equal(escapeEmailText("123456", 3), "123");
  assert.equal(firstName("Jolo Canete"), "Jolo");
  assert.equal(firstName(""), "there");
});
