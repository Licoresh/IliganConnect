import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  Image,
  Modal,
  ScrollView,
  Pressable,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Switch,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Crypto from "expo-crypto";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { db, result, configured } from "../lib/client";
import { styles as s, Button, Field, Choices, SelectionSheet, PhotoViewer, AppBackNavigation, colors, categoryIconFor, categoryToneFor, statusToneFor, categoryDisplayName } from "../components/ui";
import { Profile, Lookup, Report, label } from "@community/shared";
import { ReportForm, ReportReviewCard, ReportTracking, Explore as ExploreScreen } from "../features/reports";
import { Community as CommunityScreen, Announcements } from "../features/community";
import { ListSkeleton } from "../components/loading";
const REPORT_PAGE_SIZE = 5;
const Explore = memo(ExploreScreen);
const Community = memo(CommunityScreen);
if (Platform.OS === "web") WebBrowser.maybeCompleteAuthSession();
const authRedirects = new Map<string, Promise<boolean>>();
function completeAuthRedirect(url: string) {
  const existing = authRedirects.get(url);
  if (existing) return existing;
  const pending = (async () => {
    if (!db) throw new Error("Authentication is not configured.");
    const parsed = new URL(url), params = new URLSearchParams(parsed.search);
    new URLSearchParams(parsed.hash.slice(1)).forEach((value, key) => params.set(key, value));
    if (params.get("error_description")) throw new Error(params.get("error_description")!);
    const code = params.get("code"), accessToken = params.get("access_token"), refreshToken = params.get("refresh_token");
    if (code) {
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else if (accessToken && refreshToken) {
      const { error } = await db.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) throw error;
    }
    return params.get("type") === "recovery";
  })();
  authRedirects.set(url, pending);
  // Link events and the browser result can deliver the same callback together.
  // Retain it briefly for deduplication, without keeping credentials in memory.
  const clear = () => { setTimeout(() => authRedirects.delete(url), 30_000); };
  void pending.then(clear, clear);
  return pending;
}
const tabs = [
  ["Home", "home-outline"],
  ["Explore", "map-outline"],
  ["Report", "add-circle-outline"],
  ["Community", "chatbubbles-outline"],
  ["Profile", "person-outline"],
] as const;
export default function Home() {
  const [user, setUser] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("Home"),
    [selected, setSelected] = useState<Report | null>(null),
    [selectedAnnouncement, setSelectedAnnouncement] = useState<string | null>(null),
    [category, setCategory] = useState(""),
    [recovery, setRecovery] = useState(false),
    [authError, setAuthError] = useState(""),
    [page, setPage] = useState(0),
    [showAllCategories, setShowAllCategories] = useState(false),
    [barangaysOpen, setBarangaysOpen] = useState(false),
    [barangayBusy, setBarangayBusy] = useState(false),
    [barangayMessage, setBarangayMessage] = useState(""),
    [failedReportPhotos, setFailedReportPhotos] = useState<Record<string, boolean>>({}),
    [refreshing, setRefreshing] = useState(false),
    [notificationReturnTab, setNotificationReturnTab] = useState("Home"),
    [reportReturnTab, setReportReturnTab] = useState("Home"),
    [communityInitialTab, setCommunityInitialTab] = useState<"consultations" | "meetings">("consultations");
  const qc = useQueryClient();
  const scroll = useRef<ScrollView>(null);
  const exploreScrollY = useRef(0);
  const openExploreReport = useCallback((report: Report) => {
    setReportReturnTab("Explore");
    setSelected(report);
  }, []);
  useEffect(() => {
    if (reportReturnTab === "Explore" && (selected || tab === "Explore")) {
      scroll.current?.scrollTo({ y: selected ? 0 : exploreScrollY.current, animated: false });
      return;
    }
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [tab, selected?.id, reportReturnTab]);
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    db.auth.getSession().then(({ data, error }) => {
      setUser(data.session?.user.id ?? null);
      if (error) setAuthError(error.message);
      setLoading(false);
    });
    const { data } = db.auth.onAuthStateChange((event, session) => {
      setUser(session?.user.id ?? null);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") {
        qc.clear();
        setPage(0);
        setSelectedAnnouncement(null);
        setSelected(null);
        setNotificationReturnTab("Home");
        setTab("Home");
      }
    });
    async function handleUrl(url: string) {
      try {
        if (await completeAuthRedirect(url)) setRecovery(true);
      } catch (e) {
        setAuthError((e as Error).message);
      }
    }
    if (Platform.OS !== "web")
      void Linking.getInitialURL().then((url) => {
        if (url) void handleUrl(url);
      });
    const listener = Linking.addEventListener(
      "url",
      ({ url }) => void handleUrl(url),
    );
    return () => {
      data.subscription.unsubscribe();
      listener.remove();
    };
  }, [qc]);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (selected) {
      const listener = BackHandler.addEventListener("hardwareBackPress", () => {
        setSelected(null);
        setTab(reportReturnTab);
        return true;
      });
      return () => listener.remove();
    }
    if (tab === "Notifications") {
      const listener = BackHandler.addEventListener("hardwareBackPress", () => {
        setTab(notificationReturnTab);
        return true;
      });
      return () => listener.remove();
    }
  }, [selected, tab, notificationReturnTab, reportReturnTab]);
  const q = useQuery({
    queryKey: ["home", user],
    enabled: !!user,
    queryFn: async () => {
      const [profile, categories, barangays, announcements, unread] = await Promise.all([
      result<Profile>(
        db!.from("profiles").select("*").eq("id", user!).single(),
      ),
      result<Lookup[]>(
        db!
          .from("report_categories")
          .select("id,name,problem_types:report_problem_types(code,label,sort_order)")
          .eq("active", true)
          .order("name"),
      ),
      result<Lookup[]>(
        db!.from("barangays").select("id,name").order("name"),
      ),
      result<
        { id: string; title: string; kind: string }[]
      >(
        db!
          .from("announcements")
          .select("id,title,kind")
          .eq("status", "published")
          .lte("publish_at", new Date().toISOString())
          .order("publish_at", { ascending: false })
          .limit(3),
      ),
      db!.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user!).is("read_at", null),
      ]);
      if (unread.error) throw new Error(unread.error.message);
      return { profile, categories, barangays, announcements, unreadCount: unread.count ?? 0 };
    },
  });
  const reportsQuery = useQuery({
    queryKey: ["my-reports", user, page],
    enabled: !!user && tab === "Home" && !selected,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, count, error } = await db!.from("reports")
        .select("*", { count: "exact" }).eq("resident_id", user!)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE - 1);
      if (error) throw error;
      return { reports: data as Report[], count: count ?? 0 };
    },
  });
  const reportsLoading = reportsQuery.isPending || reportsQuery.isPlaceholderData;
  const reportIds = (reportsQuery.data?.reports ?? []).map((item) => item.id);
  const reportPhotos = useQuery({
    queryKey: ["home-report-photos", user, page, reportIds],
    enabled: !!user && tab === "Home" && !selected && reportIds.length > 0,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      const attachments = await result<{ report_id: string; path: string }[]>(db!.from("report_attachments").select("report_id,path").in("report_id", reportIds));
      if (!attachments.length) return {} as Record<string, string>;
      const urls = await db!.storage.from("report-evidence").createSignedUrls(attachments.map((item) => item.path), 3600);
      if (urls.error) throw urls.error;
      return Object.fromEntries(attachments.flatMap((item, index) => urls.data[index]?.signedUrl ? [[item.report_id, urls.data[index].signedUrl!]] : []));
    },
  });
  if (loading)
    return (
      <SafeAreaView style={s.screen}>
        <View style={{ padding: 18 }}><ListSkeleton variant="home" count={1} label="Opening the home screen" /></View>
      </SafeAreaView>
    );
  if (!user) return <Auth initialError={authError} />;
  if (recovery)
    return (
      <SafeAreaView style={s.screen}>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.heading}>Choose a new password</Text>
          <PasswordChange onDone={() => setRecovery(false)} />
        </ScrollView>
      </SafeAreaView>
    );
  const report = (id = "") => {
    setCategory(id);
    setSelected(null);
    setTab("Report");
  };
  const homeReports = reportsQuery.data?.reports ?? [];
  return (
    <SafeAreaView style={s.screen}>
      <View
        style={{
          paddingHorizontal: 18,
          paddingVertical: 8,
          minHeight: 58,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottomWidth: 1,
          borderColor: colors.line,
          backgroundColor: "white",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
          <Image source={require("../assets/iligan-connect-logo.png")} accessibilityLabel="Iligan Connect logo" resizeMode="contain" style={{ width: 46, height: 46 }} />
          <View style={{ gap: 3 }}>
            <Text style={[s.eyebrow, { color: "#008d86", fontSize: 13, letterSpacing: 1.8 }]}>ILIGAN CONNECT</Text>
            <Text style={{ fontSize: 9, letterSpacing: 2, color: "#71859b", fontWeight: "600" }}>A CLEANER · SAFER · STRONGER ILIGAN</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel={q.data?.unreadCount ? `Notifications, ${q.data.unreadCount} unread` : "Notifications"}
          accessibilityHint="Opens your notifications"
          accessibilityRole="button"
          accessibilityState={{ selected: tab === "Notifications" }}
          onPress={() => {
            setSelected(null);
            setNotificationReturnTab(tab === "Notifications" ? "Home" : tab);
            setTab("Notifications");
          }}
          style={({ pressed }) => [
            { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 16 },
            (pressed || tab === "Notifications") && { backgroundColor: "#eaf5ef" },
          ]}
        >
          <Ionicons
            name="notifications-outline"
            size={23}
            color={colors.navy}
          />
          {!!q.data?.unreadCount && (
            <View
              style={{
                position: "absolute",
                right: 8,
                top: 6,
                width: 8,
                height: 8,
                backgroundColor: colors.teal,
                borderRadius: 4,
              }}
            />
          )}
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={scroll}
          onScroll={(event) => { if (tab === "Explore" && !selected) exploreScrollY.current = event.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={[s.scroll, tab === "Home" && { gap: 9, paddingTop: 12 }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                try { await qc.invalidateQueries(); }
                finally { setRefreshing(false); }
              }}
              tintColor={colors.teal}
            />
          }
        >
          {q.isPending ? (
            <ListSkeleton variant="home" count={1} label="Loading your home screen" />
          ) : q.error && !q.data ? (
            <>
              <Text style={s.error}>{q.error.message}</Text>
              <Button title="Retry" onPress={() => void q.refetch()} />
              <Button
                secondary
                title="Sign out"
                onPress={() => void db!.auth.signOut()}
              />
            </>
          ) : (
            q.data && (
              <>
                {q.error && <View style={s.card}><Text accessibilityRole="alert" style={s.error}>Could not refresh community information. Showing your last loaded information.</Text><Button secondary title="Retry refresh" loading={q.isFetching} onPress={() => void q.refetch()} /></View>}
                {(tab === "Explore" || (selected && reportReturnTab === "Explore")) && <View style={selected ? { display: "none" } : undefined}>
                  <Explore
                    categories={q.data.categories}
                    barangays={q.data.barangays}
                    onOpenReport={openExploreReport}
                    suspendExpandedMap={!!selected && reportReturnTab === "Explore"}
                  />
                </View>}
                {selected ? (
                  <ReportTracking
                    key={selected.id}
                    report={selected}
                    categoryName={q.data.categories.find((item) => item.id === selected.category_id)?.name ?? "Community report"}
                    barangayName={q.data.barangays.find((item) => item.id === selected.barangay_id)?.name ?? "Iligan City"}
                    backLabel={reportReturnTab === "Notifications" ? "Back to notifications" : reportReturnTab === "Explore" ? "Back to map" : "Back to reports"}
                    close={() => { setSelected(null); setTab(reportReturnTab); }}
                  />
                ) : tab === "Report" ? (
                  <ReportForm
                    categories={q.data.categories}
                    barangays={q.data.barangays}
                    initialCategory={category}
                    initialBarangay={q.data.profile.barangay_id || ""}
                    onSaved={() => {
                      setTab("Home");
                      setPage(0);
                      void qc.invalidateQueries();
                    }}
                  />
                ) : tab === "Explore" ? null : tab === "Community" ? (
                  <Community
                    residentId={q.data.profile.id}
                    barangays={q.data.barangays}
                    categories={q.data.categories}
                    defaultBarangay={q.data.profile.barangay_id || ""}
                    initialTab={communityInitialTab}
                  />
                ) : tab === "Announcements" ? (
                  <Announcements barangays={q.data.barangays} initialSelected={selectedAnnouncement} />
                ) : tab === "Notifications" ? (
                  <NotificationCenter
                    profileId={q.data.profile.id}
                    backLabel={`Back to ${notificationReturnTab.toLowerCase()}`}
                    onBack={() => setTab(notificationReturnTab)}
                    onNavigate={async (destination, reportId, communitySection, announcementId) => {
                      if (reportId) {
                        const report = await result<Report | null>(db!.from("reports").select("*").eq("id", reportId).maybeSingle());
                        if (!report) throw new Error("This report is no longer available to your account.");
                        setReportReturnTab("Notifications");
                        setSelected(report);
                      }
                      if (destination === "Community") setCommunityInitialTab(communitySection || "consultations");
                      if (destination === "Announcements") setSelectedAnnouncement(announcementId || null);
                      setTab(destination);
                    }}
                  />
                ) : tab === "Profile" ? (
                  <ProfileForm
                    profile={q.data.profile}
                    barangays={q.data.barangays}
                    onNavigate={(destination, communityTab) => {
                      if (communityTab) setCommunityInitialTab(communityTab);
                      if (destination === "Home") setPage(0);
                      setTab(destination);
                    }}
                  />
                ) : (
                  <>
                    <View style={{ minHeight: 120, justifyContent: "flex-end", paddingHorizontal: 3, paddingBottom: 4, overflow: "hidden" }}>
                      <View pointerEvents="none" style={{ position: "absolute", right: -14, top: -8, width: "108%", height: 150 }}>
                        <Image source={require("../assets/iligan-home-header.jpg")} accessible={false} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
                      </View>
                      <Text style={{ color: "#71859b", fontSize: 16, lineHeight: 21 }}>Good day,</Text>
                      <Text accessibilityRole="header" adjustsFontSizeToFit numberOfLines={2} style={{ maxWidth: "95%", color: "#10263f", fontSize: 29, lineHeight: 35, fontWeight: "800", letterSpacing: -0.8 }}>Welcome, {q.data.profile.display_name || "neighbor"}.</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Choose your barangay" accessibilityHint="Updates the barangay on your profile" onPress={() => { setBarangayMessage(""); setBarangaysOpen(true); }} style={({ pressed }) => [{ minHeight: 48, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 9, marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, borderWidth: 1, borderColor: "#d9e9ed", backgroundColor: "#ffffffed" }, pressed && { opacity: 0.8 }]}>
                        <Ionicons name="location" size={19} color="#008d86" />
                        <Text numberOfLines={1} style={{ maxWidth: 215, color: "#526b82", fontSize: 14, fontWeight: "600" }}>{q.data.barangays.find((b) => b.id === q.data.profile.barangay_id)?.name || "Choose your barangay"} · Iligan City</Text>
                        <Ionicons name="chevron-down" size={16} color="#71859b" />
                      </Pressable>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Start a report" onPress={() => report()} style={({ pressed }) => [{ minHeight: 150, justifyContent: "center", padding: 20, borderRadius: 24, backgroundColor: "#073f47", overflow: "hidden", shadowColor: "#073f47", shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 }, pressed && { opacity: 0.92, transform: [{ scale: 0.995 }] }]}>
                      <View pointerEvents="none" style={{ position: "absolute", right: -50, top: -54, width: 225, height: 225, borderRadius: 120, borderWidth: 1, borderColor: "#ffffff16" }} />
                      <View pointerEvents="none" style={{ position: "absolute", right: -15, bottom: -100, width: 235, height: 190, borderRadius: 120, borderWidth: 1, borderColor: "#41c5b123" }} />
                      <View style={{ maxWidth: "60%", gap: 6 }}>
                        <Text style={{ color: "#b8efe8", fontSize: 11, fontWeight: "800", letterSpacing: 1.7 }}>REPORT & TRACK</Text>
                        <Text style={{ color: "white", fontSize: 21, lineHeight: 25, fontWeight: "800", letterSpacing: -0.45 }}>Report a local issue.</Text>
                        <Text style={{ color: "#d2e5e5", fontSize: 12, lineHeight: 18 }}>Help us build a cleaner, safer and stronger Iligan City. Share details and follow every update.</Text>
                      </View>
                      <View pointerEvents="none" style={{ position: "absolute", right: 56, bottom: 16, width: 70, height: 74, borderRadius: 13, padding: 9, backgroundColor: "#f4fbfc", transform: [{ rotate: "-7deg" }] }}>
                        <Ionicons name="location" size={23} color="#008d86" />
                        <View style={{ height: 6, width: 45, marginTop: 6, borderRadius: 4, backgroundColor: "#76c9c4" }} />
                        <View style={{ height: 5, width: 36, marginTop: 6, borderRadius: 4, backgroundColor: "#c6dce1" }} />
                      </View>
                      <View pointerEvents="none" style={{ position: "absolute", right: 35, bottom: 16, width: 43, height: 51, borderRadius: 9, borderWidth: 3, borderColor: "#d4eff0", backgroundColor: "#398e92", alignItems: "center", justifyContent: "center", transform: [{ rotate: "8deg" }] }}><Ionicons name="image-outline" size={24} color="#d4eff0" /></View>
                      <View style={{ position: "absolute", right: 20, top: "17%", width: 54, height: 54, borderRadius: 28, backgroundColor: "#00a99d", alignItems: "center", justifyContent: "center", shadowColor: "#001e22", shadowOpacity: 0.2, shadowRadius: 8, elevation: 3 }}><Ionicons name="arrow-forward" size={26} color="white" /></View>
                    </Pressable>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 50, marginTop: 3 }}>
                      <Text style={{ color: "#10263f", fontSize: 20, fontWeight: "800", letterSpacing: -0.3 }}>What can you report?</Text>
                      {q.data.categories.length > 4 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAllCategories }} onPress={() => setShowAllCategories((open) => !open)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 4 }}><Text style={{ color: "#008d86", fontSize: 13, fontWeight: "700" }}>{showAllCategories ? "Show less" : `See all ${q.data.categories.length}`}</Text><Ionicons name={showAllCategories ? "chevron-up" : "chevron-forward"} size={18} color="#008d86" /></Pressable>}
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 11 }}>
                      {(showAllCategories ? q.data.categories : q.data.categories.slice(0, 4)).map((item) => {
                        const tone = categoryToneFor(item.name);
                        const description = item.name.toLowerCase().includes("light") ? "Non-working or damaged lights" : item.name.toLowerCase().includes("road") ? "Potholes, cracks and road hazards" : item.name.toLowerCase().includes("drain") ? "Clogged, damaged or poor drainage" : item.name.toLowerCase().includes("waste") ? "Illegal dumping, overflowing bins" : item.name.toLowerCase().includes("wire") ? "Low-hanging or unsafe wires" : "Missing signs or faded road markings";
                        return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Report ${categoryDisplayName(item.name)}. ${description}`} style={({ pressed }) => [{ width: "48.5%", minHeight: 80, padding: 7, borderRadius: 20, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white", flexDirection: "row", alignItems: "center", gap: 6, shadowColor: "#10263f", shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 }, pressed && { backgroundColor: "#f7fbfa", opacity: 0.86 }]} onPress={() => report(item.id)}>
                          <View style={{ width: 38, height: 44, borderRadius: 17, backgroundColor: tone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(item.name)} size={23} color={tone.foreground} /></View>
                          <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={3} style={{ color: "#10263f", fontSize: 11, lineHeight: 14, fontWeight: "700" }}>{categoryDisplayName(item.name)}</Text><Text numberOfLines={2} style={{ color: "#71859b", fontSize: 10, lineHeight: 13 }}>{description}</Text></View>
                          <Ionicons name="chevron-forward" size={14} color="#9aabba" />
                        </Pressable>;
                      })}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 9, marginBottom: 1 }}>
                      <Text style={{ color: "#10263f", fontSize: 20, fontWeight: "800", letterSpacing: -0.3 }}>Your reports</Text>
                      <Text style={{ color: "#71859b", fontSize: 13 }}>{reportsQuery.data ? `${reportsQuery.data.count} total` : ""}</Text>
                    </View>
                    {reportsLoading ? <ListSkeleton variant="report" count={REPORT_PAGE_SIZE} label={`Loading report page ${page + 1}`} /> : reportsQuery.error ? (
                      <View style={s.card}><Text style={s.error}>Could not load your reports. {reportsQuery.error.message}</Text><Button secondary title="Retry reports" onPress={() => void reportsQuery.refetch()} /></View>
                    ) : homeReports.length ? (
                      homeReports.map((r) => {
                        const categoryName = q.data.categories.find((item) => item.id === r.category_id)?.name || "Community report";
                        const tone = statusToneFor(r.status);
                        return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${r.title}, ${label(r.status)}, open report progress`}
                          style={({ pressed }) => [{ minHeight: 96, flexDirection: "row", alignItems: "center", gap: 11, padding: 10, borderRadius: 20, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white", shadowColor: "#10263f", shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 }, pressed && { backgroundColor: "#f8fbf9", opacity: 0.9 }]}
                          key={r.id}
                          onPress={() => { setReportReturnTab("Home"); setSelected(r); }}
                        >
                          {reportPhotos.data?.[r.id] && !failedReportPhotos[r.id] ? <PhotoViewer source={{ uri: reportPhotos.data[r.id] }} label={`${categoryName} report photo`} onError={() => setFailedReportPhotos((value) => ({ ...value, [r.id]: true }))} style={{ width: 78, height: 78, borderRadius: 14, backgroundColor: "#eaf2f1" }} /> : <View style={{ width: 78, height: 78, borderRadius: 14, backgroundColor: categoryToneFor(categoryName).background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(categoryName)} size={27} color={categoryToneFor(categoryName).foreground} /></View>}
                          <View style={{ flex: 1, gap: 6 }}>
                            <Text style={[s.title, { fontSize: 15, lineHeight: 19 }]} numberOfLines={1}>{r.title}</Text>
                            <View style={[s.row, { gap: 7 }]}>
                              <View style={[s.statusBadge, { backgroundColor: tone.background }]}>
                                <Text style={[s.small, { color: tone.foreground, fontWeight: "700" }]}>{label(r.status)}</Text>
                              </View>
                              <Text style={s.small}>{new Date(r.created_at).toLocaleDateString()}</Text>
                            </View>
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                        </Pressable>
                        );
                      })
                    ) : (
                      <View style={s.card}>
                        <Ionicons
                          name="documents-outline"
                          size={30}
                          color={colors.muted}
                        />
                        <Text style={s.body}>
                          {page ? "No reports on this page." : "Your reports will appear here."}
                        </Text>
                        <Text style={s.small}>
                          Once submitted, you can follow every recorded update.
                        </Text>
                      </View>
                    )}
                    {(page > 0 || (reportsQuery.data?.count ?? 0) > REPORT_PAGE_SIZE) && <View style={{ gap: 9 }}>
                      <Text style={{ alignSelf: "flex-start", color: "#71859b", fontSize: 13 }} accessibilityLiveRegion="polite">{reportsLoading ? `Loading page ${page + 1}…` : `Page ${page + 1} of ${Math.max(1, Math.ceil((reportsQuery.data?.count ?? 0) / REPORT_PAGE_SIZE))}`}</Text>
                      <View style={s.actionRow}>
                        <Pressable accessibilityRole="button" accessibilityLabel="Previous report page" disabled={!page || reportsQuery.isFetching} onPress={() => setPage((value) => Math.max(0, value - 1))} style={{ flex: 1, minHeight: 54, borderWidth: 1, borderColor: "#e4eff0", borderRadius: 17, backgroundColor: "white", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: !page || reportsQuery.isFetching ? 0.48 : 1 }}><Ionicons name="chevron-back" size={19} color="#008d86" /><Text style={{ color: !page ? "#9aabba" : "#526b82", fontSize: 14, fontWeight: "700" }}>Previous</Text></Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel="Next report page" disabled={reportsQuery.isFetching || !!reportsQuery.error || (page + 1) * REPORT_PAGE_SIZE >= (reportsQuery.data?.count ?? 0)} onPress={() => setPage((value) => value + 1)} style={{ flex: 1, minHeight: 54, borderWidth: 1, borderColor: "#dcebe8", borderRadius: 17, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: reportsQuery.isFetching || !!reportsQuery.error || (page + 1) * REPORT_PAGE_SIZE >= (reportsQuery.data?.count ?? 0) ? 0.48 : 1 }}><Text style={{ color: "#008d86", fontSize: 14, fontWeight: "800" }}>Next</Text><Ionicons name="chevron-forward" size={19} color="#008d86" /></Pressable>
                      </View>
                    </View>}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 7 }}><Text style={{ color: "#10263f", fontSize: 20, fontWeight: "800", letterSpacing: -0.3 }}>From your community</Text><Pressable accessibilityRole="button" onPress={() => { setSelectedAnnouncement(null); setTab("Announcements"); }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: "#008d86", fontSize: 13, fontWeight: "700" }}>View all</Text></Pressable></View>
                    {q.data.announcements.length ? q.data.announcements.map((a) => (
                      <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`${a.kind}: ${a.title}. Open official update`} style={({ pressed }) => [{ minHeight: 94, flexDirection: "row", alignItems: "center", gap: 13, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white" }, pressed && { opacity: 0.85 }]} onPress={() => { setSelectedAnnouncement(a.id); setTab("Announcements"); }}>
                        <View style={{ width: 48, height: 48, borderRadius: 17, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={a.kind.toLowerCase().includes("meeting") ? "calendar-outline" : "megaphone-outline"} size={22} color="#008d86" /></View>
                        <View style={{ flex: 1, gap: 5 }}><Text style={{ color: "#008d86", fontSize: 10, fontWeight: "800", letterSpacing: 1.3 }}>{a.kind.toUpperCase()}</Text><Text numberOfLines={2} style={{ color: "#10263f", fontSize: 15, lineHeight: 20, fontWeight: "700" }}>{a.title}</Text><Text style={{ color: "#71859b", fontSize: 12 }}>Read official update</Text></View>
                        <Ionicons name="chevron-forward" size={18} color="#9aabba" />
                      </Pressable>
                    )) : <View style={{ minHeight: 86, borderRadius: 18, padding: 16, backgroundColor: "#ffffff", justifyContent: "center" }}><Text style={{ color: "#526b82", fontSize: 14 }}>No new community announcements.</Text><Text style={s.small}>Check back for official city and barangay updates.</Text></View>}
                    <Pressable accessibilityRole="button" onPress={() => { setSelectedAnnouncement(null); setTab("Announcements"); }} style={({ pressed }) => [{ minHeight: 54, borderRadius: 18, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }, pressed && { opacity: 0.82 }]}><Text style={{ color: "#008d86", fontSize: 15, fontWeight: "800" }}>All official announcements</Text><Ionicons name="chevron-forward" size={18} color="#008d86" /></Pressable>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 18, backgroundColor: "#eef5fb", borderWidth: 1, borderColor: "#dfebf6" }}><Ionicons name="information-circle" size={21} color="#3b73ba" /><Text style={{ flex: 1, color: "#5b7185", fontSize: 12, lineHeight: 18 }}>Not an emergency service. Stay clear of dangerous infrastructure while documenting a report.</Text></View>
                  </>
                )}
              </>
            )
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <SelectionSheet
        visible={barangaysOpen}
        onClose={() => setBarangaysOpen(false)}
        title="Choose a barangay"
        subtitle="Select your home barangay to see relevant community updates."
        searchPlaceholder="Search barangay"
        items={(q.data?.barangays || []).map((item) => ({ id: item.id, name: item.name, description: `Community updates for ${item.name}`, icon: "location-outline" as const, tone: { background: "#e5f6f2", foreground: colors.teal } }))}
        value={q.data?.profile.barangay_id || ""}
        loading={barangayBusy}
        error={barangayMessage}
        onConfirm={async (id) => {
          if (!user || q.data?.profile.barangay_id === id) return true;
          setBarangayBusy(true);
          try {
            await result(db!.from("profiles").update({ barangay_id: id }).eq("id", user));
            await qc.invalidateQueries({ queryKey: ["home", user] });
            return true;
          } catch (error) {
            setBarangayMessage((error as Error).message);
            return false;
          } finally { setBarangayBusy(false); }
        }}
      />
      <View style={s.nav}>
        {tabs.map(([name, icon]) => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === name }}
          style={[s.navItem, tab === name && s.navItemActive]}
            onPress={() => {
              if (tab === name && !selected) return;
              setSelected(null);
              if (name === "Report") report();
              else {
                if (name === "Community") setCommunityInitialTab("consultations");
                setTab(name);
              }
            }}
          >
            {name === "Report" ? (
              <View style={[s.navAction, tab === name && s.navActionActive]}>
                <Ionicons name={icon} size={22} color="white" />
              </View>
            ) : (
              <Ionicons
                name={icon}
                size={22}
                color={tab === name ? colors.teal : colors.muted}
              />
            )}
            <Text style={[s.navText, tab === name && { color: colors.teal }]}>
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
function Auth({ initialError }: { initialError: string }) {
  const [mode, setMode] = useState("login"),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(initialError),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false),
    [showDemoReview, setShowDemoReview] = useState(false);
  const [messageIsError, setMessageIsError] = useState(!!initialError);
  const providers = useQuery({
    queryKey: ["auth-providers"],
    enabled: configured,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
      });
      if (!response.ok) throw new Error("Sign-in options are temporarily unavailable.");
      return (await response.json()).external as Partial<Record<"google" | "facebook", boolean>>;
    },
  });
  const redirect = () =>
    Platform.OS === "web" ? window.location.origin : Linking.createURL("auth/callback");
  const changeMode = (next: string) => {
    setMode(next);
    setMessage("");
    setMessageIsError(false);
    setPassword("");
    setShowPassword(false);
  };
  async function signInSocial(provider: "google" | "facebook") {
    if (busy || !providers.data?.[provider]) return;
    setBusy(true); setMessage(""); setMessageIsError(false);
    try {
      const redirectTo = redirect();
      const { data, error } = await db!.auth.signInWithOAuth({
        provider,
        options: { redirectTo, ...(Platform.OS === "web" ? {} : { skipBrowserRedirect: true }) },
      });
      if (error) throw error;
      if (Platform.OS !== "web") {
        if (!data.url) throw new Error("The sign-in page could not be opened. Please try again.");
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === "success") {
          await completeAuthRedirect(result.url);
        } else if (result.type === "cancel") {
          setMessage("Sign-in was cancelled.");
        }
      }
    } catch (error) {
      const details = (error as Error).message || "";
      setMessage(/provider|unsupported/i.test(details)
        ? `${provider === "google" ? "Google" : "Facebook"} sign-in needs to be enabled by the administrator.`
        : details || "Could not sign in. Please try again.");
      setMessageIsError(true);
    } finally { setBusy(false); }
  }
  if (showDemoReview) return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[s.scroll, { gap: 13, paddingTop: 15 }]}>
        <Pressable accessibilityRole="button" onPress={() => setShowDemoReview(false)} style={{ minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="chevron-back" size={19} color={colors.teal} /><Text style={{ color: colors.teal, fontSize: 14, fontWeight: "700" }}>Back to sign in</Text></Pressable>
        <Text style={[s.heading, { fontSize: 27, lineHeight: 33 }]}>Report a concern</Text>
        <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 3 }}>
          {["Details", "Location", "Review"].map((title, index) => <View key={title} style={{ flex: 1, alignItems: "center", gap: 5 }}><View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: index === 2 ? colors.teal : "#e8f5f1", borderWidth: index === 2 ? 2 : 0, borderColor: "#bcebe1" }}><Text style={{ color: index === 2 ? "white" : colors.teal, fontSize: 13, fontWeight: "800" }}>{index < 2 ? "✓" : "3"}</Text></View><Text style={{ color: index === 2 ? colors.teal : colors.muted, fontSize: 11, fontWeight: index === 2 ? "800" : "600" }}>{title}</Text></View>)}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderRadius: 15, borderWidth: 1, borderColor: "#cdece5", backgroundColor: "#effaf7" }}><Ionicons name="eye-outline" size={20} color={colors.teal} /><View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.teal, fontSize: 12, fontWeight: "800" }}>SAMPLE REVIEW</Text><Text style={s.small}>Preview only. Nothing will be sent.</Text></View></View>
        <ReportReviewCard category="Damaged roads and potholes" problem="Pothole" title="Pothole collecting rainwater near Pala-o Market" description="A deep pothole has formed beside the road and fills with water after rain. It is difficult for drivers and pedestrians to see, especially at night." barangay="Pala-o" landmark="Near Pala-o Market" latitude={8.228} longitude={124.2452} />
        <Button secondary title="Back to sign in" onPress={() => setShowDemoReview(false)} />
      </ScrollView>
    </SafeAreaView>
  );
  return (
    <SafeAreaView style={[s.screen, { backgroundColor: colors.navy }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={s.authScroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={s.authHero}>
            <View style={s.authBrand}>
              <Image source={require("../assets/iligan-connect-logo.png")} accessibilityLabel="Iligan Connect logo" resizeMode="contain" style={{ width: 48, height: 48 }} />
              <View>
                <Text style={s.authBrandName}>ILIGAN CONNECT</Text>
                <Text style={s.authBrandPlace}>Community reporting · Iligan City</Text>
              </View>
            </View>
            <View style={s.authCopy}>
              <Text style={s.authKicker}>A CITY THAT LISTENS</Text>
              <Text accessibilityRole="header" style={s.authTitle}>
                Make your neighborhood count.
              </Text>
              <Text style={s.authSubtitle}>
                Share a local concern, follow what happens next, and join the conversation.
              </Text>
            </View>
          </View>
          <View style={s.authPanel}>
            <View style={[s.card, s.authCard]}>
              <View style={s.authCardHeading}>
                <Text accessibilityRole="header" style={s.authTitleText}>
                  {mode === "register"
                    ? "Join your community"
                    : mode === "reset"
                      ? "Recover your account"
                      : "Welcome back"}
                </Text>
                <Text style={s.small}>
                  {mode === "register"
                    ? "Create an account to report and follow local issues."
                    : mode === "reset"
                      ? "We’ll send a secure recovery link to your email."
                      : "Sign in to see your reports and community updates."}
                </Text>
              </View>
            {configured ? (
              <>
                {mode === "register" && (
                  <Field
                    label="Display name (required)"
                    placeholder="How should we address you?"
                    value={name}
                    onChangeText={setName}
                    maxLength={100}
                    autoComplete="name"
                  />
                )}
                <Field
                  label="Email address"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                />
                {mode !== "reset" && (
                  <Field
                    label={
                      mode === "register"
                        ? "Password (at least 12 characters)"
                        : "Password"
                    }
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                    trailing={
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                        accessibilityState={{ selected: showPassword }}
                        hitSlop={8}
                        onPress={() => setShowPassword((visible) => !visible)}
                        style={s.inputAction}
                      >
                        <Text style={s.inputActionText}>
                          {showPassword ? "Hide" : "Show"}
                        </Text>
                      </Pressable>
                    }
                  />
                )}
                <Button
                  title={
                    busy
                      ? "Please wait…"
                      : mode === "register"
                        ? "Create account"
                        : mode === "reset"
                          ? "Send recovery link"
                          : "Sign in"
                  }
                  disabled={
                    busy ||
                    !email ||
                    (mode === "register" && (password.length < 12 || name.trim().length < 2))
                  }
                  loading={busy}
                  onPress={async () => {
                    setBusy(true);
                    setMessage("");
                    setMessageIsError(false);
                    try {
                      if (mode === "reset") {
                        const { error } = await db!.auth.resetPasswordForEmail(
                          email.trim(),
                          { redirectTo: redirect() },
                        );
                        if (error) throw error;
                        setMessage(
                          "If this address is registered, check your email for a recovery link.",
                        );
                      } else {
                        const response =
                          mode === "register"
                            ? await db!.auth.signUp({
                                email: email.trim().toLowerCase(),
                                password,
                                options: {
                                  data: { display_name: name.trim() },
                                  emailRedirectTo: redirect(),
                                },
                              })
                            : await db!.auth.signInWithPassword({
                                email: email.trim().toLowerCase(),
                                password,
                              });
                        if (response.error) throw response.error;
                        if (mode === "register" && !response.data.session)
                          setMessage(
                            "Check your email to confirm your account, then sign in.",
                          );
                      }
                    } catch (e) {
                      setMessage((e as Error).message);
                      setMessageIsError(true);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                {mode !== "reset" && (providers.data?.google || providers.data?.facebook) && <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}><View style={{ height: 1, flex: 1, backgroundColor: "#e0eaee" }} /><Text style={{ color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.8 }}>OR CONTINUE WITH</Text><View style={{ height: 1, flex: 1, backgroundColor: "#e0eaee" }} /></View>
                  <View style={{ flexDirection: "row", gap: 9 }}>
                    {([ ["google", "logo-google", "Google", "#4285f4"], ["facebook", "logo-facebook", "Facebook", "#1877f2"] ] as const).filter(([provider]) => providers.data?.[provider]).map(([provider, icon, title, tint]) => <Pressable key={provider} accessibilityRole="button" accessibilityLabel={`Continue with ${title}`} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void signInSocial(provider)} style={({ pressed }) => [{ flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 13, borderWidth: 1, borderColor: "#dce7ed", backgroundColor: "white", opacity: busy ? 0.55 : pressed ? 0.78 : 1 }]}><Ionicons name={icon} size={18} color={tint} /><Text style={{ color: colors.navy, fontSize: 12, fontWeight: "700" }}>{title}</Text></Pressable>)}
                  </View>
                </>}
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  style={s.textAction}
                  onPress={() => changeMode(mode === "login" ? "register" : "login")}
                >
                  <Text style={s.textActionLabel}>
                    {mode === "login" ? "New here? Create an account" : mode === "register" ? "Already have an account? Sign in" : "Back to sign in"}
                  </Text>
                </Pressable>
                {mode === "login" && (
                  <Pressable accessibilityRole="button" style={s.textAction} onPress={() => changeMode("reset")}>
                    <Text style={s.small}>Forgot password?</Text>
                  </Pressable>
                )}
              </>
            ) : (
              <Text style={s.error}>
                The app is not connected yet. Ask the administrator to finish
                setup.
              </Text>
            )}
            {mode === "login" && <Pressable accessibilityRole="button" accessibilityLabel="View a sample report review without signing in" onPress={() => setShowDemoReview(true)} style={({ pressed }) => [{ minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 15, borderWidth: 1, borderColor: "#cdece5", backgroundColor: "#f2faf7" }, pressed && { opacity: 0.82 }]}>
              <View style={{ width: 37, height: 37, borderRadius: 13, backgroundColor: "#dff5ef", alignItems: "center", justifyContent: "center" }}><Ionicons name="eye-outline" size={19} color={colors.teal} /></View>
              <View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.navy, fontSize: 13, fontWeight: "800" }}>View a sample report review</Text><Text style={s.small}>Preview the final step without signing in.</Text></View>
              <Ionicons name="chevron-forward" size={17} color={colors.teal} />
            </Pressable>}
            {message && (
              <Text accessibilityRole="alert" style={messageIsError ? s.error : s.body}>
                {message}
              </Text>
            )}
          </View>
          <Text style={[s.small, s.authFoot]}>
            Not an emergency service. Your precise report location and
            photographs are protected.
          </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function PasswordChange({ onDone }: { onDone?: () => void }) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <View style={s.card}>
      <Field
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      <Field
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
      />
      <Button
        title={busy ? "Updating…" : "Update password"}
        disabled={busy || password.length < 12 || password !== confirm}
        onPress={async () => {
          setBusy(true);
          const { error } = await db!.auth.updateUser({ password });
          setMessage(error?.message || "Password updated.");
          if (!error) {
            setPassword("");
            setConfirm("");
            onDone?.();
          }
          setBusy(false);
        }}
      />
      {message && <Text style={s.body}>{message}</Text>}
    </View>
  );
}
function ProfileForm({
  profile: p,
  barangays,
  onNavigate,
}: {
  profile: Profile;
  barangays: Lookup[];
  onNavigate: (destination: "Home" | "Community", communityTab?: "consultations" | "meetings") => void;
}) {
  const [name, setName] = useState(p.display_name),
    [barangay, setBarangay] = useState(p.barangay_id || ""),
    [notifications, setNotifications] = useState(p.notifications_enabled),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [notificationBusy, setNotificationBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [password, setPassword] = useState(false),
    [privacy, setPrivacy] = useState(""),
    [help, setHelp] = useState(""),
    [photoMenu, setPhotoMenu] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false),
    [signOutConfirm, setSignOutConfirm] = useState(false),
    [signOutBusy, setSignOutBusy] = useState(false);
  const qc = useQueryClient();
  const writeLock = useRef(false);
  const photoLock = useRef(false);
  const auth = useQuery({
    queryKey: ["profile-auth", p.id],
    queryFn: async () => {
      const { data, error } = await db!.auth.getUser();
      if (error) throw error;
      return data.user;
    },
  });
  const avatar = useQuery({
    queryKey: ["profile-avatar", p.id, p.avatar_path],
    enabled: !!p.avatar_path,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => (await result<{ signedUrl: string }>(db!.storage.from("profile-media").createSignedUrl(p.avatar_path!, 3600))).signedUrl,
  });
  const activity = useQuery({
    queryKey: ["profile-activity", p.id],
    queryFn: () => result<{
      reports_submitted: number;
      discussions: number;
      meeting_requests: number;
    }[]>(db!.rpc("resident_activity_summary")),
  });
  const totals = activity.data?.[0];
  const userEmail = auth.data?.email || "Not available";
  const homeBarangay = barangays.find((item) => item.id === barangay)?.name || "Not set";
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join("") || "R";
  const version = (require("../app.json") as { expo: { version: string } }).expo.version;

  async function changePhoto(source: "gallery" | "camera") {
    if (photoLock.current) return;
    photoLock.current = true;
    setPhotoMenu(false);
    setPhotoBusy(true); setMessage("");
    try {
      if (Platform.OS !== "web") {
        const permission = source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) throw new Error(`Allow ${source === "camera" ? "camera" : "photo library"} access to add a profile picture.`);
      }
      const picked = source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
      if (picked.canceled || !picked.assets[0]) return;
      const optimized = await ImageManipulator.manipulateAsync(picked.assets[0].uri, [{ resize: { width: 900 } }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
      const bytes = await (await fetch(optimized.uri)).arrayBuffer();
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("This photo is too large. Choose a smaller image and try again.");
      const user = await db!.auth.getUser();
      if (user.data.user?.id !== p.id) throw new Error("Your session changed. Sign in again to update your photo.");
      const path = `${p.id}/${Crypto.randomUUID()}.jpg`;
      await result(db!.storage.from("profile-media").upload(path, bytes, { contentType: "image/jpeg" }));
      try {
        await result(db!.from("profiles").update({ avatar_path: path }).eq("id", p.id));
      } catch (error) {
        await db!.storage.from("profile-media").remove([path]);
        throw error;
      }
      const cleanup = p.avatar_path ? await db!.storage.from("profile-media").remove([p.avatar_path]) : null;
      await qc.invalidateQueries({ queryKey: ["profile-avatar", p.id] });
      await qc.invalidateQueries({ queryKey: ["home", p.id] });
      setMessage(cleanup?.error ? "Profile photo updated. The previous file still needs cleanup." : "Profile photo updated.");
    } catch (error) {
      setMessage((error as Error).message || "Could not update your profile photo. Please try again.");
    } finally { setPhotoBusy(false); photoLock.current = false; }
  }

  async function removePhoto() {
    if (!p.avatar_path || photoLock.current) return;
    photoLock.current = true;
    setPhotoMenu(false); setPhotoBusy(true); setMessage("");
    try {
      await result(db!.from("profiles").update({ avatar_path: null }).eq("id", p.id));
      const { error } = await db!.storage.from("profile-media").remove([p.avatar_path]);
      await qc.invalidateQueries({ queryKey: ["profile-avatar", p.id] });
      await qc.invalidateQueries({ queryKey: ["home", p.id] });
      setMessage(error ? "Profile photo removed. The previous file still needs cleanup." : "Profile photo removed.");
    } catch (error) {
      setMessage((error as Error).message || "Could not remove your profile photo. Please try again.");
    } finally { setPhotoBusy(false); photoLock.current = false; }
  }

  async function saveProfile() {
    const displayName = name.trim();
    if (displayName.length < 2) { setMessage("Enter a display name with at least 2 characters."); return; }
    if (writeLock.current) return;
    const changes: Partial<Pick<Profile, "display_name" | "barangay_id">> = {};
    if (displayName !== p.display_name) changes.display_name = displayName;
    if ((barangay || null) !== p.barangay_id) changes.barangay_id = barangay || null;
    if (!Object.keys(changes).length) { setEditing(false); setMessage("Your profile is already up to date."); return; }
    writeLock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await result(db!.from("profiles").update(changes).eq("id", p.id));
      await qc.invalidateQueries({ queryKey: ["home", p.id] });
      setEditing(false);
      setMessage("Profile updated.");
    } catch (error) {
      setMessage((error as Error).message || "Could not save your profile. Please try again.");
    } finally {
      setBusy(false);
      writeLock.current = false;
    }
  }

  async function updateNotifications(value: boolean) {
    if (notificationBusy || value === notifications) return;
    setNotificationBusy(true);
    setMessage("");
    try {
      await result(db!.from("profiles").update({ notifications_enabled: value }).eq("id", p.id));
      setNotifications(value);
      await qc.invalidateQueries({ queryKey: ["home", p.id] });
      setMessage(value ? "In-app updates are on." : "In-app updates are off.");
    } catch (error) {
      setMessage((error as Error).message || "Could not update your notification preference.");
    } finally { setNotificationBusy(false); }
  }

  async function confirmSignOut() {
    if (signOutBusy) return;
    setSignOutBusy(true);
    try {
      const { error } = await db!.auth.signOut();
      if (error) throw error;
      setSignOutConfirm(false);
    } catch (error) {
      setSignOutConfirm(false);
      setMessage((error as Error).message || "Could not sign out. Please try again.");
    } finally { setSignOutBusy(false); }
  }

  const activityCards = [
    { key: "reports", title: "Reports submitted", count: totals?.reports_submitted, icon: "document-text-outline" as const, tone: { background: "#e4f3ff", foreground: "#0875d1" }, action: () => onNavigate("Home") },
    { key: "discussions", title: "My discussions", count: totals?.discussions, icon: "chatbubble-ellipses-outline" as const, tone: { background: "#edf0ff", foreground: "#435fce" }, action: () => onNavigate("Community", "consultations") },
    { key: "meetings", title: "Meeting requests", count: totals?.meeting_requests, icon: "calendar-outline" as const, tone: { background: "#e5f6f2", foreground: colors.teal }, action: () => onNavigate("Community", "meetings") },
  ];
  const privacyItems = [
    { key: "profile", title: "Profile visibility", icon: "person-circle-outline" as const, body: "Your display name and home barangay are account details. Public report views use the report’s approved public information, not your private profile email." },
    { key: "location", title: "Report location privacy", icon: "location-outline" as const, body: "The city receives the precise location you confirm to assess the issue. Public map views use an approximate location." },
    { key: "photos", title: "Photo privacy", icon: "image-outline" as const, body: "Your profile picture is private to your account and is not shown on public reports. Report photos are shared with authorized reviewers under the report’s visibility settings." },
    { key: "data", title: "Account data", icon: "document-text-outline" as const, body: "Your profile, reports, community activity, and meeting requests remain linked to your account so you can track them. Historical report locations are not changed when you update your home barangay." },
  ];
  const helpItems = [
    { key: "report", title: "How to report an issue", body: "Choose an issue type, describe it, add a photo if useful, confirm the location and barangay, then review before submitting." },
    { key: "tracking", title: "Track a report", body: "Open a report from Home to see its current status and recorded progress updates. Follow a report to keep it easy to find." },
    { key: "community", title: "Join community discussions", body: "Community conversations share local topics and official replies. You can also submit a meeting request for staff review." },
  ];
  return (
    <>
      <View style={{ minHeight: 124, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 18, borderRadius: 22, backgroundColor: "#e8f4ef", borderWidth: 1, borderColor: "#dcece5", overflow: "hidden" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text accessibilityRole="header" style={[s.heading, { fontSize: 28, lineHeight: 34, marginBottom: 0 }]}>Your profile</Text>
          <Text style={[s.subtitle, { maxWidth: 230, marginBottom: 0 }]}>Manage your details and how Iligan Connect keeps in touch.</Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 54, height: 54, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#d5ebe2" }}>
          <Ionicons name="person-circle-outline" size={34} color={colors.teal} />
        </View>
      </View>

      <View style={{ minHeight: 112, flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 22, backgroundColor: "#073f47", borderWidth: 1, borderColor: "#073f47", overflow: "hidden", shadowColor: "#073f47", shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 }}>
        <View pointerEvents="none" style={{ position: "absolute", right: -30, top: -66, width: 190, height: 190, borderRadius: 100, borderWidth: 1, borderColor: "#ffffff20" }} />
        <Pressable accessibilityRole="button" accessibilityLabel={p.avatar_path ? "Change profile photo" : "Add profile photo"} disabled={photoBusy} onPress={() => setPhotoMenu(true)} style={({ pressed }) => [{ width: 62, height: 62, borderRadius: 22, backgroundColor: "#dff5ef", alignItems: "center", justifyContent: "center", overflow: "hidden" }, pressed && { opacity: 0.8 }]}>{avatar.data ? <Image source={{ uri: avatar.data }} accessibilityLabel="Your profile photo" resizeMode="cover" style={{ width: 62, height: 62 }} /> : <Text accessibilityLabel={`Avatar initials ${initials}`} style={{ color: colors.teal, fontSize: 23, fontWeight: "800" }}>{initials}</Text>}{photoBusy && <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#071b2770" }}><Ionicons name="hourglass-outline" size={19} color="white" /></View>}</Pressable>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={{ color: "#70d8ca", fontSize: 10, fontWeight: "800", letterSpacing: 1.35 }}>ILIGAN CONNECT ACCOUNT</Text><Text numberOfLines={2} style={{ color: "white", fontSize: 18, lineHeight: 22, fontWeight: "800" }}>{name.trim() || "Resident"}</Text><Text numberOfLines={1} style={{ color: "#d2e5e5", fontSize: 12 }}>{label(p.role)} · Iligan City</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={p.avatar_path ? "Edit profile photo" : "Add profile photo"} disabled={photoBusy} onPress={() => setPhotoMenu(true)} style={({ pressed }) => [{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: 12, borderWidth: 1, borderColor: "#44cbb7", opacity: photoBusy ? 0.6 : pressed ? 0.75 : 1 }]}><Ionicons name="camera-outline" size={17} color="#b8fff3" /><Text numberOfLines={1} style={{ color: "white", fontSize: 11, fontWeight: "700" }}>{photoBusy ? "Saving" : "Edit photo"}</Text></Pressable>
      </View>

      {message && <View accessibilityRole="alert" style={{ flexDirection: "row", gap: 7, alignItems: "flex-start", padding: 10, borderRadius: 13, backgroundColor: /updated|removed|up to date|are on|are off/i.test(message) ? "#eff9f5" : "#fff2f0" }}><Ionicons name={/updated|removed|up to date|are on|are off/i.test(message) ? "checkmark-circle-outline" : "alert-circle-outline"} size={18} color={/updated|removed|up to date|are on|are off/i.test(message) ? colors.teal : "#a43d35"} /><Text style={{ flex: 1, color: /updated|removed|up to date|are on|are off/i.test(message) ? colors.teal : "#a43d35", fontSize: 12, lineHeight: 17 }}>{message}</Text></View>}

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="person-circle-outline" size={21} color={colors.teal} /><Text style={[s.title, { flex: 1, marginBottom: 0 }]}>Personal details</Text><Pressable accessibilityRole="button" accessibilityLabel={editing ? "Cancel profile editing" : "Edit personal details"} onPress={() => { setMessage(""); if (editing) { setName(p.display_name); setBarangay(p.barangay_id || ""); } setEditing(!editing); }} style={({ pressed }) => [{ minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, borderRadius: 13, backgroundColor: "#e8f7f3" }, pressed && { opacity: 0.75 }]}><Ionicons name={editing ? "close-outline" : "create-outline"} size={17} color={colors.teal} /><Text style={{ color: colors.teal, fontSize: 12, fontWeight: "800" }}>{editing ? "Cancel" : "Edit"}</Text></Pressable></View>
        <View style={[s.card, { padding: 12, gap: 0, borderRadius: 18 }]}>
          {editing ? <>
            <Field label="Display name" placeholder="Your name" value={name} onChangeText={setName} maxLength={100} leading={<Ionicons name="person-outline" size={19} color={colors.teal} />} />
            <View style={{ gap: 7, marginTop: 3 }}><Text style={s.fieldLabel}>Your barangay</Text><Choices compact title="Choose a barangay" subtitle="Choose your home barangay for relevant local updates." sheetKind="barangay" items={barangays} value={barangay} onChange={setBarangay} leadingIcon="location-outline" /></View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}><Button grow secondary title="Cancel" disabled={busy} onPress={() => { setName(p.display_name); setBarangay(p.barangay_id || ""); setEditing(false); setMessage(""); }} /><Button grow title="Save changes" loading={busy} disabled={name.trim().length < 2} onPress={() => void saveProfile()} /></View>
          </> : <>
            <ProfileInfoRow icon="person-outline" label="Display name" value={name.trim() || "Not set"} />
            <ProfileInfoRow icon="location-outline" label="Your barangay" value={homeBarangay} />
            <ProfileInfoRow icon="mail-outline" label="Email address" value={userEmail} last />
          </>}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="options-outline" size={20} color={colors.teal} /><Text style={[s.title, { marginBottom: 0 }]}>Notification preferences</Text></View>
        <View style={[s.card, { padding: 12, gap: 8, borderRadius: 18 }]}>
          <View style={{ minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 15, backgroundColor: "#f5fbf9" }}>
            <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: "#e1f5f1", alignItems: "center", justifyContent: "center" }}><Ionicons name="notifications-outline" size={20} color={colors.teal} /></View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={s.fieldLabel}>In-app updates</Text><Text style={s.small}>Report, community, meeting and official announcement updates.</Text></View>
            <Switch accessibilityLabel="In-app updates for reports, community, meetings, and announcements" accessibilityState={{ disabled: notificationBusy, checked: notifications }} disabled={notificationBusy} value={notifications} onValueChange={(value) => void updateNotifications(value)} trackColor={{ false: colors.line, true: "#81cfc0" }} thumbColor={notifications ? colors.teal : "#f7faf8"} />
          </View>
          <Text style={[s.small, { paddingHorizontal: 8 }]}>Email and push alerts are not configured for this account yet.</Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="stats-chart-outline" size={20} color={colors.teal} /><Text style={[s.title, { marginBottom: 0 }]}>My activity</Text></View>
        <View style={{ flexDirection: "row", gap: 7 }}>
          {activityCards.map((item) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`${item.title}: ${item.count ?? (activity.isPending ? "loading" : "unavailable")}`} onPress={item.action} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 92, justifyContent: "space-between", gap: 5, padding: 8, borderRadius: 16, borderWidth: 1, borderColor: "#dfebee", backgroundColor: "white" }, pressed && { backgroundColor: "#f5fbf9", opacity: 0.84 }]}>
            <View style={{ width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: item.tone.background }}><Ionicons name={item.icon} size={17} color={item.tone.foreground} /></View>
            <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 10, lineHeight: 13, fontWeight: "600" }}>{item.title}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 3 }}><Text style={{ color: colors.navy, fontSize: 17, fontWeight: "800" }}>{activity.isPending ? "…" : activity.error ? "—" : item.count ?? 0}</Text><Ionicons name="chevron-forward" size={15} color={colors.muted} /></View>
          </Pressable>)}
        </View>
        {activity.error && <Pressable accessibilityRole="button" onPress={() => void activity.refetch()} style={{ minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}><Ionicons name="refresh-outline" size={15} color={colors.teal} /><Text style={[s.small, { color: colors.teal }]}>Activity counts unavailable · Retry</Text></Pressable>}
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="lock-closed-outline" size={19} color={colors.teal} /><Text style={[s.title, { marginBottom: 0 }]}>Account & security</Text></View>
        <View style={[s.card, { padding: 12, gap: 2, borderRadius: 18 }]}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: password }} onPress={() => setPassword(!password)} style={({ pressed }) => [{ minHeight: 55, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 }, pressed && { opacity: 0.78 }]}>
            <View style={{ width: 39, height: 39, borderRadius: 14, backgroundColor: "#e8f4ff", alignItems: "center", justifyContent: "center" }}><Ionicons name="key-outline" size={19} color="#2879b4" /></View>
            <View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.navy, fontSize: 13, fontWeight: "800" }}>Change password</Text><Text style={s.small}>Update your sign-in password securely.</Text></View><Ionicons name={password ? "chevron-up" : "chevron-forward"} size={18} color={colors.muted} />
          </Pressable>
          {password && <View style={{ paddingHorizontal: 3, paddingBottom: 9 }}><PasswordChange /></View>}
          <View style={{ height: 1, backgroundColor: colors.line, marginHorizontal: 2 }} />
          <View style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 }}><View style={{ width: 39, height: 39, borderRadius: 14, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="mail-outline" size={19} color={colors.teal} /></View><View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: colors.navy, fontSize: 13, fontWeight: "800" }}>Email verification</Text><Text numberOfLines={1} style={s.small}>{auth.data?.email_confirmed_at ? "Email address verified" : auth.isPending ? "Checking account status…" : auth.data?.email ? "Email address not verified" : "Verification status unavailable"}</Text></View><Ionicons name={auth.data?.email_confirmed_at ? "checkmark-circle" : "information-circle-outline"} size={18} color={auth.data?.email_confirmed_at ? "#07845a" : colors.muted} /></View>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="shield-checkmark-outline" size={20} color={colors.teal} /><Text style={[s.title, { marginBottom: 0 }]}>Privacy & data</Text></View>
        <View style={[s.card, { padding: 12, gap: 0, borderRadius: 18 }]}>
          {privacyItems.map((item, index) => <View key={item.key}>
            {index > 0 && <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 48 }} />}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: privacy === item.key }} onPress={() => setPrivacy(privacy === item.key ? "" : item.key)} style={({ pressed }) => [{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 }, pressed && { opacity: 0.78 }]}>
              <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: item.key === "location" ? "#e8f4ff" : "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={item.icon} size={18} color={item.key === "location" ? "#2879b4" : colors.teal} /></View>
              <Text style={{ flex: 1, color: colors.navy, fontSize: 13, fontWeight: "700" }}>{item.title}</Text><Ionicons name={privacy === item.key ? "chevron-up" : "chevron-forward"} size={17} color={colors.muted} />
            </Pressable>
            {privacy === item.key && <Text style={[s.small, { paddingLeft: 48, paddingRight: 6, paddingBottom: 11 }]}>{item.body}</Text>}
          </View>)}
          <Text style={[s.small, { marginTop: 5, paddingHorizontal: 3 }]}>Account deletion is not available in the app. An official request channel and records-retention review are needed before deletion can be safely offered.</Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="help-circle-outline" size={20} color={colors.teal} /><Text style={[s.title, { marginBottom: 0 }]}>Help & support</Text></View>
        <View style={[s.card, { padding: 12, gap: 1, borderRadius: 18 }]}>
          {helpItems.map((item, index) => <View key={item.key}>
            {index > 0 && <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 43 }} />}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: help === item.key }} onPress={() => setHelp(help === item.key ? "" : item.key)} style={({ pressed }) => [{ minHeight: 46, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 2 }, pressed && { opacity: 0.78 }]}><Ionicons name="chevron-forward" size={16} color={colors.teal} /><Text style={{ flex: 1, color: colors.navy, fontSize: 13, fontWeight: "700" }}>{item.title}</Text><Ionicons name={help === item.key ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} /></Pressable>
            {help === item.key && <Text style={[s.small, { paddingLeft: 25, paddingBottom: 10 }]}>{item.body}</Text>}
          </View>)}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 7, padding: 10, borderRadius: 13, backgroundColor: "#eef5fb" }}><Ionicons name="information-circle-outline" size={18} color="#3776b7" style={{ marginTop: 1 }} /><Text style={[s.small, { flex: 1, color: "#355675" }]}>Iligan Connect helps report and coordinate civic issues. It is not an emergency response service. For immediate danger, contact local emergency services.</Text></View>
          <Text style={[s.small, { paddingHorizontal: 3, marginTop: 5 }]}>No in-app support contact is configured. Use official Iligan City channels for account-specific assistance.</Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="information-circle-outline" size={20} color={colors.teal} /><Text style={[s.title, { marginBottom: 0 }]}>About Iligan Connect</Text></View>
        <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 11, padding: 13, borderRadius: 18 }]}><View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="leaf-outline" size={20} color={colors.teal} /></View><View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.navy, fontSize: 14, fontWeight: "800" }}>Iligan Connect</Text><Text style={s.small}>A cleaner · safer · stronger Iligan</Text></View><Text style={[s.small, { fontWeight: "700" }]}>v{version}</Text></View>
      </View>

      <Pressable accessibilityRole="button" onPress={() => setSignOutConfirm(true)} style={({ pressed }) => [{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: 15, borderWidth: 1, borderColor: "#f1d9d7", backgroundColor: "white" }, pressed && { opacity: 0.78 }]}><Ionicons name="log-out-outline" size={20} color="#ad403d" /><Text style={{ flex: 1, color: "#ad403d", fontSize: 14, fontWeight: "800" }}>Sign out</Text><Ionicons name="chevron-forward" size={17} color="#ad403d" /></Pressable>


      <Modal visible={signOutConfirm} transparent animationType="fade" onRequestClose={() => !signOutBusy && setSignOutConfirm(false)}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 22, backgroundColor: "#071b27aa" }}>
          <View accessibilityRole="alert" style={[s.card, { width: "100%", maxWidth: 390, padding: 20, gap: 12, borderRadius: 22 }]}>
            <View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: "#fff0ee", alignItems: "center", justifyContent: "center" }}><Ionicons name="log-out-outline" size={22} color="#ad403d" /></View>
            <Text style={[s.title, { fontSize: 19 }]}>Sign out of Iligan Connect?</Text>
            <Text style={s.small}>You can sign in again anytime. Your reports, requests, and profile will remain saved.</Text>
            <View style={{ flexDirection: "row", gap: 9, marginTop: 3 }}><Button grow secondary title="Cancel" disabled={signOutBusy} onPress={() => setSignOutConfirm(false)} /><Pressable accessibilityRole="button" accessibilityState={{ disabled: signOutBusy, busy: signOutBusy }} disabled={signOutBusy} onPress={() => void confirmSignOut()} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#ad403d", opacity: signOutBusy ? 0.6 : 1 }, pressed && !signOutBusy && { opacity: 0.84 }]}><Text style={s.buttonText}>{signOutBusy ? "Signing out…" : "Sign out"}</Text></Pressable></View>
          </View>
        </View>
      </Modal>
      <Modal visible={photoMenu} transparent animationType="slide" onRequestClose={() => !photoBusy && setPhotoMenu(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#071b2766" }}>
          <Pressable accessibilityLabel="Close photo options" onPress={() => !photoBusy && setPhotoMenu(false)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
          <View style={{ padding: 20, paddingBottom: 28, gap: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: "white" }}>
            <View style={{ width: 38, height: 4, borderRadius: 3, backgroundColor: "#cbd8df", alignSelf: "center", marginBottom: 5 }} />
            <Text style={[s.title, { fontSize: 19, marginBottom: 0 }]}>Profile photo</Text>
            <Text style={s.small}>Choose a clear square photo. It stays private to your account.</Text>
            <PhotoAction icon="images-outline" title="Choose from photos" onPress={() => void changePhoto("gallery")} />
            {Platform.OS !== "web" && <PhotoAction icon="camera-outline" title="Take a photo" onPress={() => void changePhoto("camera")} />}
            {!!p.avatar_path && <PhotoAction icon="trash-outline" title="Remove photo" destructive onPress={() => void removePhoto()} />}
            <Pressable accessibilityRole="button" onPress={() => setPhotoMenu(false)} style={{ minHeight: 46, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.muted, fontSize: 13, fontWeight: "700" }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function PhotoAction({ icon, title, onPress, destructive = false }: { icon: "images-outline" | "camera-outline" | "trash-outline"; title: string; onPress: () => void; destructive?: boolean }) {
  const color = destructive ? "#ad403d" : colors.teal;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: destructive ? "#f1d9d7" : "#dcece9", backgroundColor: destructive ? "#fff8f7" : "#f7fbfa" }, pressed && { opacity: 0.78 }]}><Ionicons name={icon} size={20} color={color} /><Text style={{ color, fontSize: 14, fontWeight: "700" }}>{title}</Text></Pressable>;
}

function ProfileInfoRow({ icon, label, value, last = false }: { icon: "person-outline" | "location-outline" | "mail-outline"; label: string; value: string; last?: boolean }) {
  return <View>
    <View style={{ minHeight: 67, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 2, paddingVertical: 8 }}>
      <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={19} color={colors.teal} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={s.small}>{label}</Text><Text selectable numberOfLines={2} style={{ color: colors.navy, fontSize: 14, lineHeight: 19, fontWeight: "600" }}>{value}</Text></View>
    </View>
    {!last && <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 51 }} />}
  </View>;
}

function NotificationCenter({
  profileId,
  backLabel,
  onBack,
  onNavigate,
}: {
  profileId: string;
  backLabel: string;
  onBack: () => void;
  onNavigate: (t: string, reportId?: string | null, communitySection?: "consultations" | "meetings", announcementId?: string | null) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications", profileId],
    queryFn: () =>
      result<{
        id: string;
        title: string;
        read_at: string | null;
        report_id: string | null;
        consultation_id: string | null;
        meeting_request_id: string | null;
        announcement_id: string | null;
        created_at: string;
      }[]>(
        db!
          .from("notifications")
          .select("id,title,read_at,report_id,consultation_id,meeting_request_id,announcement_id,created_at")
          .order("created_at", { ascending: false })
          .limit(50),
      ),
  });
  const notifications = q.data || [];
  const unreadCount = notifications.filter((item) => !item.read_at).length;
  const readCount = notifications.length - unreadCount;
  const visibleNotifications = notifications.filter((item) => filter === "all" || (filter === "unread" ? !item.read_at : !!item.read_at));
  return (
    <>
      <View style={{ minHeight: 142, justifyContent: "space-between", paddingVertical: 4, overflow: "hidden" }}>
        <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: "absolute", right: -18, top: 0, width: 360, height: 120, opacity: 0.2 }}>
          <Image source={require("../assets/iligan-notifications-header.jpg")} resizeMode="contain" style={{ width: "100%", height: "100%" }} />
        </View>
        <AppBackNavigation label={backLabel} onBack={onBack} />
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text accessibilityRole="header" style={[s.heading, { fontSize: 29, lineHeight: 36 }]}>Notifications</Text>
            <Text style={s.subtitle}>Updates about your reports and community.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Filter notifications, currently ${filter}`} accessibilityHint="Choose all, unread, or read notifications" accessibilityState={{ expanded: filterOpen }} onPress={() => setFilterOpen(true)} style={({ pressed }) => [{ minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: "#dcebe7", backgroundColor: "#ffffffed" }, pressed && { opacity: 0.75 }]}>
            <Ionicons name="options-outline" size={17} color={colors.teal} />
            <Text style={{ color: colors.navy, fontSize: 13, fontWeight: "700" }}>{filter === "all" ? "All" : filter === "unread" ? "Unread" : "Read"}</Text>
            <Ionicons name="chevron-down" size={15} color={colors.muted} />
          </Pressable>
        </View>
      </View>
      {q.isPending ? (
        <ListSkeleton variant="notification" count={5} label="Loading notifications" />
      ) : q.error ? (
        <View style={s.card}><Text accessibilityRole="alert" style={s.error}>{q.error.message}</Text><Button secondary title="Retry notifications" loading={q.isFetching} onPress={() => void q.refetch()} /></View>
      ) : visibleNotifications.length ? (
        visibleNotifications.map((n) => {
          const icon = n.report_id
            ? "document-text-outline"
            : n.title.toLowerCase().includes("meeting")
            ? "calendar-outline"
            : n.announcement_id
              ? "megaphone-outline"
              : "chatbubble-ellipses-outline";
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${n.read_at ? "Read" : "Unread"} notification: ${n.title}`}
              accessibilityHint="Opens the related report or community update"
              style={({ pressed }) => [{ minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 18, borderWidth: 1, borderColor: "#e5eff1", backgroundColor: "white", shadowColor: colors.navy, shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 }, pressed && { backgroundColor: "#f3f8f5" }]}
              key={n.id}
              disabled={opening !== null}
              accessibilityState={{ disabled: opening !== null, busy: opening === n.id }}
              onPress={async () => {
                setOpening(n.id);
                setMessage("");
                try {
                const destination = n.announcement_id
                  ? "Announcements"
                  : n.consultation_id || n.meeting_request_id
                    ? "Community"
                    : "Home";
                await onNavigate(destination, n.report_id, n.meeting_request_id ? "meetings" : undefined, n.announcement_id);
                if (!n.read_at) {
                  await result(
                    db!.from("notifications")
                      .update({ read_at: new Date().toISOString() })
                      .eq("id", n.id),
                  ).then(() => Promise.all([
                    qc.invalidateQueries({ queryKey: ["home"] }),
                    qc.invalidateQueries({ queryKey: ["notifications", profileId] }),
                  ])).catch((error) => {
                    setMessage((error as Error).message);
                  });
                }
                } catch (error) { setMessage((error as Error).message); }
                finally { setOpening(null); }
              }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: "#e7f7f3", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={icon} size={23} color={colors.teal} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={[s.body, { fontSize: 14, lineHeight: 19, fontWeight: n.read_at ? "500" : "700" }]} numberOfLines={2}>{n.title}</Text>
                <Text style={s.small}>{opening === n.id ? "Opening update…" : new Date(n.created_at).toLocaleString()}</Text>
              </View>
              {!n.read_at && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal }} />}
              <Ionicons name="chevron-forward" size={17} color={colors.muted} />
            </Pressable>
          );
        })
      ) : (
        <View style={[s.card, { alignItems: "center", paddingVertical: 28 }]}>
          <View style={{ width: 56, height: 56, borderRadius: 20, backgroundColor: "#e7f7f3", alignItems: "center", justifyContent: "center" }}><Ionicons name="notifications-off-outline" size={26} color={colors.teal} /></View>
          <Text style={s.title}>{filter === "all" ? "You’re all caught up" : `No ${filter} notifications`}</Text>
          <Text style={[s.small, { textAlign: "center" }]}>{filter === "all" ? "Updates about your reports and community will appear here." : "Choose another filter to see more notifications."}</Text>
        </View>
      )}
      {message && <Text accessibilityRole="alert" style={s.error}>{message}</Text>}
      <Modal visible={filterOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setFilterOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#10263f77" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close notification filters" onPress={() => setFilterOpen(false)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
          <View style={{ paddingTop: 10, paddingHorizontal: 18, paddingBottom: 28, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "white", gap: 8 }}>
            <View style={{ alignSelf: "center", width: 46, height: 5, borderRadius: 3, backgroundColor: "#c8d2df", marginBottom: 5 }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <View style={{ gap: 2 }}><Text accessibilityRole="header" style={{ color: colors.navy, fontSize: 20, fontWeight: "800" }}>Filter notifications</Text><Text style={s.small}>Choose which updates to show.</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close notification filters" onPress={() => setFilterOpen(false)} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#eff3f8" }}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>
            </View>
            {([
              ["all", "All notifications", notifications.length, "notifications-outline"],
              ["unread", "Unread", unreadCount, "mail-unread-outline"],
              ["read", "Read", readCount, "mail-open-outline"],
            ] as const).map(([id, title, count, icon]) => {
              const selected = filter === id;
              return <Pressable key={id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => { setFilter(id); setFilterOpen(false); }} style={({ pressed }) => [{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: selected ? "#b9e7df" : "#e2eaf2", backgroundColor: selected ? "#f0faf8" : "white" }, pressed && { opacity: 0.8 }]}>
                <Ionicons name={icon} size={20} color={selected ? colors.teal : colors.muted} />
                <Text style={{ flex: 1, color: selected ? colors.teal : colors.navy, fontSize: 14, fontWeight: selected ? "700" : "600" }}>{title}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{count}</Text>
                {selected && <Ionicons name="checkmark-circle" size={19} color={colors.teal} />}
              </Pressable>;
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}
