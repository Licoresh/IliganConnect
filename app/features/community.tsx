import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Image, Keyboard, Linking, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { textInputError, SHORT_REASON_LIMIT, characterLimitHint, Lookup, label, consultationPhase, formatMeetingTimeRange, meetingDateInput, normalizeGoogleMeetUrl } from "@community/shared";
import { db, result } from "../lib/client";
import { styles as s, Button, Field, Choices, SelectionSheet, PhotoViewer, AppBackNavigation, colors, categoryDescriptionFor, categoryDisplayName, categoryIconFor, categoryToneFor } from "../components/ui";
import { ListSkeleton } from "../components/loading";
type Consultation = {
  id: string;
  title: string;
  body: string;
  status: string;
  outcome: string | null;
  opens_at: string;
  closes_at: string;
  barangay_id: string;
  organization_id: string | null;
  report_id: string | null;
  category_name: string | null;
};
type MeetingParticipant = {
  request_id: string;
  resident_id: string;
  resident_name: string;
  joined_at: string;
  participant_count: number;
};
export function Community({
  barangays,
  categories,
  defaultBarangay = "",
  initialTab = "consultations",
  initialConsultationId,
  initialMeetingRequestId,
  onPageNavigate,
  residentId,
}: {
  barangays: Lookup[];
  categories: Lookup[];
  defaultBarangay?: string;
  initialTab?: "consultations" | "meetings" | "request";
  initialConsultationId?: string | null;
  initialMeetingRequestId?: string | null;
  onPageNavigate?: () => void;
  residentId: string;
}) {
  const [tab, setTab] = useState<string>(initialTab),
    [selected, setSelected] = useState<string | null>(initialConsultationId ?? null),
    [meetingTarget, setMeetingTarget] = useState(initialMeetingRequestId ?? ""),
    [search, setSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState(""),
    [area, setArea] = useState(""),
    [participation, setParticipation] = useState("all"),
    [meetingScope, setMeetingScope] = useState("barangay"),
    [participationMode, setParticipationMode] = useState<"open" | "closed">("closed"),
    [expandedMeeting, setExpandedMeeting] = useState<string | null>(initialMeetingRequestId ?? null),
    [page, setPage] = useState(0),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [barangay, setBarangay] = useState(defaultBarangay),
    [category, setCategory] = useState(""),
    [categoryPickerOpen, setCategoryPickerOpen] = useState(false),
    [report, setReport] = useState(""),
    [offices, setOffices] = useState<string[]>([]),
    [officePickerOpen, setOfficePickerOpen] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const { width: screenWidth } = useWindowDimensions();
  const requestSubmission = useRef(false);
  function navigateTab(next: string) {
    if (next !== tab) onPageNavigate?.();
    setTab(next);
    setPage(0);
  }
  useEffect(() => {
    const timer = setTimeout(() => { setAppliedSearch(search.trim()); setPage(0); }, 280);
    return () => clearTimeout(timer);
  }, [search]);
  const ownReports = useQuery({
    queryKey: ["meeting-report-options", residentId],
    enabled: tab === "request",
    queryFn: () => result<{ id: string; title: string; category_id: string; barangay_id: string }[]>(db!.from("reports").select("id,title,category_id,barangay_id").eq("resident_id", residentId).order("created_at", { ascending: false }).limit(50)),
  });
  const linkedMeetingReport = ownReports.data?.find((item) => item.id === report);
  const meetingBarangay = linkedMeetingReport?.barangay_id ?? barangay;
  const meetingOffices = useQuery({
    queryKey: ["meeting-request-offices", residentId],
    enabled: tab === "request",
    queryFn: async () => (await result<{ id: string; name: string; active: boolean; can_consult: boolean; can_coordinate: boolean }[]>(
      db!.from("organizations").select("id,name,active,can_consult,can_coordinate").eq("active", true).order("name"),
    )).filter((office) => office.can_consult || office.can_coordinate),
  });
  const q = useQuery({
    queryKey: ["community", residentId, tab, appliedSearch, area, participation, meetingScope, page, meetingTarget],
    enabled: tab !== "request",
    refetchInterval: 30_000,
    queryFn: async () => {
      const now = new Date().toISOString();
      let topics = db!
          .from("consultations")
          .select("id,title,body,status,outcome,opens_at,closes_at,barangay_id,organization_id,report_id")
          .in("status", ["open", "closed", "archived"])
          .order("created_at", { ascending: false })
          .range(page * 20, page * 20 + 19);
      let searchFilter = "";
      if (tab === "consultations" && appliedSearch) {
        const term = appliedSearch.replace(/[,%_()."\\]/g, " ").trim();
        if (term) {
          const parts = [`title.ilike.%${term}%`, `body.ilike.%${term}%`];
          const matchingBarangays = barangays.filter((item) => item.name.toLocaleLowerCase().includes(term.toLocaleLowerCase())).map((item) => item.id);
          if (matchingBarangays.length) parts.push(`barangay_id.in.(${matchingBarangays.join(",")})`);
          const matchingCategories = categories.filter((item) => item.name.toLocaleLowerCase().includes(term.toLocaleLowerCase())).map((item) => item.id);
          if (matchingCategories.length) {
            const matchingReports = await result<{ id: string }[]>(db!.from("reports").select("id").in("category_id", matchingCategories));
            if (matchingReports.length) parts.push(`report_id.in.(${matchingReports.map((item) => item.id).join(",")})`);
          }
          searchFilter = `or(${parts.join(",")})`;
        }
      }
      if (area) topics = topics.eq("barangay_id", area);
      if (participation === "open") topics = topics.eq("status", "open").lte("opens_at", now).gte("closes_at", now);
      if (participation === "closed") {
        const statusFilter = `or(status.eq.closed,status.eq.archived,and(status.eq.open,closes_at.lt.${now}))`;
        topics = topics.or(searchFilter ? `and(${searchFilter},${statusFilter})` : statusFilter);
      } else if (searchFilter) topics = topics.or(searchFilter);
      let acceptedBarangayRequests: string[] = [];
      if (tab === "meetings" && !meetingTarget && meetingScope === "barangay" && defaultBarangay) {
        const [invitations, joinedMeetings] = await Promise.all([
          result<{ request_id: string }[]>(db!.from("meeting_request_barangays")
            .select("request_id").eq("barangay_id", defaultBarangay).eq("status", "accepted")),
          result<{ request_id: string }[]>(db!.from("meeting_resident_participants")
            .select("request_id").eq("resident_id", residentId)),
        ]);
        acceptedBarangayRequests = [...new Set([
          ...invitations.map((invitation) => invitation.request_id),
          ...joinedMeetings.map((meeting) => meeting.request_id),
        ])];
      }
      let requests = db!.from("meeting_requests")
        .select("id,title,body,status,decision_reason,barangay_id,resident_id,category_id,report_id,created_at,coordination_status,participation_mode,is_sample")
        .order("created_at", { ascending: false })
        .range(page * 20, page * 20 + 19);
      if (meetingTarget) requests = requests.eq("id", meetingTarget);
      else if (tab === "meetings" && meetingScope === "yours") requests = requests.eq("resident_id", residentId);
      else if (tab === "meetings" && defaultBarangay) {
        requests = acceptedBarangayRequests.length
          ? requests.or(`barangay_id.eq.${defaultBarangay},id.in.(${acceptedBarangayRequests.join(",")})`)
          : requests.eq("barangay_id", defaultBarangay);
      }
      if (tab === "meetings" && appliedSearch) {
        const term = appliedSearch.replace(/[,%_()."\\]/g, " ").trim();
        if (term) {
          const parts = [`title.ilike.%${term}%`, `body.ilike.%${term}%`];
          const matchingBarangays = barangays.filter((item) => item.name.toLocaleLowerCase().includes(term.toLocaleLowerCase())).map((item) => item.id);
          const matchingCategories = categories.filter((item) => item.name.toLocaleLowerCase().includes(term.toLocaleLowerCase())).map((item) => item.id);
          if (matchingBarangays.length) parts.push(`barangay_id.in.(${matchingBarangays.join(",")})`);
          if (matchingCategories.length) parts.push(`category_id.in.(${matchingCategories.join(",")})`);
          requests = requests.or(parts.join(","));
        }
      }
      const topicRows = tab === "consultations" ? await result<Omit<Consultation, "category_name">[]>(topics) : [];
      const reportIds = [...new Set(topicRows.flatMap((item) => item.report_id ? [item.report_id] : []))];
      const linkedReports = reportIds.length ? await result<{ id: string; category_id: string }[]>(db!.from("reports").select("id,category_id").in("id", reportIds)) : [];
      const categoriesByReport = new Map(linkedReports.map((item) => [item.id, categories.find((category) => category.id === item.category_id)?.name ?? null]));
      const requestRows = tab === "meetings" ? await result<{
        id: string; title: string; body: string; status: string; decision_reason: string | null;
        barangay_id: string; resident_id: string; category_id: string | null; report_id: string | null;
        created_at: string; coordination_status: string; participation_mode: "open" | "closed"; is_sample: boolean;
      }[]>(requests) : [];
      const schedules = requestRows.length ? await result<{
        request_id: string; starts_at: string; ends_at: string; completed: boolean;
      }[]>(db!.from("meetings").select("request_id,starts_at,ends_at,completed").in("request_id", requestRows.map((item) => item.id))) : [];
      const invitedOffices = requestRows.length ? await result<{
        request_id: string; status: "pending" | "accepted" | "declined"; organizations: { name: string }[] | null;
      }[]>(db!.from("meeting_request_offices").select("request_id,status,organizations(name)").in("request_id", requestRows.map((item) => item.id))) : [];
      const invitedBarangays = requestRows.length ? await result<{
        request_id: string; barangay_id: string; status: "pending" | "accepted" | "declined";
      }[]>(db!.from("meeting_request_barangays").select("request_id,barangay_id,status").in("request_id", requestRows.map((item) => item.id))) : [];
      const participants = requestRows.length ? await result<MeetingParticipant[]>(db!.rpc("meeting_request_participants", {
        p_requests: requestRows.map((item) => item.id),
      })) : [];
      return {
      consultations: topicRows.map((item) => ({ ...item, category_name: item.report_id ? categoriesByReport.get(item.report_id) ?? null : null })),
      requests: requestRows.map((item) => ({
        ...item,
        schedule: schedules.find((meeting) => meeting.request_id === item.id) ?? null,
        invitations: invitedOffices.filter((invitation) => invitation.request_id === item.id),
        barangayInvitations: invitedBarangays.filter((invitation) => invitation.request_id === item.id),
        participants: participants.filter((participant) => participant.request_id === item.id),
      })),
      supports: tab === "meetings" ? await result<{ request_id: string }[]>(
        db!.from("meeting_supporters").select("request_id"),
      ) : [],
    }; },
  });
  const consultations = q.data?.consultations;
  const currentPageCount = tab === "consultations"
    ? (q.data?.consultations.length ?? 0)
    : (q.data?.requests.length ?? 0);
  useEffect(() => {
    if (Platform.OS !== "android" || !selected) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { setSelected(null); return true; });
    return () => listener.remove();
  }, [!!selected]);
  const selectedMeetingCategory = categories.find((item) => item.id === category);
  const selectedMeetingCategoryTone = selectedMeetingCategory ? categoryToneFor(selectedMeetingCategory.name) : { background: colors.brandSoft, foreground: colors.brand };
  async function save(
    p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
    successMessage = "Saved.",
    failureMessage = "We couldn’t save that update. Please try again.",
  ) {
    setBusy(true);
    setMessage("");
    try {
      await result(p);
      setMessage(successMessage);
      await qc.invalidateQueries({ queryKey: ["community"] });
      return true;
    } catch {
      setMessage(failureMessage);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submitMeetingRequest() {
    const problem = textInputError(title, { min: 8, max: 100, required: true }) || textInputError(body, { min: 20, max: 500, required: true });
    if (problem) { setMessage(problem); return; }
    if (requestSubmission.current) return;
    requestSubmission.current = true;
    try {
      const destination = barangays.find((item) => item.id === meetingBarangay)?.name ?? "the selected barangay";
      const saved = await save(
        db!.rpc("submit_meeting_request", {
          p_title: title.trim(),
          p_body: body.trim(),
          p_barangay: meetingBarangay,
          p_category: category || null,
          p_report: report || null,
          p_organizations: offices,
          p_participation_mode: participationMode,
        }),
        `Your request was sent to ${destination}. Track the review under Meetings.`,
        "We couldn’t send your request. Check your connection and try again; your details are still here.",
      );
      if (saved) {
        setTitle("");
        setBody("");
        setReport("");
        setCategory("");
        setParticipationMode("closed");
        setOffices([]);
        setOfficePickerOpen(false);
        setBarangay(defaultBarangay);
        setPage(0);
        setSearch("");
        setArea("");
        setMeetingTarget("");
        setMeetingScope("yours");
        navigateTab("meetings");
      }
    } finally {
      requestSubmission.current = false;
    }
  }
  if (selected)
    return <Conversation id={selected} initial={q.data?.consultations.find((item) => item.id === selected)} close={() => { onPageNavigate?.(); setSelected(null); }} residentId={residentId} categories={categories} barangays={barangays} />;
  const communityTabs = [
    { id: "consultations", name: "Conversations", icon: "chatbubbles-outline" as const },
    { id: "meetings", name: "Meetings", icon: "calendar-outline" as const },
    { id: "request", name: "Request\na meeting", icon: "calendar-number-outline" as const },
  ];
  return (
    <>
      <View style={{ minHeight: 140, justifyContent: "center", overflow: "hidden", paddingHorizontal: 18, paddingVertical: 18, borderRadius: 24, borderWidth: 1, borderColor: "#dcece8", backgroundColor: "#edf8f5" }}>
        <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: "absolute", right: 0, bottom: 0, width: "100%", height: "100%", opacity: 0.78 }}>
          <Image source={require("../assets/iligan-community-profile-header.jpg")} resizeMode="cover" resizeMethod="resize" style={{ width: "100%", height: "100%" }} />
        </View>
        <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "70%", backgroundColor: "#ffffff35" }} />
        <Text accessibilityRole="header" style={[s.heading, { maxWidth: 270, fontSize: 32, lineHeight: 39, marginBottom: 8 }]}>Community</Text>
        <Text style={[s.subtitle, { maxWidth: 260, marginBottom: 0, fontSize: 15, lineHeight: 22 }]}>Local conversations, meeting updates, and ways to take part.</Text>
      </View>
      <View style={{ minHeight: 92, flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 22, backgroundColor: "#f1fbf8", borderWidth: 1, borderColor: "#dcefe9" }}>
        <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: "#e2f6f1", alignItems: "center", justifyContent: "center" }}><Ionicons name="people-outline" size={25} color={colors.brand} /></View>
        <View style={{ flex: 1, gap: 5 }}><Text style={{ color: colors.brandDark, fontSize: 16, lineHeight: 21, fontWeight: "800" }}>Your community, in one place</Text><Text style={[s.small, { fontSize: 13, lineHeight: 19 }]}>Read local updates and help shape what happens next.</Text></View>
      </View>
      <View style={{ flexDirection: "row", gap: 5, padding: 5, borderRadius: 20, borderWidth: 1, borderColor: "#e2ebf1", backgroundColor: "white" }}>
        {communityTabs.map((item) => {
          const active = tab === item.id;
          return <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.id === "request" ? "Request a meeting" : item.name} accessibilityState={{ selected: active }} onPress={() => navigateTab(item.id)} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 72, paddingHorizontal: 7, paddingVertical: 7, borderRadius: 15, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: active ? "#e8f7f3" : "transparent" }, pressed && { opacity: 0.78 }]}>
            <Ionicons name={item.icon} size={20} color={active ? colors.brand : colors.muted} />
            <Text style={{ flexShrink: 1, textAlign: "center", color: active ? colors.brand : colors.muted, fontSize: 12, lineHeight: 16, fontWeight: active ? "800" : "600" }}>{item.name}</Text>
          </Pressable>;
        })}
      </View>
      {message && (
        <Text accessibilityRole="alert" style={s.body}>
          {message}
        </Text>
      )}
      {tab === "consultations" && (
        <>
        <View style={[s.card, { gap: 16, padding: 17 }]}>
          <View style={{ gap: 10 }}><Text style={[s.fieldLabel, { fontSize: 16 }]}>Find a community update</Text><Field maxLength={200} label="Search topics" placeholder="Search conversations" value={search} onChangeText={(value) => { setSearch(value); setPage(0); }} leading={<Ionicons name="search-outline" size={19} color={colors.muted} />} />{appliedSearch !== search.trim() && <Text style={s.small}>Updating results…</Text>}</View>
          <Choices compact title="Filter by barangay" sheetTitle="Choose a barangay" subtitle="See conversations from a specific barangay." items={[{ id: "", name: "All barangays" }, ...barangays]} value={area} onChange={(value) => { setArea(value); setPage(0); }} leadingIcon="location-outline" myBarangayId={defaultBarangay || undefined} />
          <Choices columns={3} items={[{ id: "all", name: "All topics" }, { id: "open", name: "Open to join" }, { id: "closed", name: "Closed" }]} value={participation} onChange={(value) => { setParticipation(value); setPage(0); }} />
        </View>
        {(search || area || participation !== "all") && <Button secondary title="Clear community filters" onPress={() => { setSearch(""); setArea(""); setParticipation("all"); setPage(0); }} />}
        </>
      )}
      {tab === "meetings" && <View style={[s.card, { gap: 16, padding: 17 }]}>
        <View style={{ gap: 10 }}><Text style={[s.fieldLabel, { fontSize: 16 }]}>Find a meeting update</Text><Field maxLength={200} label="Search meetings" placeholder="Search meeting requests" value={search} onChangeText={(value) => { setSearch(value); setPage(0); }} leading={<Ionicons name="search-outline" size={19} color={colors.muted} />} />{appliedSearch !== search.trim() && <Text style={s.small}>Updating results…</Text>}</View>
        <View style={{ gap: 10 }}>
          <View style={{ gap: 3 }}><Text style={s.fieldLabel}>Browse meetings</Text><Text style={s.small}>Choose the list you want to see.</Text></View>
          <View accessibilityRole="radiogroup" accessibilityLabel="Meeting list" style={{ flexDirection: screenWidth < 460 ? "column" : "row", gap: 9 }}>
            {[
              { id: "barangay", name: "Barangay meetings", detail: "Local meetings and accepted invites", icon: "business-outline" as const },
              { id: "yours", name: "Your requests", detail: "Requests you sent to any barangay", icon: "person-outline" as const },
            ].map((option) => {
              const active = meetingScope === option.id;
              return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => { setMeetingScope(option.id); setPage(0); }} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 66, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: active ? colors.brand : colors.line, backgroundColor: active ? "#eff9f6" : "white" }, pressed && { opacity: 0.82 }]}>
                <View style={{ width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: active ? colors.brandSoft : "#f1f5f7" }}><Ionicons name={option.icon} size={19} color={active ? colors.brand : colors.muted} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={{ color: colors.brandDark, fontSize: 13, lineHeight: 17, fontWeight: "800" }}>{option.name}</Text><Text style={[s.small, { fontSize: 11, lineHeight: 15 }]}>{option.detail}</Text></View>
                <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={19} color={active ? colors.brand : colors.line} />
              </Pressable>;
            })}
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 10, borderRadius: 12, backgroundColor: "#f5f8fa" }}><Ionicons name="information-circle-outline" size={16} color={colors.muted} style={{ marginTop: 1 }} /><Text style={[s.small, { flex: 1 }]}>{meetingScope === "yours" ? "Your requests stay here while the barangay reviews them, including requests sent elsewhere." : "This list includes meetings in your barangay and open meetings shared with your barangay after an accepted invite."}</Text></View>
        </View>
      </View>}
      {tab !== "request" && q.isPending && <ListSkeleton variant={tab === "consultations" ? "discussion" : "meeting"} count={3} label={`Loading ${tab === "consultations" ? "community discussions" : "meeting requests"}`} />}
      {tab !== "request" && q.error && <View style={s.card}><Text accessibilityRole="alert" style={s.error}>Couldn’t load community updates. Check your connection and try again.</Text><Button secondary title="Try again" loading={q.isFetching} onPress={() => void q.refetch()} /></View>}
      {tab === "consultations" && (
        <>
          {consultations?.map((c) => {
            const phase = consultationPhase(c);
            const open = phase === "open";
            return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${phase === "closed" ? "Read discussion" : "Open conversation"}: ${c.title}`}
              accessibilityHint={`${barangays.find((b) => b.id === c.barangay_id)?.name ?? "Iligan City"} community conversation`}
              style={({ pressed }) => [s.card, { gap: 14, borderColor: "#e3ecef", padding: 18, shadowOpacity: 0.035 }, pressed && { backgroundColor: "#f6fbf9" }]}
              key={c.id}
              onPress={() => { onPageNavigate?.(); setSelected(c.id); }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.brand} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.brand, fontSize: 12, fontWeight: "800" }}>{barangays.find((b) => b.id === c.barangay_id)?.name ?? "Iligan City"}</Text><Text style={s.small}>Community conversation{c.category_name ? ` · ${c.category_name}` : ""}</Text></View>
                <View style={{ paddingHorizontal: 9, paddingVertical: 6, borderRadius: 13, backgroundColor: open ? "#e8f7f0" : phase === "scheduled" ? "#eaf2ff" : "#eef3f8" }}><Text style={{ color: open ? "#146f50" : phase === "scheduled" ? "#315b92" : colors.muted, fontSize: 10, fontWeight: "800" }}>{open ? "OPEN" : phase === "scheduled" ? "SOON" : "CLOSED"}</Text></View>
              </View>
              <Text style={[s.title, { marginTop: 1 }]}>{c.title}</Text>
              <Text numberOfLines={3} style={s.body}>
                {c.body}
              </Text>
              <View style={[s.row, { gap: 6 }]}><Ionicons name="time-outline" size={15} color={colors.muted} /><Text style={s.small}>{phase === "scheduled" ? "Opens" : phase === "open" ? "Closes" : "Closed"} {new Date(phase === "scheduled" ? c.opens_at : c.closes_at).toLocaleString()}</Text></View>
              {!!c.outcome && <Text style={[s.small, { color: colors.brand, fontWeight: "700" }]}>Recorded outcome available</Text>}
              <View style={{ minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2, paddingHorizontal: 14, borderRadius: 15, backgroundColor: open ? "#e9f8f4" : "#f4f7f9" }}><Text style={[s.small, { color: open ? colors.brand : colors.brandDark, fontSize: 13, fontWeight: "800" }]}>{open ? "Join the conversation" : c.outcome ? "Read outcome" : "View discussion"}</Text><Ionicons name="chevron-forward" size={19} color={open ? colors.brand : colors.muted} /></View>
            </Pressable>
            );
          })}
          {!consultations?.length && !q.isPending && !q.error && (
            <View style={[s.card, { alignItems: "center", paddingVertical: 24, gap: 8 }]}><View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: "#eaf7f3", alignItems: "center", justifyContent: "center" }}><Ionicons name="chatbubbles-outline" size={22} color={colors.brand} /></View><Text style={s.title}>No conversations found</Text><Text style={[s.small, { textAlign: "center" }]}>Try another search or reset your community filters.</Text>{(search || area || participation !== "all") && <Button secondary title="Reset filters" onPress={() => { setSearch(""); setArea(""); setParticipation("all"); setPage(0); }} />}</View>
          )}
          {q.isSuccess && (
            <View style={s.card}>
              <View style={s.row}>
                <View style={s.notificationIcon}>
                  <Ionicons name="people-outline" size={19} color={colors.brand} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.title}>Have a topic to discuss?</Text>
                  <Text style={s.small}>Request a community meeting and follow the recorded decision.</Text>
                </View>
              </View>
              <Button secondary title="Request a meeting" onPress={() => navigateTab("request")} />
            </View>
          )}
        </>
      )}
      {tab === "meetings" && (
        <>
          {!!meetingTarget && <Button secondary title="Show all meeting requests" onPress={() => { setMeetingTarget(""); setPage(0); }} />}
          {q.data?.requests.map((r) => {
            const state = meetingStatus(r.status, r.schedule, r.coordination_status);
            const categoryName = categories.find((item) => item.id === r.category_id)?.name;
            const acceptedInvitations = r.invitations.filter((invitation) => invitation.status === "accepted").length;
            const waitingInvitations = r.invitations.filter((invitation) => invitation.status === "pending").length;
            const declinedInvitations = r.invitations.filter((invitation) => invitation.status === "declined").length;
            const acceptedBarangayInvitations = r.barangayInvitations.filter((invitation) => invitation.status === "accepted").length;
            const waitingBarangayInvitations = r.barangayInvitations.filter((invitation) => invitation.status === "pending").length;
            const joined = r.participants.some((participant) => participant.resident_id === residentId);
            const meetingDate = r.schedule ? meetingDateInput(r.schedule.starts_at) : "";
            const hasMeetingDate = !!meetingDate;
            const meetingDay = hasMeetingDate ? meetingDate.slice(-2) : "";
            const meetingMonth = hasMeetingDate
              ? new Intl.DateTimeFormat("en-PH", { month: "short", timeZone: "Asia/Manila" }).format(new Date(r.schedule!.starts_at)).toUpperCase()
              : "";
            const canJoin = r.participation_mode === "open" && r.status === "approved" && !r.schedule?.completed && (
              r.resident_id === residentId || r.barangay_id === defaultBarangay ||
              r.barangayInvitations.some((invitation) => invitation.barangay_id === defaultBarangay && invitation.status === "accepted")
            );
            return <View style={[s.card, { gap: 14, padding: 18 }]} key={r.id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View accessible accessibilityRole="image" accessibilityLabel={hasMeetingDate ? `Meeting date ${meetingDay} ${meetingMonth}` : "Meeting date not set"} style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: hasMeetingDate ? "#e4f6f1" : "#edf3fb", alignItems: "center", justifyContent: "center", gap: 0 }}>
                  {hasMeetingDate ? <><Text style={{ color: colors.brandDark, fontSize: 17, lineHeight: 19, fontWeight: "800" }}>{meetingDay}</Text><Text style={{ color: colors.brand, fontSize: 9, lineHeight: 12, fontWeight: "800", letterSpacing: 0.7 }}>{meetingMonth}</Text></> : <Ionicons name="calendar-outline" size={22} color="#426ca6" />}
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={[s.eyebrow, { marginBottom: 0 }]}>MEETING REQUEST</Text><View style={{ alignSelf: "flex-start", borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: state.background }}><Text style={{ color: state.foreground, fontSize: 11, lineHeight: 15, fontWeight: "700" }}>{state.label}</Text></View></View>
                <Ionicons name={expandedMeeting === r.id ? "chevron-up" : "chevron-forward"} size={18} color={colors.muted} />
              </View>
              <Text style={[s.title, { fontSize: 18, lineHeight: 24 }]}>{r.title}</Text>
              <View style={{ alignSelf: "flex-start", borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: r.participation_mode === "open" ? "#e4f6ef" : "#f0f3f6" }}><Text style={{ color: r.participation_mode === "open" ? "#146f50" : colors.muted, fontSize: 11, fontWeight: "800" }}>{r.participation_mode === "open" ? "OPEN TO JOIN" : "CLOSED MEETING"}</Text></View>
              {r.is_sample && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 11, borderRadius: 13, borderWidth: 1, borderColor: "#d6eee8", backgroundColor: "#f0faf7" }}><Ionicons name="information-circle-outline" size={18} color={colors.brand} style={{ marginTop: 1 }} /><View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.brandDark, fontSize: 12, lineHeight: 16, fontWeight: "800" }}>Practice meeting</Text><Text style={[s.small, { lineHeight: 17 }]}>You can try joining and leaving here. This is not an official event.</Text></View></View>}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="location-outline" size={15} color={colors.brand} /><Text style={s.small}>{barangays.find((item) => item.id === r.barangay_id)?.name ?? "Iligan City"}{categoryName ? ` · ${categoryName}` : ""}</Text></View>
              <Text style={[s.small, { color: colors.brandDark }]}>{state.detail}</Text>
              {!!r.schedule && <View style={{ flexDirection: "row", alignItems: "center", gap: 7, padding: 10, borderRadius: 12, backgroundColor: "#f0f8f6" }}><Ionicons name="calendar-outline" size={16} color={colors.brand} /><Text style={[s.small, { flex: 1, color: colors.brandDark, fontWeight: "700" }]}>{formatMeetingTimeRange(r.schedule.starts_at, r.schedule.ends_at)}</Text></View>}
              <Text style={s.body}>{r.body}</Text>
              {!!r.invitations.length && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 7 }}><Ionicons name="people-outline" size={16} color={colors.muted} style={{ marginTop: 1 }} /><Text style={[s.small, { flex: 1 }]}>Office replies: {acceptedInvitations} accepted · {waitingInvitations} awaiting · {declinedInvitations} declined</Text></View>}
              {!!r.barangayInvitations.length && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 7 }}><Ionicons name="business-outline" size={16} color={colors.muted} style={{ marginTop: 1 }} /><Text style={[s.small, { flex: 1 }]}>Barangay invitations: {acceptedBarangayInvitations} accepted · {waitingBarangayInvitations} awaiting</Text></View>}
              {!!r.participants.length && <View style={{ gap: 4, padding: 11, borderRadius: 13, backgroundColor: "#f2faf7" }}>
                <Text style={{ color: colors.brandDark, fontSize: 12, fontWeight: "800" }}>Participants ({r.participants[0].participant_count})</Text>
                <Text style={s.small}>{r.participants.slice(0, 5).map((participant) => participant.resident_name).join(", ")}{r.participants[0].participant_count > 5 ? ` and ${r.participants[0].participant_count - 5} more` : ""}</Text>
              </View>}
              {canJoin && <Button secondary disabled={busy} title={joined ? "Joined · Leave meeting" : "Join open meeting"} onPress={() => void save(
                joined ? db!.rpc("leave_meeting_request", { p_request: r.id }) : db!.rpc("join_meeting_request", { p_request: r.id }),
                joined ? (r.is_sample ? "You left this practice meeting." : "You left this meeting.") : (r.is_sample ? "You joined this practice meeting. Use the same button to leave when you’re done." : "You joined this meeting. Meeting updates will be sent to your notifications."),
                "We couldn’t update your participation. Please try again.",
              )} />}
              {r.participation_mode === "open" && r.status !== "approved" && <Text style={s.small}>Residents can join after the meeting request is approved.</Text>}
              {r.decision_reason && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 13, backgroundColor: "#f0f8f6" }}><Ionicons name="document-text-outline" size={17} color={colors.brand} style={{ marginTop: 2 }} /><Text style={[s.small, { flex: 1, color: colors.brandDark }]}><Text style={{ fontWeight: "800" }}>Decision: </Text>{r.decision_reason}</Text></View>}
              {r.status === "pending" && (
                <Button
                  secondary
                  disabled={busy}
                  title={
                    q.data.supports.some((x) => x.request_id === r.id)
                      ? "Supported · Withdraw support"
                      : "Support this request"
                  }
                  onPress={() =>
                    void save(
                      q.data.supports.some((x) => x.request_id === r.id)
                        ? db!
                            .from("meeting_supporters")
                            .delete()
                            .eq("request_id", r.id)
                        : db!
                            .from("meeting_supporters")
                            .insert({ request_id: r.id }),
                    )
                  }
                />
              )}
              <Pressable accessibilityRole="button" accessibilityLabel={expandedMeeting === r.id ? "Hide meeting details" : "View meeting details"} accessibilityState={{ expanded: expandedMeeting === r.id }} onPress={() => setExpandedMeeting(expandedMeeting === r.id ? null : r.id)} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderRadius: 13, backgroundColor: "#eef9f6" }, pressed && { opacity: 0.8 }]}><Text style={{ flex: 1, color: colors.brand, fontSize: 13, fontWeight: "800" }}>{expandedMeeting === r.id ? "Hide meeting details" : "View location, online link & follow-up"}</Text><Ionicons name={expandedMeeting === r.id ? "chevron-up" : "chevron-forward"} size={18} color={colors.brand} /></Pressable>
              {expandedMeeting === r.id && <MeetingDetails requestId={r.id} requestStatus={r.status} />}
            </View>;
          })}
          {!q.data?.requests.length && !q.isPending && !q.error && <View style={[s.card, { alignItems: "center", paddingVertical: 22, gap: 7 }]}><View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: "#eaf7f3", alignItems: "center", justifyContent: "center" }}><Ionicons name="calendar-outline" size={21} color={colors.brand} /></View><Text style={s.title}>{meetingScope === "yours" ? "No requests yet" : "No barangay meetings found"}</Text><Text style={[s.small, { textAlign: "center" }]}>{search ? "Try a different meeting search." : meetingScope === "yours" ? "Meeting requests you send to any barangay will appear here." : "Open meetings and accepted cross-barangay invitations will appear here."}</Text>{search ? <Button secondary title="Clear search" onPress={() => { setSearch(""); setPage(0); }} /> : <Button title="Request a meeting" onPress={() => navigateTab("request")} />}</View>}
        </>
      )}
      {tab === "request" && (
          <View style={[s.card, { gap: 18, padding: 18 }]}>
          <View style={{ minHeight: 104, flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 18, backgroundColor: "#f0faf7" }}><View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: "#def4ee", alignItems: "center", justifyContent: "center" }}><Ionicons name="calendar-number-outline" size={24} color={colors.brand} /></View><View style={{ flex: 1, gap: 5 }}><Text style={[s.title, { fontSize: 18, lineHeight: 24 }]}>Request a meeting</Text><Text style={[s.small, { fontSize: 13, lineHeight: 19 }]}>Your barangay reviews the request and posts its decision here.</Text></View></View>
          <View accessibilityLabel="Meeting request steps" style={{ position: "relative", flexDirection: "row", alignItems: "flex-start", paddingVertical: 5 }}>
            <View pointerEvents="none" style={{ position: "absolute", top: 18, left: "16.667%", right: "16.667%", height: 2, backgroundColor: "#b8ded6" }} />
            {[{ n: "1", title: "Send request" }, { n: "2", title: "Barangay review" }, { n: "3", title: "See updates" }].map((step) => <View key={step.n} style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 7 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#e2f5ef", zIndex: 1 }}><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "800" }}>{step.n}</Text></View>
              <Text style={{ color: colors.brandDark, fontSize: 11, lineHeight: 15, fontWeight: "700", textAlign: "center" }}>{step.title}</Text>
            </View>)}
          </View>
          <Field
            label="What should the meeting be about?" required minLength={8} hint="Use 8–100 characters."
            placeholder="e.g. Streetlight maintenance, drainage concern, etc."
            value={title}
            onChangeText={setTitle}
            maxLength={100}
            leading={<Ionicons name="document-text-outline" size={19} color={colors.muted} />}
          />
          {!!characterLimitHint(title.length, 100) && <Text style={[s.small, { textAlign: "right", marginTop: -8 }]}>{characterLimitHint(title.length, 100)}</Text>}
          <Field
            label="What would you like to discuss?" required minLength={20} hint="Explain why a meeting would help. Use 20–500 characters."
            placeholder="Describe the concern and what you hope to discuss."
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={500}
            leading={<Ionicons name="create-outline" size={19} color={colors.muted} />}
            style={{ minHeight: 118, paddingTop: 14 }}
          />
          <View style={{ gap: 8 }}>
            <View style={{ gap: 3 }}><Text style={s.fieldLabel}>Who can participate?</Text><Text style={s.small}>Set who can join after the barangay reviews your request.</Text></View>
            <View accessibilityRole="radiogroup" accessibilityLabel="Who can participate?" style={{ gap: 8 }}>
              {[
                { id: "closed", title: "Closed meeting", detail: "Residents cannot join. Invited offices can still coordinate.", icon: "lock-closed-outline" as const },
                { id: "open", title: "Open meeting", detail: "Residents in this barangay can join after approval. Other barangays need an accepted invite.", icon: "people-outline" as const },
              ].map((option) => {
                const active = participationMode === option.id;
                return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => setParticipationMode(option.id as "open" | "closed")} style={({ pressed }) => [{ minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: active ? colors.brand : colors.line, backgroundColor: active ? "#eff9f6" : "white" }, pressed && { opacity: 0.82 }]}>
                  <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: active ? colors.brandSoft : "#f1f5f7" }}><Ionicons name={option.icon} size={20} color={active ? colors.brand : colors.muted} /></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={{ color: colors.brandDark, fontSize: 13, lineHeight: 17, fontWeight: "800" }}>{option.title}</Text><Text style={[s.small, { lineHeight: 17 }]}>{option.detail}</Text></View>
                  <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={20} color={active ? colors.brand : colors.line} />
                </Pressable>;
              })}
            </View>
          </View>
          <View style={{ gap: 7, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }}><Text style={s.fieldLabel}>Add context (optional)</Text><Text style={s.small}>Link a report to send this request to the barangay responsible for that report.</Text></View>
          {ownReports.isPending ? <ListSkeleton variant="report" count={1} label="Loading your reports" /> : ownReports.error ? <View style={{ gap: 8 }}><Text style={s.error}>Your reports could not be loaded. You can still request a meeting without a linked report.</Text><Button secondary title="Retry report choices" onPress={() => void ownReports.refetch()} /></View> : <Choices compact title="Choose a related report" items={[{ id: "", name: "No linked report" }, ...(ownReports.data ?? []).map((r) => ({ id: r.id, name: r.title }))]} value={report} onChange={(id) => {
            setReport(id);
            const linked = ownReports.data?.find((item) => item.id === id);
            setBarangay(linked?.barangay_id ?? defaultBarangay);
            setCategory(linked?.category_id ?? "");
          }} />}
          {linkedMeetingReport ? <View style={{ gap: 6 }}>
            <Text style={s.fieldLabel}>Which barangay should review it? <Text style={{ color: "#b4453e" }}>*</Text></Text>
            <View accessibilityLabel={`Barangay locked to linked report: ${barangays.find((item) => item.id === meetingBarangay)?.name ?? "report barangay"}`} style={{ minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: "#f0faf7" }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="location-outline" size={19} color={colors.brand} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text numberOfLines={1} style={{ color: colors.brandDark, fontSize: 14, fontWeight: "700" }}>{barangays.find((item) => item.id === meetingBarangay)?.name ?? "Report barangay"}</Text><Text style={s.small}>Set by the linked report</Text></View>
              <Ionicons name="lock-closed-outline" size={17} color={colors.brand} />
            </View>
            <Text style={s.small}>Change or remove the linked report to choose a different barangay. The report category is linked automatically.</Text>
          </View> : <>
            <View style={{ gap: 6 }}><Text style={s.fieldLabel}>Which barangay should review it? <Text style={{ color: "#b4453e" }}>*</Text></Text><Text style={s.small}>Choose the barangay connected to this meeting.</Text><Choices compact title="Choose a barangay" sheetTitle="Choose a barangay" items={barangays} value={barangay} onChange={setBarangay} leadingIcon="location-outline" myBarangayId={defaultBarangay || undefined} /></View>
          <View style={{ gap: 7 }}>
            <Text style={s.fieldLabel}>Related category (optional)</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={selectedMeetingCategory ? `Change related category, currently ${categoryDisplayName(selectedMeetingCategory.name)}` : "Choose a related category, optional"} accessibilityState={{ expanded: categoryPickerOpen }} accessibilityHint="Opens the searchable report category selector" onPress={() => setCategoryPickerOpen(true)} style={({ pressed }) => [{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: categoryPickerOpen ? colors.brand : colors.line, backgroundColor: "white" }, pressed && { opacity: 0.82 }]}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: selectedMeetingCategoryTone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={selectedMeetingCategory ? categoryIconFor(selectedMeetingCategory.name) : "grid-outline"} size={19} color={selectedMeetingCategoryTone.foreground} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text numberOfLines={1} style={{ color: colors.brandDark, fontSize: 13, fontWeight: "700" }}>{selectedMeetingCategory ? categoryDisplayName(selectedMeetingCategory.name) : "Not specified"}</Text>
                <Text numberOfLines={1} style={s.small}>{selectedMeetingCategory ? categoryDescriptionFor(selectedMeetingCategory.name) : "Choose an optional category"}</Text>
              </View>
              <Ionicons name={categoryPickerOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
            </Pressable>
            <SelectionSheet
              visible={categoryPickerOpen}
              onClose={() => setCategoryPickerOpen(false)}
              title="Choose a report type"
              subtitle="Select the category related to your meeting request, or leave it unspecified."
              searchPlaceholder="Search report type"
              items={[
                { id: "", name: "Not specified", description: "Leave this optional detail blank.", icon: "grid-outline", tone: { background: colors.brandSoft, foreground: colors.brand }, featured: true },
                ...categories.map((item) => ({ id: item.id, name: categoryDisplayName(item.name), description: categoryDescriptionFor(item.name), icon: categoryIconFor(item.name), tone: categoryToneFor(item.name) })),
              ]}
              value={category}
              onConfirm={setCategory}
            />
          </View>
          </>}
          {ownReports.data?.length === 50 && <Text style={s.small}>Showing your 50 most recent reports.</Text>}
          <View style={{ gap: 7, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }}><Text style={s.fieldLabel}>Invite offices (optional)</Text><Text style={s.small}>Choose any offices you want to invite. They can accept or decline later.</Text></View>
          {meetingOffices.isPending ? <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}><ActivityIndicator size="small" color={colors.brand} /><Text style={s.small}>Loading available offices…</Text></View> : meetingOffices.error ? <View style={{ gap: 7 }}><Text style={s.small}>The office list is unavailable right now. You can still submit; the barangay can invite offices later.</Text><Button secondary title="Retry office list" onPress={() => void meetingOffices.refetch()} /></View> : meetingOffices.data?.length ? <View style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={offices.length ? `${offices.length} ${offices.length === 1 ? "office" : "offices"} selected` : "Choose offices to invite"}
              accessibilityState={{ expanded: officePickerOpen }}
              accessibilityHint="Opens a list where you can select more than one office."
              onPress={() => setOfficePickerOpen((open) => !open)}
              style={({ pressed }) => [{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 13, borderWidth: 1, borderColor: officePickerOpen ? colors.brand : colors.line, backgroundColor: "white" }, pressed && { opacity: 0.82 }]}
            >
              <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f7" }}><Ionicons name="business-outline" size={18} color={colors.brand} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "700" }}>{offices.length ? "Office invitations" : "Choose offices"}</Text>
                <Text numberOfLines={1} style={s.small}>{offices.length ? `${offices.length} selected` : "Select one or more offices"}</Text>
              </View>
              <Ionicons name={officePickerOpen ? "chevron-up" : "chevron-down"} size={19} color={colors.muted} />
            </Pressable>
            {!!offices.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {meetingOffices.data.filter((office) => offices.includes(office.id)).map((office) => <Pressable key={office.id} accessibilityRole="button" accessibilityLabel={`Remove ${office.name} invitation`} accessibilityHint="Removes this office from the meeting request." disabled={busy} onPress={() => setOffices((current) => current.filter((id) => id !== office.id))} style={({ pressed }) => [{ minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 22, backgroundColor: "#effaf7", borderWidth: 1, borderColor: "#c7e8df" }, pressed && { opacity: 0.76 }]}>
                <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.brandDark, fontSize: 11, fontWeight: "700" }}>{office.name}</Text><Ionicons name="close-circle" size={16} color={colors.brand} />
              </Pressable>)}
            </View>}
            {officePickerOpen && <View style={{ gap: 6, padding: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: "#fbfdfd" }}>
              <Text style={[s.small, { paddingHorizontal: 3 }]}>Select up to {Math.min(10, meetingOffices.data.length)} offices. Your selections are saved with the meeting request.</Text>
              {meetingOffices.data.map((office) => {
                const selected = offices.includes(office.id), limitReached = !selected && offices.length >= 10;
                return <Pressable key={office.id} accessibilityRole="checkbox" accessibilityLabel={office.name} accessibilityState={{ checked: selected, disabled: limitReached || busy }} accessibilityHint="Invited offices can accept or decline." disabled={limitReached || busy} onPress={() => setOffices((current) => {
                  if (current.includes(office.id)) return current.filter((id) => id !== office.id);
                  return current.length < 10 ? [...current, office.id] : current;
                })} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 9, borderRadius: 10, backgroundColor: selected ? "#effaf7" : "white", opacity: limitReached || busy ? 0.55 : 1 }, pressed && { opacity: 0.78 }]}>
                  <View style={{ width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: selected ? 0 : 1.5, borderColor: colors.line, backgroundColor: selected ? colors.brand : "white" }}>{selected && <Ionicons name="checkmark" size={15} color="white" />}</View>
                  <Text style={{ flex: 1, color: colors.brandDark, fontSize: 13, fontWeight: selected ? "700" : "500" }}>{office.name}</Text>
                </Pressable>;
              })}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 3 }}>
                <Text style={s.small}>{offices.length} of {Math.min(10, meetingOffices.data.length)} selected</Text>
                <Pressable accessibilityRole="button" onPress={() => setOfficePickerOpen(false)} style={({ pressed }) => [{ minWidth: 76, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.brand }, pressed && { opacity: 0.8 }]}><Text style={{ color: "white", fontSize: 12, fontWeight: "800" }}>Done</Text></Pressable>
              </View>
            </View>}
          </View> : <Text style={s.small}>No offices are available to invite yet. The barangay can add an office later.</Text>}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 15, backgroundColor: "#f5f8fa" }}><Ionicons name="information-circle-outline" size={19} color={colors.muted} style={{ marginTop: 1 }} /><Text style={[s.small, { flex: 1, fontSize: 13, lineHeight: 19 }]}>After you send this, check Meetings for the barangay’s decision, office replies, date, place, and online link.</Text></View>
          <Button
            title={busy ? "Sending request…" : "Send meeting request"}
            loading={busy}
            disabled={
              busy ||
              !barangay ||
              title.trim().length < 8 ||
              body.trim().length < 20
            }
            onPress={() => void submitMeetingRequest()}
          />
        </View>
      )}
      {tab !== "request" && (page > 0 || currentPageCount >= 20) && (
        <>
        <Text style={[s.small, { textAlign: "center" }]}>Page {page + 1}</Text>
        <View style={s.actionRow}>
          <Button
            grow
            secondary
            title="Previous"
            disabled={!page || q.isFetching}
            onPress={() => setPage(page - 1)}
          />
          <Button
            grow
            secondary
            title="Next"
            disabled={
              q.isFetching || !!q.error || (tab === "consultations"
                ? (q.data?.consultations.length ?? 0)
                : (q.data?.requests.length ?? 0)) < 20
            }
            onPress={() => setPage(page + 1)}
          />
        </View>
        </>
      )}
    </>
  );
}
function Conversation({
  id,
  initial,
  close,
  residentId,
  categories,
  barangays,
}: {
  id: string;
  initial?: Consultation;
  close: () => void;
  residentId: string;
  categories: Lookup[];
  barangays: Lookup[];
}) {
  const [body, setBody] = useState(""),
    [commentTouched, setCommentTouched] = useState(false),
    [reply, setReply] = useState(""),
    [page, setPage] = useState(0),
    [flag, setFlag] = useState(""),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [errorMessage, setErrorMessage] = useState(""),
    [busyAction, setBusyAction] = useState<"follow" | "comment" | "flag" | null>(null);
  const input = useRef<TextInput>(null);
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["consultation-detail", id],
    initialData: initial,
    initialDataUpdatedAt: 0,
    refetchInterval: 30_000,
    queryFn: () => result<Consultation | null>(db!.from("consultations").select("id,title,body,status,outcome,opens_at,closes_at,barangay_id,organization_id,report_id").eq("id", id).maybeSingle()),
  });
  const row = detail.data;
  const comments = useQuery({
    queryKey: ["consultation-comments", id, page],
    enabled: !!row,
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await db!.from("consultation_comments")
        .select("id,body,parent_id,official,created_at", { count: "exact" })
        .eq("consultation_id", id)
        .order("created_at")
        .range(page * 30, page * 30 + 29);
      if (response.error) throw new Error(response.error.message);
      return { items: response.data ?? [], count: response.count ?? 0 };
    },
  });
  const following = useQuery({
    queryKey: ["consultation-followers", id, residentId],
    enabled: !!row,
    queryFn: () => result<{ consultation_id: string }[]>(db!.from("consultation_followers").select("consultation_id").eq("consultation_id", id).eq("user_id", residentId)),
  });
  const organization = useQuery({
    queryKey: ["consultation-organization", row?.organization_id],
    enabled: !!row?.organization_id,
    queryFn: () => result<{ name: string }>(db!.from("organizations").select("name").eq("id", row!.organization_id!).single()),
  });
  const relatedCategory = useQuery({
    queryKey: ["consultation-category", row?.report_id],
    enabled: !!row?.report_id,
    queryFn: async () => {
      const linkedReport = await result<{ category_id: string } | null>(db!.from("reports").select("category_id").eq("id", row!.report_id!).maybeSingle());
      return categories.find((item) => item.id === linkedReport?.category_id)?.name ?? null;
    },
  });
  const phase = row ? consultationPhase(row) : "closed";
  const accepting = phase === "open";
  const isFollowing = !!following.data?.length;
  const commentItems = comments.data?.items ?? [];
  const commentCount = comments.data?.count ?? 0;
  const locationName = barangays.find((item) => item.id === row?.barangay_id)?.name ?? "Iligan City";
  const topicName = relatedCategory.data ?? initial?.category_name;
  async function toggleFollow() {
    setBusyAction("follow"); setMessage(""); setErrorMessage("");
    try {
      if (isFollowing) await result(db!.from("consultation_followers").delete().eq("consultation_id", id).eq("user_id", residentId));
      else await result(db!.from("consultation_followers").upsert({ consultation_id: id, user_id: residentId }, { onConflict: "consultation_id,user_id", ignoreDuplicates: true }));
      await qc.invalidateQueries({ queryKey: ["consultation-followers", id, residentId] });
      setMessage(isFollowing ? "You unfollowed this conversation." : "You’re now following this conversation.");
    } catch {
      setErrorMessage("We couldn’t update your follow setting. Please try again.");
    } finally { setBusyAction(null); }
  }
  async function postComment() {
    const text = body.trim();
    const problem = textInputError(text, { min: 2, max: 2000, required: true });
    if (problem) { setErrorMessage(problem); return; }
    setBusyAction("comment"); setMessage(""); setErrorMessage("");
    try {
      const parent = reply && commentItems.some((item) => item.id === reply) ? reply : null;
      await result(db!.from("consultation_comments").insert({ consultation_id: id, body: text, parent_id: parent }));
      setBody(""); setCommentTouched(false); setReply(""); Keyboard.dismiss();
      setPage(Math.floor(commentCount / 30));
      await qc.invalidateQueries({ queryKey: ["consultation-comments", id] });
      setMessage("Your contribution was posted.");
    } catch {
      setErrorMessage("We couldn’t post your contribution. Check your connection and try again.");
    } finally { setBusyAction(null); }
  }
  async function reportComment() {
    const text = reason.trim();
    const problem = textInputError(text, { min: 5, max: SHORT_REASON_LIMIT, required: true });
    if (problem) { setErrorMessage(problem); return; }
    setBusyAction("flag"); setMessage(""); setErrorMessage("");
    try {
      await result(db!.from("comment_flags").upsert({ comment_id: flag, user_id: residentId, reason: text }, { onConflict: "comment_id,user_id" }));
      setFlag(""); setReason(""); setMessage("Thanks. We sent this comment for review.");
    } catch {
      setErrorMessage("We couldn’t send this comment for review. Please try again.");
    } finally { setBusyAction(null); }
  }
  return (
    <>
      <AppBackNavigation label="Back to community" onBack={close} />
      {detail.error && <View style={s.card}><Text style={s.error}>Could not refresh this conversation. Showing the available details.</Text><Button secondary title="Retry conversation" loading={detail.isFetching} onPress={() => void detail.refetch()} /></View>}
      {!row ? detail.isPending ? <ListSkeleton variant="discussion" count={1} label="Loading conversation details" /> : <View style={s.card}><Text style={s.body}>This conversation is no longer available to your account.</Text></View> : <>
        <View style={{ gap: 9, paddingHorizontal: 2 }}>
          <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: accepting ? "#e4f6eb" : phase === "scheduled" ? "#eaf2ff" : "#eef3f8" }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accepting ? "#146f50" : phase === "scheduled" ? "#315b92" : "#5d7378" }} /><Text style={{ color: accepting ? "#146f50" : phase === "scheduled" ? "#315b92" : colors.muted, fontSize: 11, fontWeight: "800" }}>{accepting ? "OPEN" : phase === "scheduled" ? "UPCOMING" : "CLOSED"}</Text></View>
          <Text accessibilityRole="header" style={[s.heading, { fontSize: width < 360 ? 24 : 27, lineHeight: width < 360 ? 30 : 34, marginBottom: 0 }]}>{row.title}</Text>
          <Text style={[s.body, { color: "#5d7378" }]}>{row.body}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><Ionicons name="time-outline" size={16} color={colors.muted} /><Text style={s.small}>{phase === "scheduled" ? "Opens" : phase === "open" ? "Closes" : "Closed"} {new Date(phase === "scheduled" ? row.opens_at : row.closes_at).toLocaleString()}</Text></View>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!following.error || following.isPending || busyAction === "follow" }} disabled={!!following.error || following.isPending || busyAction !== null} onPress={() => void toggleFollow()} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 15, backgroundColor: "#e6f7f2", borderWidth: 1, borderColor: "#d6eee7", opacity: following.isPending || following.error ? 0.6 : 1 }, pressed && { opacity: 0.75 }]}>
          {busyAction === "follow" ? <ActivityIndicator size="small" color={colors.brand} /> : <Ionicons name={isFollowing ? "people" : "person-add-outline"} size={18} color={colors.brand} />}
          <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "800" }}>{following.isPending ? "Checking follow status…" : isFollowing ? "Following · Unfollow" : "Follow conversation"}</Text>
        </Pressable>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ConversationInfo width={width} icon="location-outline" label="Barangay" value={locationName} />
          {!!topicName && <ConversationInfo width={width} icon="pricetag-outline" label="Topic" value={topicName} />}
          {!!organization.data?.name && <ConversationInfo width={width} icon="business-outline" label="Issuing organization" value={organization.data.name} />}
        </View>
        {following.error && <View style={{ gap: 7 }}><Text accessibilityRole="alert" style={s.error}>Could not check your follow status.</Text><Button secondary title="Retry follow status" loading={following.isFetching} onPress={() => void following.refetch()} /></View>}
        {organization.error && <Text style={s.small}>Organization details are currently unavailable.</Text>}
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingHorizontal: 2 }}><Text style={s.title}>Discussion</Text><Text style={s.small}>{comments.isPending ? "Loading comments…" : `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}</Text></View>
        {comments.error && <View style={s.card}><Text accessibilityRole="alert" style={s.error}>Could not load this discussion.</Text><Button secondary title="Retry comments" loading={comments.isFetching} onPress={() => void comments.refetch()} /></View>}
        {comments.isPending && <ListSkeleton variant="discussion" count={2} label="Loading discussion comments" />}
        {comments.isSuccess && commentCount === 0 && <View style={[s.card, { alignItems: "center", paddingVertical: 19, gap: 7 }]}><View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: "#eaf7f3", alignItems: "center", justifyContent: "center" }}><Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.brand} /></View><Text style={s.fieldLabel}>No comments yet</Text><Text style={[s.small, { textAlign: "center" }]}>{accepting ? "Share a helpful suggestion or local experience to start the discussion." : "No contributions were recorded before this conversation closed."}</Text></View>}
        {commentItems.map((comment) => {
          const official = comment.official === true;
          const parent = comment.parent_id ? commentItems.find((item) => item.id === comment.parent_id) : undefined;
          return <View key={comment.id} style={[s.card, { gap: 9, padding: 12, borderColor: official ? "#b9e4da" : colors.line, backgroundColor: official ? "#eff9f6" : "white", marginLeft: comment.parent_id ? 12 : 0, borderLeftWidth: official || comment.parent_id ? 3 : 1, borderLeftColor: official ? colors.brand : comment.parent_id ? "#cbd8e0" : colors.line }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: official ? colors.brand : "#eaf1f7", alignItems: "center", justifyContent: "center" }}><Ionicons name={official ? "business-outline" : "person-outline"} size={18} color={official ? "white" : "#60798f"} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }}><Text style={{ color: colors.brandDark, fontSize: 12, fontWeight: "800" }}>{official ? organization.data?.name ?? "Authorized official" : "Resident"}</Text>{official && <><Text style={{ color: colors.brand, fontSize: 10, fontWeight: "800" }}>VERIFIED</Text><Ionicons name="checkmark-circle" size={14} color={colors.brand} /></>}</View><Text style={s.small}>{new Date(comment.created_at).toLocaleString()}</Text></View>
            </View>
            {official && <Text style={{ color: colors.brand, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 }}>VERIFIED OFFICIAL RESPONSE</Text>}
            {!!parent && <View style={{ paddingHorizontal: 9, paddingVertical: 7, borderRadius: 10, backgroundColor: "#f3f7f8" }}><Text style={[s.small, { color: colors.muted }]} numberOfLines={2}>Replying to: {parent.body}</Text></View>}
            {!parent && comment.parent_id && <Text style={s.small}>Reply to an earlier contribution</Text>}
            <Text style={[s.body, { color: colors.brandDark, lineHeight: 21 }]}>{comment.body}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {accepting && <Pressable accessibilityRole="button" accessibilityLabel="Reply to comment" disabled={busyAction !== null} onPress={() => { setReply(comment.id); setErrorMessage(""); input.current?.focus(); }} style={{ flex: 1, minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, backgroundColor: "#e9f8f4" }}><Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.brand} /><Text style={{ color: colors.brand, fontSize: 11, fontWeight: "800" }}>Reply</Text></Pressable>}
              <Pressable accessibilityRole="button" accessibilityLabel="Report comment" disabled={busyAction !== null} onPress={() => { setFlag(flag === comment.id ? "" : comment.id); setReason(""); setErrorMessage(""); }} style={{ flex: 1, minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, backgroundColor: flag === comment.id ? "#fff1ef" : "#fff6f5" }}><Ionicons name="flag-outline" size={15} color="#b4453e" /><Text style={{ color: "#b4453e", fontSize: 11, fontWeight: "700" }}>Report comment</Text></Pressable>
            </View>
            {flag === comment.id && <View style={{ gap: 8, padding: 10, borderRadius: 12, backgroundColor: "#fff8f7" }}><Field label="Why should this comment be reviewed?" placeholder="Tell the community team what concerns you." value={reason} onChangeText={setReason} multiline maxLength={SHORT_REASON_LIMIT} required minLength={5} hint="Briefly explain the concern. Use 5–500 characters." /><Button title={busyAction === "flag" ? "Sending report…" : "Send for review"} loading={busyAction === "flag"} disabled={reason.trim().length < 5 || busyAction !== null} onPress={() => void reportComment()} /></View>}
          </View>;
        })}
        {(page > 0 || commentItems.length === 30) && <View style={{ gap: 8 }}><Text style={[s.small, { textAlign: "center" }]}>Showing comments {page * 30 + 1}–{Math.min((page + 1) * 30, commentCount)} of {commentCount}</Text><View style={s.actionRow}><Button grow secondary title="Previous" disabled={!page || comments.isFetching} onPress={() => setPage(page - 1)} /><Button grow secondary title="Next" disabled={comments.isFetching || commentItems.length < 30} onPress={() => setPage(page + 1)} /></View></View>}
        {accepting ? <View style={[s.card, { padding: 10, gap: 8, backgroundColor: "#fff", borderColor: "#dce8eb" }]}>
          {reply && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}><Ionicons name="return-down-forward-outline" size={16} color={colors.brand} /><Text style={[s.small, { flex: 1 }]}>Replying to {commentItems.find((item) => item.id === reply)?.official ? "official response" : "resident comment"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={() => setReply("")}><Ionicons name="close-circle" size={20} color={colors.muted} /></Pressable></View>}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}><View style={{ width: 36, height: 36, marginBottom: 3, borderRadius: 18, backgroundColor: "#eaf1f7", alignItems: "center", justifyContent: "center" }}><Ionicons name="person-outline" size={18} color="#60798f" /></View><TextInput ref={input} accessibilityLabel={reply ? "Write a reply" : "Write a contribution"} accessibilityHint={commentTouched ? textInputError(body, { min: 2, max: 2000, required: true }) || "" : "Up to 2,000 characters"} placeholder={reply ? "Write a reply to this discussion…" : "Write a reply to this discussion…"} placeholderTextColor="#596f75" value={body} onBlur={() => setCommentTouched(true)} onChangeText={setBody} multiline maxLength={2000} textAlignVertical="top" style={{ flex: 1, minHeight: 48, maxHeight: 112, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 13, borderWidth: 1, borderColor: commentTouched && textInputError(body, { min: 2, max: 2000, required: true }) ? "#a93030" : "#e0e9eb", backgroundColor: "#fbfdfd", color: colors.brandDark, fontSize: 16, lineHeight: 22 }} /><Pressable accessibilityRole="button" accessibilityLabel="Send contribution" accessibilityState={{ disabled: !!textInputError(body, { min: 2, max: 2000, required: true }) || busyAction !== null, busy: busyAction === "comment" }} disabled={!!textInputError(body, { min: 2, max: 2000, required: true }) || busyAction !== null} onPress={() => { setCommentTouched(true); void postComment(); }} style={({ pressed }) => [{ width: 48, height: 48, marginBottom: 1, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand, opacity: !!textInputError(body, { min: 2, max: 2000, required: true }) || busyAction !== null ? 0.5 : 1 }, pressed && { opacity: 0.78 }]}>{busyAction === "comment" ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="send" size={18} color="white" />}</Pressable></View>
          {commentTouched && !!textInputError(body, { min: 2, max: 2000, required: true }) && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: "#a93030", fontSize: 12 }}>{textInputError(body, { min: 2, max: 2000, required: true })}</Text>}
          <Text style={[s.small, { textAlign: "right" }]}>{body.length}/2000</Text>
        </View> : <View style={[s.card, { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#f4f7f9" }]}><Ionicons name="lock-closed-outline" size={17} color={colors.muted} /><Text style={[s.small, { flex: 1 }]}>This conversation is closed. You can read the discussion, but new comments and replies are turned off.</Text></View>}
      </>}
      {!!message && <View accessibilityRole="alert" style={{ paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, backgroundColor: "#eaf7f2" }}><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "700" }}>{message}</Text></View>}
      {!!errorMessage && <View accessibilityRole="alert" style={{ paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, backgroundColor: "#fff1ef" }}><Text style={{ color: "#a43d35", fontSize: 12, fontWeight: "700" }}>{errorMessage}</Text></View>}
    </>
  );
}

function ConversationInfo({ width, icon, label: title, value }: { width: number; icon: "location-outline" | "pricetag-outline" | "business-outline"; label: string; value: string }) {
  return <View style={[s.card, { width: width < 360 ? "100%" : "48%", minHeight: 66, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 15 }]}><View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#e7f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={17} color={colors.brand} /></View><View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: colors.brandDark, fontSize: 11, fontWeight: "800" }}>{title}</Text><Text numberOfLines={2} style={{ color: colors.muted, fontSize: 11, lineHeight: 14 }}>{value}</Text></View></View>;
}
function meetingStatus(status: string, schedule: { starts_at: string; completed: boolean } | null, coordinationStatus: string) {
  if (schedule?.completed) return { label: "Completed", detail: "This meeting has taken place.", background: "#eaf2f1", foreground: "#536b70" };
  if (schedule) return { label: "Scheduled", detail: "Your meeting date and Philippine time are below.", background: "#e5f6f2", foreground: colors.brand };
  if (status === "declined") return { label: "Declined", detail: "The barangay declined this request. Read their note below.", background: "#fff0ef", foreground: "#b43d3b" };
  if (status === "pending") return { label: "Under review", detail: coordinationStatus === "unavailable" ? "The barangay is reviewing your request; all invited offices declined." : "Your barangay is reviewing this request.", background: "#fff4df", foreground: "#956000" };
  if (status === "approved" && coordinationStatus === "unavailable") return { label: "Approved · office unavailable", detail: "All invited offices declined. Check the barangay’s note for next steps.", background: "#fff4df", foreground: "#956000" };
  if (status === "approved") return { label: "Approved", detail: "The barangay will add the date and place here when they are set.", background: "#e3f6ed", foreground: "#08764f" };
  return { label: label(status), detail: "Check this request for updates.", background: "#eef3f8", foreground: colors.muted };
}

function MeetingDetails({ requestId, requestStatus }: { requestId: string; requestStatus: string }) {
  const q = useQuery({
    queryKey: ["meeting-details", requestId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const meeting = await result<{
        id: string;
        venue: string;
        starts_at: string;
        ends_at: string;
        outcome: string;
        completed: boolean;
        meet_url?: string | null;
      } | null>(
        db!
          .from("meetings")
          .select("*")
          .eq("request_id", requestId)
          .maybeSingle(),
      );
      return {
        meeting,
        actions: meeting
          ? await result<
              {
                id: string;
                description: string;
                due_at: string;
                completed: boolean;
                organizations: { name: string } | null;
              }[]
            >(
              db!
                .from("meeting_action_items")
                .select("id,description,due_at,completed,organizations(name)")
                .eq("meeting_id", meeting.id)
                .returns<
                  {
                    id: string;
                    description: string;
                    due_at: string;
                    completed: boolean;
                    organizations: { name: string } | null;
                  }[]
                >(),
            )
          : [],
        participants: meeting
          ? await result<{ organizations: { name: string } | null }[]>(
              db!
                .from("meeting_participants")
                .select("organizations(name)")
                .eq("meeting_id", meeting.id)
                .returns<{ organizations: { name: string } | null }[]>(),
            )
          : [],
      };
    },
  });
  if (q.isPending) return <ListSkeleton variant="meeting" count={1} label="Loading meeting schedule" />;
  if (q.error) return <View style={{ gap: 8 }}><Text style={s.error}>Could not load meeting details.</Text><Button secondary title="Retry schedule" onPress={() => void q.refetch()} /></View>;
  if (!q.data?.meeting) return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, borderRadius: 14, backgroundColor: "#f4f8fa" }}><Ionicons name="time-outline" size={17} color={colors.muted} style={{ marginTop: 2 }} /><Text style={[s.small, { flex: 1 }]}>{requestStatus === "approved" ? "The barangay approved your request. The date and place will appear here when scheduled." : "There is no meeting schedule yet. The latest decision is shown above."}</Text></View>;
  const participants = q.data.participants.map((item) => item.organizations?.name).filter(Boolean);
  const completeCount = q.data.actions.filter((action) => action.completed).length;
  const meetUrl = normalizeGoogleMeetUrl(q.data.meeting.meet_url || "");
  return (
    <View style={{ gap: 10, padding: 12, borderRadius: 16, backgroundColor: "#f0f8f6", borderWidth: 1, borderColor: "#e1efeb" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><View style={{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#d9f3ed" }}><Ionicons name="calendar-outline" size={19} color={colors.brand} /></View><Text style={[s.eyebrow, { flex: 1, marginBottom: 0 }]}>{q.data.meeting.completed ? "MEETING COMPLETED" : "MEETING SCHEDULED"}</Text></View>
      <Text style={[s.title, { marginLeft: 45 }]}>{q.data.meeting.venue}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9, marginLeft: 45 }}><Ionicons name="calendar-outline" size={17} color="#42617f" /><Text style={[s.body, { flex: 1 }]}>{formatMeetingTimeRange(q.data.meeting.starts_at, q.data.meeting.ends_at)}</Text></View>
      {!!meetUrl && <Pressable accessibilityRole="link" accessibilityLabel="Join the scheduled Google Meet" onPress={() => { void Linking.openURL(meetUrl).catch(() => Alert.alert("Could not open Google Meet", "Check your internet connection and try the link again.")); }} style={({ pressed }) => [{ minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.brand, marginLeft: 45 }, pressed && { opacity: 0.78 }]}><Ionicons name="videocam-outline" size={18} color="white" /><Text style={{ color: "white", fontSize: 13, fontWeight: "800" }}>Join Google Meet</Text></Pressable>}
      {!!participants.length && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, marginLeft: 45 }}><Ionicons name="people-outline" size={17} color="#42617f" style={{ marginTop: 2 }} /><Text style={[s.body, { flex: 1 }]}>{participants.join(" · ")}</Text></View>}
      {!!q.data.meeting.outcome && <View style={{ borderTopWidth: 1, borderTopColor: "#d8e8e4", paddingTop: 10, gap: 4 }}><Text style={[s.eyebrow, { fontSize: 10, letterSpacing: 1 }]}>MEETING OUTCOME</Text><Text style={s.body}>{q.data.meeting.outcome}</Text></View>}
      {!!q.data.actions.length && <View style={{ borderTopWidth: 1, borderTopColor: "#d8e8e4", paddingTop: 10, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><Ionicons name="stats-chart-outline" size={17} color={colors.brand} /><Text style={[s.small, { color: colors.brandDark, fontWeight: "800" }]}>Follow-through · {completeCount} of {q.data.actions.length} actions completed</Text></View>
      {q.data.actions.map((a) => (
        <View key={a.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 10, borderRadius: 13, backgroundColor: a.completed ? "#e4f6ef" : "white", borderWidth: 1, borderColor: a.completed ? "#d0eee1" : "#e3ecef" }}>
          <Ionicons name={a.completed ? "checkmark-circle" : "ellipse-outline"} size={19} color={a.completed ? "#07845a" : colors.muted} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={{ color: colors.brandDark, fontSize: 13, lineHeight: 18, fontWeight: "700" }}>{a.description}</Text><Text style={s.small}>{a.organizations?.name || "Unassigned"} · {a.due_at ? `${!a.completed && Date.parse(a.due_at) < Date.now() ? "Past target · " : "Due "}${new Date(a.due_at).toLocaleDateString()}` : "No target date"}</Text></View>
        </View>
      ))}
      </View>}
      {!q.data.actions.length && <Text style={[s.small, { borderTopWidth: 1, borderTopColor: "#d8e8e4", paddingTop: 9 }]}>No follow-up actions have been recorded.</Text>}
    </View>
  );
}
type Announcement = {
  id: string;
  title: string;
  body: string;
  kind: string;
  publish_at: string;
  barangay_id: string | null;
  attachment_path: string | null;
  organizations: { name: string } | null;
};
export function Announcements({ barangays, initialSelected = null }: { barangays: Lookup[]; initialSelected?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initialSelected),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["announcements", search, page],
    enabled: !selected,
    refetchInterval: 30_000,
    queryFn: () =>
      result<Announcement[]>(
        db!
          .from("announcements")
          .select(
            "id,title,body,kind,publish_at,barangay_id,attachment_path,organizations(name)",
          )
          .eq("status", "published")
          .lte("publish_at", new Date().toISOString())
          .ilike("title", `%${search}%`)
          .order("publish_at", { ascending: false })
          .range(page * 20, page * 20 + 19)
          .returns<Announcement[]>(),
      ),
  });
  const detail = useQuery({
    queryKey: ["announcement", selected],
    enabled: !!selected,
    refetchInterval: 30_000,
    placeholderData: q.data?.find((a) => a.id === selected),
    queryFn: () => result<Announcement | null>(db!.from("announcements")
      .select("id,title,body,kind,publish_at,barangay_id,attachment_path,organizations(name)")
      .eq("id", selected!).eq("status", "published")
      .lte("publish_at", new Date().toISOString()).maybeSingle<Announcement>()),
  });
  const row = detail.data;
  const photo = useQuery({
    queryKey: ["announcement-photo", row?.attachment_path],
    enabled: !!row?.attachment_path,
    queryFn: () =>
      result<{ signedUrl: string }>(
        db!.storage
          .from("announcement-media")
          .createSignedUrl(row!.attachment_path!, 600),
      ),
  });
  useEffect(() => {
    if (Platform.OS !== "android" || !selected) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { setSelected(null); return true; });
    return () => listener.remove();
  }, [!!selected]);
  if (selected && !row) return <>
    <AppBackNavigation label="Back to announcements" onBack={() => setSelected(null)} />
    {detail.isPending ? <ListSkeleton count={1} variant="announcement" label="Loading announcement" /> : <View style={s.card}>
      <Text accessibilityRole="alert" style={s.error}>{detail.error ? "Could not load this announcement." : "This announcement is no longer available."}</Text>
      <Button secondary title="Try again" loading={detail.isFetching} onPress={() => void detail.refetch()} />
    </View>}
  </>;
  if (row)
    return (
      <>
        <AppBackNavigation label="Back to announcements" onBack={() => setSelected(null)} />
        <Text style={s.eyebrow}>{row.kind}</Text>
        <Text style={s.heading}>{row.title}</Text>
        <Text style={s.small}>
          {row.organizations?.name || "Barangay administration"} ·{" "}
          {barangays.find((b) => b.id === row.barangay_id)?.name || "Citywide"}
        </Text>
        <Text style={s.small}>{new Date(row.publish_at).toLocaleString()}</Text>
        {photo.data && <PhotoViewer source={{ uri: photo.data.signedUrl }} label="Official announcement image" style={{ width: "100%", height: 300, borderRadius: 16 }} resizeMode="contain" />}
        {photo.error && <Text style={s.error}>{photo.error.message}</Text>}
        <Text style={s.body}>{row.body}</Text>
      </>
    );
  return (
    <>
      <Text style={s.heading}>Official updates</Text>
      <Text style={s.subtitle}>
        Announcements for your barangay and the city.
      </Text>
      <Field maxLength={200}
        label="Search announcements"
        placeholder="Search city and barangay updates"
        value={search}
        onChangeText={(v) => {
          setSearch(v);
          setPage(0);
        }}
      />
      {q.error && <View style={s.card}><Text style={s.error}>{q.error.message}</Text><Button secondary title="Try again" onPress={() => void q.refetch()} /></View>}
      {q.isPending && <ListSkeleton variant="announcement" count={3} label="Loading announcements" />}
      {q.data?.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="button"
          style={s.card}
          onPress={() => setSelected(a.id)}
        >
          <Text style={s.eyebrow}>{a.kind}</Text>
          <Text style={s.title}>{a.title}</Text>
          <Text numberOfLines={3} style={s.body}>
            {a.body}
          </Text>
          <Text style={s.small}>
            {new Date(a.publish_at).toLocaleDateString()} ·{" "}
            {a.organizations?.name || "Barangay administration"}
          </Text>
          <Text style={s.small}>Read announcement →</Text>
        </Pressable>
      ))}
      {!q.isPending && !q.error && !q.data?.length && (
        <Text style={s.subtitle}>No announcements match your search.</Text>
      )}
      {(page > 0 || (q.data?.length ?? 0) === 20) && (
        <View style={s.actionRow}>
          <Button grow secondary title="Previous" disabled={!page || q.isFetching} onPress={() => setPage(page - 1)} />
          <Button grow secondary title="Next" disabled={q.isFetching || !!q.error || (q.data?.length ?? 0) < 20} onPress={() => setPage(page + 1)} />
        </View>
      )}
    </>
  );
}
