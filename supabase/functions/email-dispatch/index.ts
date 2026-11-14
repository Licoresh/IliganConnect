import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { brevoTemplateIds, escapeEmailText, firstName, type EmailEvent } from "../_shared/email.ts";

const reply = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

type OutboxRow = {
  id: string;
  recipient_id: string;
  event_key: EmailEvent;
  report_id: string | null;
  meeting_request_id: string | null;
  announcement_id: string | null;
  consultation_id: string | null;
  notification_title: string | null;
};

const statusLabels: Record<string, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  verified: "Verified",
  assigned: "Forwarded to an office",
  scheduled: "Work scheduled",
  in_progress: "In progress",
  resolved: "Resolved",
  rejected: "Closed after review",
  duplicate: "Linked to a related report",
};

const urgencyLabels: Record<number, string> = {
  1: "Routine",
  2: "Soon",
  3: "Prompt",
  4: "Urgent",
  5: "Immediate review",
};

function paramsFor(event: EmailEvent, name: string, data: Record<string, string>) {
  const common = { firstName: name };
  switch (event) {
    case "report_received":
      return { ...common, reportTitle: data.reportTitle, reference: data.reference, barangay: data.barangay, status: data.status };
    case "report_triage":
      return { ...common, reportTitle: data.reportTitle, reference: data.reference, category: data.category, barangay: data.barangay, officeName: data.officeName, urgency: data.urgency, location: data.location };
    case "report_update":
      return { ...common, reportTitle: data.reportTitle, reference: data.reference, status: data.status, publicUpdate: data.publicUpdate };
    case "meeting_request":
      return { ...common, meetingTitle: data.meetingTitle, barangay: data.barangay, residentName: data.residentName, reportTitle: data.reportTitle, requestSummary: data.requestSummary };
    case "meeting_invitation":
      return { ...common, meetingTitle: data.meetingTitle, barangay: data.barangay, reportTitle: data.reportTitle, meetingTime: data.meetingTime, venueType: data.venueType, venue: data.venue, meetUrl: data.meetUrl, reason: data.reason };
    case "meeting_update":
    case "meeting_declined":
      return { ...common, meetingTitle: data.meetingTitle, status: data.status, reason: data.reason, meetingTime: data.meetingTime, venueType: data.venueType, venue: data.venue, meetUrl: data.meetUrl };
    case "announcement":
      return { ...common, announcementTitle: data.announcementTitle, sourceName: data.sourceName, publishedAt: data.publishedAt, body: data.body };
    case "consultation":
      return { ...common, consultationTitle: data.consultationTitle, sourceName: data.sourceName, response: data.response, reportTitle: data.reportTitle };
  }
}

async function readEvent(admin: ReturnType<typeof createClient>, row: OutboxRow, profile: Record<string, unknown>) {
  const data: Record<string, string> = {};
  const reportId = row.report_id;
  if (reportId) {
    const { data: report, error } = await admin.from("reports")
      .select("id,title,status,scheduled_at,category_id,barangay_id,organization_id,severity,urgency,purok,zone,landmark,location_address,latitude,longitude,public_summary,is_demo")
      .eq("id", reportId).maybeSingle();
    if (error || !report || report.is_demo) return null;
    const [category, barangay, organization, history] = await Promise.all([
      admin.from("report_categories").select("name").eq("id", report.category_id).maybeSingle(),
      admin.from("barangays").select("name").eq("id", report.barangay_id).maybeSingle(),
      report.organization_id ? admin.from("organizations").select("name").eq("id", report.organization_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      admin.from("report_status_history").select("public_note").eq("report_id", reportId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const location = [report.purok, report.zone, report.location_address || report.landmark].filter(Boolean).join(", ");
    Object.assign(data, {
      reportTitle: escapeEmailText(report.title, 160),
      reference: escapeEmailText(report.id.slice(0, 8).toUpperCase(), 12),
      status: escapeEmailText(statusLabels[String(report.status)] ?? report.status, 80),
      category: escapeEmailText(category.data?.name || "Community report", 100),
      barangay: escapeEmailText(barangay.data?.name || "Iligan City", 100),
      officeName: escapeEmailText(organization.data?.name || "Barangay operations", 120),
      urgency: escapeEmailText(urgencyLabels[Number(report.urgency)] ?? "Not assessed", 40),
      location: escapeEmailText(location || "See the report map for the exact pin.", 240),
      publicUpdate: escapeEmailText([
        report.status === "scheduled" && report.scheduled_at
          ? `Work is scheduled for ${new Date(report.scheduled_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })} Philippine time.`
          : "",
        history.data?.public_note || report.public_summary || "The case record has been updated. Open Iligan Connect for the latest public details.",
      ].filter(Boolean).join(" "), 500),
    });
  }

  if (row.meeting_request_id) {
    const { data: meeting, error } = await admin.from("meeting_requests")
      .select("id,title,body,status,decision_reason,barangay_id,report_id,is_sample,resident_id")
      .eq("id", row.meeting_request_id).maybeSingle();
    if (error || !meeting || meeting.is_sample) return null;
    const [barangay, report, schedule] = await Promise.all([
      admin.from("barangays").select("name").eq("id", meeting.barangay_id).maybeSingle(),
      meeting.report_id ? admin.from("reports").select("title,is_demo").eq("id", meeting.report_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      admin.from("meetings").select("starts_at,ends_at,venue,venue_type,meet_url").eq("request_id", meeting.id).maybeSingle(),
    ]);
    if (report.data?.is_demo) return null;
    if (schedule.error) throw new Error("meeting_schedule_lookup_failed");
    const resident = await admin.from("profiles").select("display_name").eq("id", meeting.resident_id).maybeSingle();
    Object.assign(data, {
      meetingTitle: escapeEmailText(meeting.title, 160),
      barangay: escapeEmailText(barangay.data?.name || "Iligan City", 100),
      residentName: escapeEmailText(resident.data?.display_name || "A resident", 100),
      reportTitle: escapeEmailText(report.data?.title || "No linked report", 160),
      requestSummary: escapeEmailText(meeting.body, 500),
      status: escapeEmailText(meeting.status, 80),
      reason: escapeEmailText(meeting.decision_reason || "No reason was provided.", 500),
      meetingTime: schedule.data?.starts_at && schedule.data.ends_at
        ? escapeEmailText(`${new Date(schedule.data.starts_at).toLocaleDateString("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" })} · ${new Date(schedule.data.starts_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}–${new Date(schedule.data.ends_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })} Philippine time`, 120)
        : "To be scheduled",
      venueType: schedule.data?.venue_type === "online" ? "Online (Google Meet)" : "In person",
      venue: escapeEmailText(schedule.data?.venue_type === "online" && schedule.data.meet_url
        ? `Google Meet link: ${schedule.data.meet_url}`
        : schedule.data?.venue || "To be confirmed", 320),
      meetUrl: escapeEmailText(schedule.data?.meet_url || "", 320),
    });
  }

  if (row.announcement_id) {
    const { data: announcement, error } = await admin.from("announcements")
      .select("title,body,status,publish_at,barangay_id,organization_id,is_sample")
      .eq("id", row.announcement_id).maybeSingle();
    if (error || !announcement || announcement.is_sample || announcement.status !== "published") return null;
    const source = announcement.organization_id
      ? await admin.from("organizations").select("name").eq("id", announcement.organization_id).maybeSingle()
      : announcement.barangay_id ? await admin.from("barangays").select("name").eq("id", announcement.barangay_id).maybeSingle() : { data: { name: "Iligan City" }, error: null };
    Object.assign(data, {
      announcementTitle: escapeEmailText(announcement.title, 160),
      sourceName: escapeEmailText(source.data?.name || "Iligan City", 120),
      publishedAt: announcement.publish_at ? escapeEmailText(new Date(announcement.publish_at).toLocaleDateString("en-PH", { dateStyle: "long", timeZone: "Asia/Manila" }), 80) : "Today",
      body: escapeEmailText(announcement.body, 1200),
    });
  }

  if (row.consultation_id) {
    const [{ data: consultation, error }, { data: response }] = await Promise.all([
      admin.from("consultations").select("title,body,status,barangay_id,organization_id,report_id,is_sample").eq("id", row.consultation_id).maybeSingle(),
      admin.from("consultation_comments").select("body,official,hidden,created_at").eq("consultation_id", row.consultation_id).eq("official", true).eq("hidden", false).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (error || !consultation || consultation.is_sample) return null;
    const source = consultation.organization_id
      ? await admin.from("organizations").select("name").eq("id", consultation.organization_id).maybeSingle()
      : consultation.barangay_id ? await admin.from("barangays").select("name").eq("id", consultation.barangay_id).maybeSingle() : { data: { name: "Iligan City" }, error: null };
    const report = consultation.report_id ? await admin.from("reports").select("title,is_demo").eq("id", consultation.report_id).maybeSingle() : { data: null, error: null };
    if (report.data?.is_demo) return null;
    Object.assign(data, {
      consultationTitle: escapeEmailText(consultation.title, 160),
      sourceName: escapeEmailText(source.data?.name || "Iligan City", 120),
      response: escapeEmailText(response?.body || consultation.body, 1200),
      reportTitle: escapeEmailText(report.data?.title || "Community update", 160),
    });
  }
  return paramsFor(row.event_key, firstName(String(profile.display_name || "")), data);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply({ error: "Use the internal email dispatch request." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!supabaseUrl || !serviceKey) return reply({ error: "Transactional email is not fully configured." }, 503);

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "Unauthorized." }, 401);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: allowed, error: authError } = await admin.rpc("is_email_dispatch_authorized", { p_token: token });
  if (authError || allowed !== true) return reply({ error: "Unauthorized." }, 401);
  if (!apiKey) return reply({ error: "Transactional email is not fully configured." }, 503);

  const { data: queue, error: queueError } = await admin.rpc("claim_email_outbox", { p_limit: 20 });
  if (queueError) return reply({ error: "Could not read the email queue." }, 503);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of (queue ?? []) as OutboxRow[]) {
    const finish = async (success: boolean, messageId: string | null, errorText: string | null, retryable = false) => {
      const { error } = await admin.rpc("finish_email_outbox", {
        p_id: row.id, p_success: success, p_message_id: messageId,
        p_error: errorText, p_retryable: retryable,
      });
      if (error) console.error("Email outbox completion failed", row.id);
    };
    try {
      const [{ data: profile, error: profileError }, { data: authUser, error: userError }] = await Promise.all([
        admin.from("profiles").select("display_name,role,account_status,notifications_enabled").eq("id", row.recipient_id).maybeSingle(),
        admin.auth.admin.getUserById(row.recipient_id),
      ]);
      if (profileError || userError) throw new Error("recipient_lookup_failed");
      const requiredMeetingSchedule = row.event_key === "meeting_update" && row.notification_title === "Your meeting schedule has been confirmed";
      if (!profile || profile.account_status !== "active" || (!profile.notifications_enabled && row.event_key !== "report_received" && !requiredMeetingSchedule)) {
        await finish(false, null, "Recipient is inactive or notifications are disabled.");
        skipped++;
        continue;
      }
      const email = authUser.user?.email?.trim();
      if (!email || !authUser.user?.email_confirmed_at) {
        await finish(false, null, "Recipient has no confirmed email address.");
        skipped++;
        continue;
      }
      const templateId = brevoTemplateIds[row.event_key];
      const params = await readEvent(admin, row, profile as Record<string, unknown>);
      if (!params) {
        await finish(false, null, "The linked record is unavailable or is presentation data.");
        skipped++;
        continue;
      }
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ templateId, to: [{ email, name: String(profile.display_name || "Iligan Connect").replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 100) }], params, tags: [`iligan-connect:${row.event_key}`] }),
        signal: AbortSignal.timeout(12000),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        await finish(false, null, `Brevo returned HTTP ${response.status}.`, retryable);
        failed++;
        continue;
      }
      await finish(true, typeof responseBody.messageId === "string" ? responseBody.messageId : null, null);
      sent++;
    } catch {
      await finish(false, null, "Email delivery failed before provider confirmation.", true);
      failed++;
    }
  }
  return reply({ claimed: queue?.length ?? 0, sent, skipped, failed });
});
