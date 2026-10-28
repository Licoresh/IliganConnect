import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Image, Keyboard, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lookup, label, consultationPhase } from "@community/shared";
import { db, result } from "../lib/client";
import { styles as s, Button, Field, Choices, PhotoViewer, AppBackNavigation, colors, categoryIconFor, categoryToneFor } from "../components/ui";
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
export function Community({
  barangays,
  categories,
  defaultBarangay = "",
  initialTab = "consultations",
  residentId,
}: {
  barangays: Lookup[];
  categories: Lookup[];
  defaultBarangay?: string;
  initialTab?: "consultations" | "meetings" | "request";
  residentId: string;
}) {
  const [tab, setTab] = useState<string>(initialTab),
    [selected, setSelected] = useState<Consultation | null>(null),
    [search, setSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState(""),
    [area, setArea] = useState(""),
    [participation, setParticipation] = useState("all"),
    [expandedMeeting, setExpandedMeeting] = useState<string | null>(null),
    [page, setPage] = useState(0),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [barangay, setBarangay] = useState(defaultBarangay),
    [category, setCategory] = useState(""),
    [report, setReport] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const requestSubmission = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => { setAppliedSearch(search.trim()); setPage(0); }, 280);
    return () => clearTimeout(timer);
  }, [search]);
  const ownReports = useQuery({
    queryKey: ["meeting-report-options", residentId],
    enabled: tab === "request",
    queryFn: () => result<{ id: string; title: string; category_id: string; barangay_id: string }[]>(db!.from("reports").select("id,title,category_id,barangay_id").eq("resident_id", residentId).order("created_at", { ascending: false }).limit(50)),
  });
  const q = useQuery({
    queryKey: ["community", tab, appliedSearch, area, participation, page],
    enabled: tab !== "request",
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
      let requests = db!.from("meeting_requests")
        .select("id,title,body,status,decision_reason,barangay_id,category_id,report_id,created_at")
        .order("created_at", { ascending: false })
        .range(page * 20, page * 20 + 19);
      if (area) requests = requests.eq("barangay_id", area);
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
        barangay_id: string; category_id: string | null; report_id: string | null; created_at: string;
      }[]>(requests) : [];
      const schedules = requestRows.length ? await result<{
        request_id: string; starts_at: string; completed: boolean;
      }[]>(db!.from("meetings").select("request_id,starts_at,completed").in("request_id", requestRows.map((item) => item.id))) : [];
      return {
      consultations: topicRows.map((item) => ({ ...item, category_name: item.report_id ? categoriesByReport.get(item.report_id) ?? null : null })),
      requests: requestRows.map((item) => ({
        ...item,
        schedule: schedules.find((meeting) => meeting.request_id === item.id) ?? null,
      })),
      supports: tab === "meetings" ? await result<{ request_id: string }[]>(
        db!.from("meeting_supporters").select("request_id"),
      ) : [],
    }; },
  });
  const consultations = q.data?.consultations.filter((item, index, items) =>
    !item.title.startsWith("[DEMO]") ||
    items.findIndex(
      (candidate) =>
        candidate.title === item.title &&
        candidate.body === item.body &&
        candidate.barangay_id === item.barangay_id,
    ) === index,
  );
  const currentPageCount = tab === "consultations"
    ? (q.data?.consultations.length ?? 0)
    : (q.data?.requests.length ?? 0);
  useEffect(() => {
    if (Platform.OS !== "android" || !selected) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { setSelected(null); return true; });
    return () => listener.remove();
  }, [!!selected]);
  async function save(
    p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
    successMessage = "Saved.",
  ) {
    setBusy(true);
    try {
      await result(p);
      setMessage(successMessage);
      await qc.invalidateQueries({ queryKey: ["community"] });
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submitMeetingRequest() {
    if (requestSubmission.current) return;
    requestSubmission.current = true;
    try {
      const saved = await save(
        db!
          .from("meeting_requests")
          .insert({
            title: title.trim(),
            body: body.trim(),
            barangay_id: barangay,
            category_id: category || null,
            report_id: report || null,
          }),
        "Request submitted for city staff review.",
      );
      if (saved) {
        setTitle("");
        setBody("");
        setReport("");
        setCategory("");
        setPage(0);
        setSearch("");
        setArea("");
        setTab("meetings");
      }
    } finally {
      requestSubmission.current = false;
    }
  }
  if (selected)
    return <Conversation id={selected.id} initial={selected} close={() => setSelected(null)} residentId={residentId} categories={categories} barangays={barangays} />;
  const communityTabs = [
    { id: "consultations", name: "Conversations", icon: "chatbubbles-outline" as const },
    { id: "meetings", name: "Meetings", icon: "calendar-outline" as const },
    { id: "request", name: "Request\na meeting", icon: "calendar-number-outline" as const },
  ];
  return (
    <>
      <View style={{ minHeight: 112, justifyContent: "center", overflow: "hidden", paddingVertical: 4 }}>
        <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: "absolute", right: 0, bottom: 0, width: "100%", height: "100%", opacity: 0.82 }}>
          <Image source={require("../assets/iligan-community-profile-header.jpg")} resizeMode="cover" resizeMethod="resize" style={{ width: "100%", height: "100%" }} />
        </View>
        <Text accessibilityRole="header" style={[s.heading, { fontSize: 30, lineHeight: 36, marginBottom: 5 }]}>Community</Text>
        <Text style={[s.subtitle, { maxWidth: 245, marginBottom: 0 }]}>Local conversations, meeting updates, and ways to take part.</Text>
      </View>
      <View style={{ minHeight: 92, flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 20, backgroundColor: "#f1fbf8", borderWidth: 1, borderColor: "#dcefe9" }}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: "#e2f6f1", alignItems: "center", justifyContent: "center" }}><Ionicons name="people-outline" size={24} color={colors.teal} /></View>
        <View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.navy, fontSize: 15, fontWeight: "800" }}>Your community, in one place</Text><Text style={s.small}>Read local updates and help shape what happens next.</Text></View>
      </View>
      <View style={{ flexDirection: "row", gap: 3, padding: 4, borderRadius: 17, borderWidth: 1, borderColor: "#e2ebf1", backgroundColor: "white" }}>
        {communityTabs.map((item) => {
          const active = tab === item.id;
          return <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.id === "request" ? "Request a meeting" : item.name} accessibilityState={{ selected: active }} onPress={() => { setTab(item.id); setPage(0); }} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 58, paddingHorizontal: 5, paddingVertical: 6, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: active ? "#e8f7f3" : "transparent" }, pressed && { opacity: 0.78 }]}>
            <Ionicons name={item.icon} size={18} color={active ? colors.teal : colors.muted} />
            <Text numberOfLines={2} style={{ flexShrink: 1, textAlign: "center", color: active ? colors.teal : colors.muted, fontSize: 11, lineHeight: 14, fontWeight: active ? "800" : "600" }}>{item.name}</Text>
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
        <View style={[s.card, { gap: 11, padding: 13 }]}>
          <View style={{ gap: 8 }}><Text style={[s.fieldLabel, { fontSize: 15 }]}>Find a community update</Text><Field label="Search topics" placeholder="Search conversations or meetings" value={search} onChangeText={(value) => { setSearch(value); setPage(0); }} leading={<Ionicons name="search-outline" size={19} color={colors.muted} />} />{appliedSearch !== search.trim() && <Text style={s.small}>Updating results…</Text>}</View>
          <Choices compact title="Filter by barangay" sheetTitle="Choose a barangay" subtitle="See conversations from a specific barangay." items={[{ id: "", name: "All barangays" }, ...barangays]} value={area} onChange={(value) => { setArea(value); setPage(0); }} leadingIcon="location-outline" />
          <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 16, backgroundColor: "#f2faf8" }}>
            <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#e2f6f1" }}><Ionicons name="location-outline" size={20} color={colors.teal} /></View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 }}>MY BARANGAY</Text><Text numberOfLines={1} style={{ color: colors.navy, fontSize: 14, fontWeight: "800" }}>{barangays.find((item) => item.id === defaultBarangay)?.name ?? "Not set in your profile"}</Text></View>
            {!!defaultBarangay && <Pressable accessibilityRole="button" accessibilityLabel="Filter by my barangay" accessibilityState={{ selected: area === defaultBarangay }} onPress={() => { setArea(area === defaultBarangay ? "" : defaultBarangay); setPage(0); }} style={({ pressed }) => [{ minHeight: 40, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: area === defaultBarangay ? colors.teal : "white", borderWidth: 1, borderColor: area === defaultBarangay ? colors.teal : colors.line }, pressed && { opacity: 0.75 }]}><Text style={{ color: area === defaultBarangay ? "white" : colors.teal, fontSize: 11, fontWeight: "800" }}>{area === defaultBarangay ? "Selected" : "Use mine"}</Text></Pressable>}
          </View>
          <Choices columns={3} items={[{ id: "all", name: "All topics" }, { id: "open", name: "Open to join" }, { id: "closed", name: "Closed" }]} value={participation} onChange={(value) => { setParticipation(value); setPage(0); }} />
        </View>
        {(search || area || participation !== "all") && <Button secondary title="Clear community filters" onPress={() => { setSearch(""); setArea(""); setParticipation("all"); setPage(0); }} />}
        </>
      )}
      {tab === "meetings" && <View style={[s.card, { gap: 11, padding: 13 }]}>
        <View style={{ gap: 8 }}><Text style={[s.fieldLabel, { fontSize: 15 }]}>Find a community update</Text><Field label="Search topics" placeholder="Search conversations or meetings" value={search} onChangeText={(value) => { setSearch(value); setPage(0); }} leading={<Ionicons name="search-outline" size={19} color={colors.muted} />} />{appliedSearch !== search.trim() && <Text style={s.small}>Updating results…</Text>}</View>
        <Choices compact title="Filter meetings by barangay" sheetTitle="Choose a barangay" subtitle="See meeting requests from a specific barangay." items={[{ id: "", name: "All barangays" }, ...barangays]} value={area} onChange={(value) => { setArea(value); setPage(0); }} leadingIcon="location-outline" />
        <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 16, backgroundColor: "#f2faf8" }}>
          <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#e2f6f1" }}><Ionicons name="location-outline" size={20} color={colors.teal} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 }}>MY BARANGAY</Text><Text numberOfLines={1} style={{ color: colors.navy, fontSize: 14, fontWeight: "800" }}>{barangays.find((item) => item.id === defaultBarangay)?.name ?? "Not set in your profile"}</Text></View>
          {!!defaultBarangay && <Pressable accessibilityRole="button" accessibilityLabel="Filter meetings by my barangay" accessibilityState={{ selected: area === defaultBarangay }} onPress={() => { setArea(area === defaultBarangay ? "" : defaultBarangay); setPage(0); }} style={({ pressed }) => [{ minHeight: 40, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: area === defaultBarangay ? colors.teal : "white", borderWidth: 1, borderColor: area === defaultBarangay ? colors.teal : colors.line }, pressed && { opacity: 0.75 }]}><Text style={{ color: area === defaultBarangay ? "white" : colors.teal, fontSize: 11, fontWeight: "800" }}>{area === defaultBarangay ? "Selected" : "Use mine"}</Text></Pressable>}
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
              style={({ pressed }) => [s.card, { gap: 9, borderColor: "#e3ecef", padding: 13, shadowOpacity: 0.035 }, pressed && { backgroundColor: "#f6fbf9" }]}
              key={c.id}
              onPress={() => setSelected(c)}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.teal} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.teal, fontSize: 12, fontWeight: "800" }}>{barangays.find((b) => b.id === c.barangay_id)?.name ?? "Iligan City"}</Text><Text style={s.small}>Community conversation{c.category_name ? ` · ${c.category_name}` : ""}</Text></View>
                <View style={{ paddingHorizontal: 9, paddingVertical: 6, borderRadius: 13, backgroundColor: open ? "#e8f7f0" : phase === "scheduled" ? "#eaf2ff" : "#eef3f8" }}><Text style={{ color: open ? "#18825f" : phase === "scheduled" ? "#315b92" : colors.muted, fontSize: 10, fontWeight: "800" }}>{open ? "OPEN" : phase === "scheduled" ? "SOON" : "CLOSED"}</Text></View>
              </View>
              <Text style={[s.title, { marginTop: 1 }]}>{c.title}</Text>
              <Text numberOfLines={3} style={s.body}>
                {c.body}
              </Text>
              <View style={[s.row, { gap: 6 }]}><Ionicons name="time-outline" size={15} color={colors.muted} /><Text style={s.small}>{phase === "scheduled" ? "Opens" : phase === "open" ? "Closes" : "Closed"} {new Date(phase === "scheduled" ? c.opens_at : c.closes_at).toLocaleString()}</Text></View>
              {!!c.outcome && <Text style={[s.small, { color: colors.teal, fontWeight: "700" }]}>Recorded outcome available</Text>}
              <View style={{ minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2, paddingHorizontal: 11, borderRadius: 13, backgroundColor: open ? "#e9f8f4" : "#f4f7f9" }}><Text style={[s.small, { color: open ? colors.teal : colors.navy, fontWeight: "800" }]}>{open ? "Join the conversation" : c.outcome ? "Read outcome" : "View discussion"}</Text><Ionicons name="chevron-forward" size={18} color={open ? colors.teal : colors.muted} /></View>
            </Pressable>
            );
          })}
          {!consultations?.length && !q.isPending && !q.error && (
            <View style={[s.card, { alignItems: "center", paddingVertical: 24, gap: 8 }]}><View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: "#eaf7f3", alignItems: "center", justifyContent: "center" }}><Ionicons name="chatbubbles-outline" size={22} color={colors.teal} /></View><Text style={s.title}>No conversations found</Text><Text style={[s.small, { textAlign: "center" }]}>Try another search or reset your community filters.</Text>{(search || area || participation !== "all") && <Button secondary title="Reset filters" onPress={() => { setSearch(""); setArea(""); setParticipation("all"); setPage(0); }} />}</View>
          )}
          {q.isSuccess && (
            <View style={s.card}>
              <View style={s.row}>
                <View style={s.notificationIcon}>
                  <Ionicons name="people-outline" size={19} color={colors.teal} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.title}>Have a topic to discuss?</Text>
                  <Text style={s.small}>Request a community meeting and follow the recorded decision.</Text>
                </View>
              </View>
              <Button secondary title="Request a meeting" onPress={() => setTab("request")} />
            </View>
          )}
        </>
      )}
      {tab === "meetings" && (
        <>
          {q.data?.requests.map((r) => {
            const state = meetingStatus(r.status, r.schedule);
            const categoryName = categories.find((item) => item.id === r.category_id)?.name;
            return <View style={[s.card, { gap: 10, padding: 14 }]} key={r.id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: "#edf3fb", alignItems: "center", justifyContent: "center" }}><Ionicons name="calendar-outline" size={20} color="#426ca6" /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={[s.eyebrow, { marginBottom: 0 }]}>MEETING REQUEST</Text><View style={{ alignSelf: "flex-start", borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: state.background }}><Text style={{ color: state.foreground, fontSize: 11, lineHeight: 15, fontWeight: "700" }}>{state.label}</Text></View></View>
                <Ionicons name={expandedMeeting === r.id ? "chevron-up" : "chevron-forward"} size={18} color={colors.muted} />
              </View>
              <Text style={[s.title, { fontSize: 18, lineHeight: 24 }]}>{r.title}</Text>
              {!!categoryName && <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name={categoryIconFor(categoryName)} size={15} color={categoryToneFor(categoryName).foreground} /><Text style={s.small}>{categoryName}</Text><Text style={s.small}>· {barangays.find((item) => item.id === r.barangay_id)?.name ?? "Iligan City"}</Text></View>}
              <Text style={s.body}>{r.body}</Text>
              {r.decision_reason && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 13, backgroundColor: "#f0f8f6" }}><Ionicons name="document-text-outline" size={17} color={colors.teal} style={{ marginTop: 2 }} /><Text style={[s.small, { flex: 1, color: colors.navy }]}><Text style={{ fontWeight: "800" }}>Decision: </Text>{r.decision_reason}</Text></View>}
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
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: expandedMeeting === r.id }} onPress={() => setExpandedMeeting(expandedMeeting === r.id ? null : r.id)} style={({ pressed }) => [{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderRadius: 13, backgroundColor: "#eef9f6" }, pressed && { opacity: 0.8 }]}><Text style={{ flex: 1, color: colors.teal, fontSize: 13, fontWeight: "800" }}>{expandedMeeting === r.id ? "Hide meeting details" : "Schedule, outcome & action items"}</Text><Ionicons name={expandedMeeting === r.id ? "chevron-up" : "chevron-forward"} size={18} color={colors.teal} /></Pressable>
              {expandedMeeting === r.id && <MeetingDetails requestId={r.id} />}
            </View>;
          })}
          {!q.data?.requests.length && !q.isPending && !q.error && <View style={[s.card, { alignItems: "center", paddingVertical: 22, gap: 7 }]}><View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: "#eaf7f3", alignItems: "center", justifyContent: "center" }}><Ionicons name="calendar-outline" size={21} color={colors.teal} /></View><Text style={s.title}>No meeting requests found</Text><Text style={[s.small, { textAlign: "center" }]}>{search || area ? "Try another search or barangay." : "New requests will appear here after they are submitted."}</Text>{(search || area) && <Button secondary title="Clear meeting filters" onPress={() => { setSearch(""); setArea(""); setPage(0); }} />}</View>}
        </>
      )}
      {tab === "request" && (
        <View style={[s.card, { gap: 12 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 15, backgroundColor: "#f0faf7" }}><View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: "#def4ee", alignItems: "center", justifyContent: "center" }}><Ionicons name="calendar-number-outline" size={22} color={colors.teal} /></View><View style={{ flex: 1, gap: 3 }}><Text style={s.title}>Request a meeting</Text><Text style={s.small}>Suggest a local conversation for city staff to review.</Text></View></View>
          <Text style={s.small}>Explain why a discussion would help. Staff will review the request and record a decision.</Text>
          <Field
            label="Topic"
            placeholder="e.g. Streetlight maintenance, drainage concern, etc."
            value={title}
            onChangeText={setTitle}
            maxLength={100}
            leading={<Ionicons name="document-text-outline" size={19} color={colors.muted} />}
          />
          <Text style={[s.small, { marginTop: -8 }]}>Enter a short topic for the meeting request.</Text>
          <Text style={[s.small, { textAlign: "right", marginTop: -8 }]}>{title.length}/100</Text>
          <Field
            label="Purpose and concerns"
            placeholder="Type your purpose and concerns here..."
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={500}
            leading={<Ionicons name="create-outline" size={19} color={colors.muted} />}
            style={{ minHeight: 118, paddingTop: 14 }}
          />
          <Text style={[s.small, { textAlign: "right", marginTop: -8 }]}>{body.length}/500</Text>
          <Text style={[s.small, { marginTop: -8 }]}>Explain the issue or concern and what you would like to discuss.</Text>
          <View style={{ gap: 6 }}><Text style={s.fieldLabel}>Barangay</Text><Text style={s.small}>Select the barangay related to this request.</Text><Choices compact title="Choose a barangay" sheetTitle="Choose a barangay" items={barangays} value={barangay} onChange={setBarangay} leadingIcon="location-outline" /></View>
          <View style={{ gap: 6 }}><Text style={s.fieldLabel}>Related category (optional)</Text><Text style={s.small}>Choose a category that best fits your topic.</Text></View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 }}>
            {[{ id: "", name: "Not specified" }, ...categories].map((item) => {
              const selected = category === item.id;
              const tone = item.id ? categoryToneFor(item.name) : { background: "#eef3f6", foreground: colors.muted };
              const icon = item.id ? categoryIconFor(item.name) : "grid-outline" as const;
              return <Pressable key={item.id || "unspecified"} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setCategory(item.id)} style={({ pressed }) => [{ width: "48.5%", minHeight: 70, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 15, backgroundColor: selected ? "#effaf7" : "white", borderWidth: selected ? 1.5 : 1, borderColor: selected ? colors.teal : colors.line }, pressed && { opacity: 0.8 }]}>
                <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: tone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={18} color={tone.foreground} /></View><Text style={{ flex: 1, minWidth: 0, color: selected ? colors.teal : colors.navy, fontSize: 11, lineHeight: 14, fontWeight: selected ? "800" : "600" }}>{item.id ? item.name : "Not specified"}</Text>{selected && <Ionicons name="checkmark-circle" size={16} color={colors.teal} />}
              </Pressable>;
            })}
          </View>
          <View style={{ gap: 5 }}><Text style={s.fieldLabel}>Link one of your reports (optional)</Text><Text style={s.small}>Give staff context without copying a report ID. A report can suggest its category and barangay.</Text></View>
          {ownReports.isPending ? <ListSkeleton variant="report" count={1} label="Loading your reports" /> : ownReports.error ? <View style={{ gap: 8 }}><Text style={s.error}>Your reports could not be loaded. You can still request a meeting without a linked report.</Text><Button secondary title="Retry report choices" onPress={() => void ownReports.refetch()} /></View> : <Choices compact title="Choose a related report" items={[{ id: "", name: "No linked report" }, ...(ownReports.data ?? []).map((r) => ({ id: r.id, name: r.title }))]} value={report} onChange={(id) => {
            setReport(id);
          }} />}
          {!!report && !!ownReports.data?.find((item) => item.id === report) && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 13, backgroundColor: "#f0faf7" }}><Ionicons name="information-circle-outline" size={18} color={colors.teal} /><Text style={[s.small, { flex: 1 }]}>Linked report: {categories.find((item) => item.id === ownReports.data?.find((r) => r.id === report)?.category_id)?.name ?? "No category"} · {barangays.find((item) => item.id === ownReports.data?.find((r) => r.id === report)?.barangay_id)?.name ?? "Unknown barangay"}. Choose those above if they apply.</Text></View>}
          {ownReports.data?.length === 50 && <Text style={s.small}>Showing your 50 most recent reports.</Text>}
          <Text style={s.small}>Topic: at least 8 characters · Purpose: at least 20 characters</Text>
          <Button
            title="Submit meeting request"
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
  initial: Consultation;
  close: () => void;
  residentId: string;
  categories: Lookup[];
  barangays: Lookup[];
}) {
  const [body, setBody] = useState(""),
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
    queryFn: () => result<Consultation>(db!.from("consultations").select("id,title,body,status,outcome,opens_at,closes_at,barangay_id,organization_id,report_id").eq("id", id).single()),
  });
  const row = detail.data;
  const comments = useQuery({
    queryKey: ["consultation-comments", id, page],
    enabled: !!row,
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
  const topicName = relatedCategory.data ?? initial.category_name;
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
    if (text.length < 2) { setErrorMessage("Add at least 2 characters before posting."); return; }
    setBusyAction("comment"); setMessage(""); setErrorMessage("");
    try {
      const parent = reply && commentItems.some((item) => item.id === reply) ? reply : null;
      await result(db!.from("consultation_comments").insert({ consultation_id: id, body: text, parent_id: parent }));
      setBody(""); setReply(""); Keyboard.dismiss();
      setPage(Math.floor(commentCount / 30));
      await qc.invalidateQueries({ queryKey: ["consultation-comments", id] });
      setMessage("Your contribution was posted.");
    } catch {
      setErrorMessage("We couldn’t post your contribution. Check your connection and try again.");
    } finally { setBusyAction(null); }
  }
  async function reportComment() {
    const text = reason.trim();
    if (text.length < 5) { setErrorMessage("Add a short reason so the team can review this comment."); return; }
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
      {!row ? <ListSkeleton variant="discussion" count={1} label="Loading conversation details" /> : <>
        <View style={{ gap: 9, paddingHorizontal: 2 }}>
          <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: accepting ? "#e4f6eb" : phase === "scheduled" ? "#eaf2ff" : "#eef3f8" }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accepting ? "#18825f" : phase === "scheduled" ? "#315b92" : "#71859b" }} /><Text style={{ color: accepting ? "#18825f" : phase === "scheduled" ? "#315b92" : colors.muted, fontSize: 11, fontWeight: "800" }}>{accepting ? "OPEN" : phase === "scheduled" ? "UPCOMING" : "CLOSED"}</Text></View>
          <Text accessibilityRole="header" style={[s.heading, { fontSize: width < 360 ? 24 : 27, lineHeight: width < 360 ? 30 : 34, marginBottom: 0 }]}>{row.title}</Text>
          <Text style={[s.body, { color: "#637c91" }]}>{row.body}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><Ionicons name="time-outline" size={16} color={colors.muted} /><Text style={s.small}>{phase === "scheduled" ? "Opens" : phase === "open" ? "Closes" : "Closed"} {new Date(phase === "scheduled" ? row.opens_at : row.closes_at).toLocaleString()}</Text></View>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!following.error || following.isPending || busyAction === "follow" }} disabled={!!following.error || following.isPending || busyAction !== null} onPress={() => void toggleFollow()} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 15, backgroundColor: "#e6f7f2", borderWidth: 1, borderColor: "#d6eee7", opacity: following.isPending || following.error ? 0.6 : 1 }, pressed && { opacity: 0.75 }]}>
          {busyAction === "follow" ? <ActivityIndicator size="small" color={colors.teal} /> : <Ionicons name={isFollowing ? "people" : "person-add-outline"} size={18} color={colors.teal} />}
          <Text style={{ color: colors.teal, fontSize: 14, fontWeight: "800" }}>{following.isPending ? "Checking follow status…" : isFollowing ? "Following · Unfollow" : "Follow conversation"}</Text>
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
        {comments.isSuccess && commentCount === 0 && <View style={[s.card, { alignItems: "center", paddingVertical: 19, gap: 7 }]}><View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: "#eaf7f3", alignItems: "center", justifyContent: "center" }}><Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.teal} /></View><Text style={s.fieldLabel}>No comments yet</Text><Text style={[s.small, { textAlign: "center" }]}>{accepting ? "Share a helpful suggestion or local experience to start the discussion." : "No contributions were recorded before this conversation closed."}</Text></View>}
        {commentItems.map((comment) => {
          const official = comment.official === true;
          const parent = comment.parent_id ? commentItems.find((item) => item.id === comment.parent_id) : undefined;
          return <View key={comment.id} style={[s.card, { gap: 9, padding: 12, borderColor: official ? "#b9e4da" : colors.line, backgroundColor: official ? "#eff9f6" : "white", marginLeft: comment.parent_id ? 12 : 0, borderLeftWidth: official || comment.parent_id ? 3 : 1, borderLeftColor: official ? colors.teal : comment.parent_id ? "#cbd8e0" : colors.line }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: official ? colors.teal : "#eaf1f7", alignItems: "center", justifyContent: "center" }}><Ionicons name={official ? "business-outline" : "person-outline"} size={18} color={official ? "white" : "#60798f"} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }}><Text style={{ color: colors.navy, fontSize: 12, fontWeight: "800" }}>{official ? organization.data?.name ?? "Authorized official" : "Resident"}</Text>{official && <><Text style={{ color: colors.teal, fontSize: 10, fontWeight: "800" }}>VERIFIED</Text><Ionicons name="checkmark-circle" size={14} color={colors.teal} /></>}</View><Text style={s.small}>{new Date(comment.created_at).toLocaleString()}</Text></View>
            </View>
            {official && <Text style={{ color: colors.teal, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 }}>VERIFIED OFFICIAL RESPONSE</Text>}
            {!!parent && <View style={{ paddingHorizontal: 9, paddingVertical: 7, borderRadius: 10, backgroundColor: "#f3f7f8" }}><Text style={[s.small, { color: colors.muted }]} numberOfLines={2}>Replying to: {parent.body}</Text></View>}
            {!parent && comment.parent_id && <Text style={s.small}>Reply to an earlier contribution</Text>}
            <Text style={[s.body, { color: colors.navy, lineHeight: 21 }]}>{comment.body}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {accepting && <Pressable accessibilityRole="button" accessibilityLabel="Reply to comment" disabled={busyAction !== null} onPress={() => { setReply(comment.id); setErrorMessage(""); input.current?.focus(); }} style={{ flex: 1, minWidth: 0, minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, backgroundColor: "#e9f8f4" }}><Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.teal} /><Text style={{ color: colors.teal, fontSize: 11, fontWeight: "800" }}>Reply</Text></Pressable>}
              <Pressable accessibilityRole="button" accessibilityLabel="Report comment" disabled={busyAction !== null} onPress={() => { setFlag(flag === comment.id ? "" : comment.id); setReason(""); setErrorMessage(""); }} style={{ flex: 1, minWidth: 0, minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, backgroundColor: flag === comment.id ? "#fff1ef" : "#fff6f5" }}><Ionicons name="flag-outline" size={15} color="#b4453e" /><Text style={{ color: "#b4453e", fontSize: 11, fontWeight: "700" }}>Report comment</Text></Pressable>
            </View>
            {flag === comment.id && <View style={{ gap: 8, padding: 10, borderRadius: 12, backgroundColor: "#fff8f7" }}><Field label="Why should this comment be reviewed?" placeholder="Tell the community team what concerns you." value={reason} onChangeText={setReason} multiline maxLength={500} /><Text style={s.small}>At least 5 characters</Text><Button title={busyAction === "flag" ? "Sending report…" : "Send for review"} loading={busyAction === "flag"} disabled={reason.trim().length < 5 || busyAction !== null} onPress={() => void reportComment()} /></View>}
          </View>;
        })}
        {(page > 0 || commentItems.length === 30) && <View style={{ gap: 8 }}><Text style={[s.small, { textAlign: "center" }]}>Showing comments {page * 30 + 1}–{Math.min((page + 1) * 30, commentCount)} of {commentCount}</Text><View style={s.actionRow}><Button grow secondary title="Previous" disabled={!page || comments.isFetching} onPress={() => setPage(page - 1)} /><Button grow secondary title="Next" disabled={comments.isFetching || commentItems.length < 30} onPress={() => setPage(page + 1)} /></View></View>}
        {accepting ? <View style={[s.card, { padding: 10, gap: 8, backgroundColor: "#fff", borderColor: "#dce8eb" }]}>
          {reply && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}><Ionicons name="return-down-forward-outline" size={16} color={colors.teal} /><Text style={[s.small, { flex: 1 }]}>Replying to {commentItems.find((item) => item.id === reply)?.official ? "official response" : "resident comment"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={() => setReply("")}><Ionicons name="close-circle" size={20} color={colors.muted} /></Pressable></View>}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}><View style={{ width: 36, height: 36, marginBottom: 3, borderRadius: 18, backgroundColor: "#eaf1f7", alignItems: "center", justifyContent: "center" }}><Ionicons name="person-outline" size={18} color="#60798f" /></View><TextInput ref={input} accessibilityLabel={reply ? "Write a reply" : "Write a contribution"} placeholder={reply ? "Write a reply to this discussion…" : "Write a reply to this discussion…"} placeholderTextColor="#849397" value={body} onChangeText={setBody} multiline maxLength={2000} textAlignVertical="top" style={{ flex: 1, minHeight: 42, maxHeight: 112, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 13, borderWidth: 1, borderColor: "#e0e9eb", backgroundColor: "#fbfdfd", color: colors.navy, fontSize: 13, lineHeight: 18 }} /><Pressable accessibilityRole="button" accessibilityLabel="Send contribution" accessibilityState={{ disabled: body.trim().length < 2 || busyAction !== null, busy: busyAction === "comment" }} disabled={body.trim().length < 2 || busyAction !== null} onPress={() => void postComment()} style={({ pressed }) => [{ width: 42, height: 42, marginBottom: 1, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.teal, opacity: body.trim().length < 2 || busyAction !== null ? 0.5 : 1 }, pressed && { opacity: 0.78 }]}>{busyAction === "comment" ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="send" size={18} color="white" />}</Pressable></View>
          <Text style={[s.small, { textAlign: "right" }]}>{body.length}/2000</Text>
        </View> : <View style={[s.card, { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#f4f7f9" }]}><Ionicons name="lock-closed-outline" size={17} color={colors.muted} /><Text style={[s.small, { flex: 1 }]}>This conversation is closed. You can read the discussion, but new comments and replies are turned off.</Text></View>}
      </>}
      {!!message && <View accessibilityRole="alert" style={{ paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, backgroundColor: "#eaf7f2" }}><Text style={{ color: colors.teal, fontSize: 12, fontWeight: "700" }}>{message}</Text></View>}
      {!!errorMessage && <View accessibilityRole="alert" style={{ paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, backgroundColor: "#fff1ef" }}><Text style={{ color: "#a43d35", fontSize: 12, fontWeight: "700" }}>{errorMessage}</Text></View>}
    </>
  );
}

function ConversationInfo({ width, icon, label: title, value }: { width: number; icon: "location-outline" | "pricetag-outline" | "business-outline"; label: string; value: string }) {
  return <View style={[s.card, { width: width < 360 ? "100%" : "48%", minHeight: 66, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 15 }]}><View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#e7f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={17} color={colors.teal} /></View><View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: colors.navy, fontSize: 11, fontWeight: "800" }}>{title}</Text><Text numberOfLines={2} style={{ color: colors.muted, fontSize: 11, lineHeight: 14 }}>{value}</Text></View></View>;
}
function meetingStatus(status: string, schedule: { starts_at: string; completed: boolean } | null) {
  if (schedule?.completed) return { label: "Completed", background: "#eaf2f1", foreground: "#536b70" };
  if (schedule) return { label: "Scheduled", background: "#e5f6f2", foreground: colors.teal };
  if (status === "approved") return { label: "Approved", background: "#e3f6ed", foreground: "#08764f" };
  if (status === "declined") return { label: "Declined", background: "#fff0ef", foreground: "#b43d3b" };
  if (status === "pending") return { label: "Pending", background: "#fff4df", foreground: "#956000" };
  return { label: label(status), background: "#eef3f8", foreground: colors.muted };
}

function MeetingDetails({ requestId }: { requestId: string }) {
  const q = useQuery({
    queryKey: ["meeting-details", requestId],
    queryFn: async () => {
      const meeting = await result<{
        id: string;
        venue: string;
        starts_at: string;
        outcome: string;
        completed: boolean;
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
  if (!q.data?.meeting) return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, borderRadius: 14, backgroundColor: "#f4f8fa" }}><Ionicons name="time-outline" size={17} color={colors.muted} style={{ marginTop: 2 }} /><Text style={[s.small, { flex: 1 }]}>No meeting has been scheduled yet. Any review decision is shown above.</Text></View>;
  const participants = q.data.participants.map((item) => item.organizations?.name).filter(Boolean);
  const completeCount = q.data.actions.filter((action) => action.completed).length;
  return (
    <View style={{ gap: 10, padding: 12, borderRadius: 16, backgroundColor: "#f0f8f6", borderWidth: 1, borderColor: "#e1efeb" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><View style={{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#d9f3ed" }}><Ionicons name="calendar-outline" size={19} color={colors.teal} /></View><Text style={[s.eyebrow, { flex: 1, marginBottom: 0 }]}>{q.data.meeting.completed ? "MEETING COMPLETED" : "MEETING SCHEDULED"}</Text></View>
      <Text style={[s.title, { marginLeft: 45 }]}>{q.data.meeting.venue}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9, marginLeft: 45 }}><Ionicons name="calendar-outline" size={17} color="#42617f" /><Text style={[s.body, { flex: 1 }]}>{new Date(q.data.meeting.starts_at).toLocaleString()}</Text></View>
      {!!participants.length && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, marginLeft: 45 }}><Ionicons name="people-outline" size={17} color="#42617f" style={{ marginTop: 2 }} /><Text style={[s.body, { flex: 1 }]}>{participants.join(" · ")}</Text></View>}
      {!!q.data.meeting.outcome && <View style={{ borderTopWidth: 1, borderTopColor: "#d8e8e4", paddingTop: 10, gap: 4 }}><Text style={[s.eyebrow, { fontSize: 10, letterSpacing: 1 }]}>MEETING OUTCOME</Text><Text style={s.body}>{q.data.meeting.outcome}</Text></View>}
      {!!q.data.actions.length && <View style={{ borderTopWidth: 1, borderTopColor: "#d8e8e4", paddingTop: 10, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><Ionicons name="stats-chart-outline" size={17} color={colors.teal} /><Text style={[s.small, { color: colors.navy, fontWeight: "800" }]}>Follow-through · {completeCount} of {q.data.actions.length} actions completed</Text></View>
      {q.data.actions.map((a) => (
        <View key={a.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 10, borderRadius: 13, backgroundColor: a.completed ? "#e4f6ef" : "white", borderWidth: 1, borderColor: a.completed ? "#d0eee1" : "#e3ecef" }}>
          <Ionicons name={a.completed ? "checkmark-circle" : "ellipse-outline"} size={19} color={a.completed ? "#07845a" : colors.muted} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={{ color: colors.navy, fontSize: 13, lineHeight: 18, fontWeight: "700" }}>{a.description}</Text><Text style={s.small}>{a.organizations?.name || "Unassigned"} · {a.due_at ? `${!a.completed && Date.parse(a.due_at) < Date.now() ? "Past target · " : "Due "}${new Date(a.due_at).toLocaleDateString()}` : "No target date"}</Text></View>
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
      <Field
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
