import type { KeyboardEvent } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  Image,
  ActivityIndicator,
  Modal,
  ScrollView,
  Pressable,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  AppState,
  Linking as NativeLinking,
  Switch,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import { syncResidentBackgroundAlerts } from "../lib/background-alerts";
import { expoProjectId, getDevicePushPreference, hasRegisteredDevicePushToken, registerDevicePushToken, removeDevicePushTokens, setDevicePushPreference } from "../lib/push-notifications";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { db, result, configured } from "../lib/client";
import { styles as s, Button, Field, Choices, SelectionSheet, PhotoViewer, AppBackNavigation, colors, categoryIconFor, categoryToneFor, statusToneFor, categoryDisplayName } from "../components/ui";
import { Profile, Lookup, Report, label, textInputError, residentNamePartsError, residentDisplayName, residentAgeError, emailInputError, mobileInputError, normalizePhilippineMobile, passwordInputError, MIN_PASSWORD_LENGTH, EMAIL_OTP_LENGTH, EMAIL_OTP_EXPIRY_SECONDS, EMAIL_RESEND_INTERVAL_SECONDS } from "@community/shared";
import { ReportForm, ReportTracking, Explore as ExploreScreen } from "../features/reports";
import { Community as CommunityScreen, Announcements } from "../features/community";
import { ListSkeleton } from "../components/loading";
const REPORT_PAGE_SIZE = 5;
const RESIDENT_TERMS_VERSION = "2026-11-15";
const RESIDENT_TERMS = [
  { title: "1. What Iligan Connect is for", body: "Iligan Connect helps residents report local community concerns, follow case updates, and take part in public discussions. It is not an emergency service. For an immediate threat to life or safety, contact emergency services or the appropriate local responders." },
  { title: "2. Your account", body: "Provide accurate personal details, email, age, and home barangay. Keep your password and verification codes private. Do not impersonate another person, create misleading accounts, or use another person’s account without permission. If you are under 18, ask a parent or guardian to review these terms with you before using the service." },
  { title: "3. Reports and location", body: "Submit genuine concerns and describe them honestly. A report needs a valid map pin and barangay so staff can route it. GPS is optional; you may place the pin yourself. The exact pin and any Purok, Zone, or address details are available to authorized city, barangay, and assigned office staff for review and response. Public maps may show an approximate location after staff review. Reports do not guarantee a specific response time or outcome." },
  { title: "4. Photos and other content", body: "Only upload text and photos you have the right to share. Avoid unnecessary faces, private documents, phone numbers, and details that could put someone at risk. Submitted material may be reviewed by authorized personnel and may appear publicly when approved for community display. You keep ownership of your content and allow the service to use it as needed to review, route, respond to, and display the report or discussion." },
  { title: "5. Community discussions", body: "Keep comments and replies relevant, respectful, and lawful. Do not harass others, post threats, expose private information, or submit spam or knowingly false claims. Residents can report a comment for review. Authorized community staff may review, hide, or restore comments and resolve reports about them." },
  { title: "6. Following and notifications", body: "Following a report or conversation lets the service send you in-app updates about it. Phone notifications depend on your device permission, internet access, and the notification service being available. You can change notification preferences in your profile; delivery may be delayed or unavailable." },
  { title: "7. Personal information and privacy rights", body: "The service uses account details, report content, location, photos, comments, and notification preferences to operate the account, assess and route concerns, coordinate public services, and send requested updates. Relevant details are shared with authorized personnel and service providers supporting the service. Precise report locations and contact details are restricted to authorized staff; only approved public information is shown to other users. Information is retained under applicable laws and records requirements. You may exercise applicable rights to be informed, access or correct information, object to processing, or seek other remedies under Philippine privacy law through the city office administering the service. This agreement does not remove those rights." },
  { title: "8. Misuse and service changes", body: "The city may limit, hide, or suspend access when needed to address abuse, protect users, or comply with law. The service may be updated or temporarily unavailable. Staff review and routing are human decisions; submitting a report does not itself establish that an allegation is verified." },
  { title: "9. Agreement", body: "By checking the agreement box and creating an account, you confirm that you have read and agree to these Terms of Use. The current version is shown before registration. Your agreement does not replace the service’s duty to provide required privacy information or protect your personal data." },
];
const Explore = memo(ExploreScreen);
const Community = memo(CommunityScreen);
if (Platform.OS === "web") WebBrowser.maybeCompleteAuthSession();
function formatAuthError(error: unknown, step: "sign-in" | "verification" | "resend" | "recovery" | "password" = "sign-in") {
  const detail = error instanceof Error ? error.message.toLowerCase() : "";
  if (step === "sign-in" && /invalid login credentials|invalid credentials|email or password/.test(detail)) return "Email or password is incorrect.";
  if (step === "sign-in" && /email not confirmed|email is not confirmed/.test(detail)) return "Confirm your email address before signing in.";
  if (detail.includes("terms")) return "New resident accounts must be created with email after accepting the current Terms and Conditions. Existing social accounts can still sign in.";
  if (detail.includes("rate limit") || detail.includes("too many requests")) return "Too many attempts. Wait a few minutes before trying again.";
  if (detail.includes("network") || detail.includes("fetch")) return "We could not reach the sign-in service. Check your connection and retry.";
  if (step === "verification") return "That code is invalid or expired. Check the email or request a new code.";
  if (step === "resend") return "We could not send a new code just now. Wait a moment, then try again.";
  if (step === "recovery") return "We could not start account recovery. Please try again shortly.";
  if (step === "password") return "We could not update your password. Check the requirements and try again.";
  return "We could not sign you in. Check your details, confirm your email if needed, and retry.";
}
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
  const compactPhone = useWindowDimensions().width < 360;
  const [user, setUser] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("Home"),
    [selected, setSelected] = useState<Report | null>(null),
    [selectedAnnouncement, setSelectedAnnouncement] = useState<string | null>(null),
    [communityTarget, setCommunityTarget] = useState<{ consultationId?: string | null; meetingRequestId?: string | null }>({}),
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
    [exploreMapGestureActive, setExploreMapGestureActive] = useState(false),
    [notificationReturnTab, setNotificationReturnTab] = useState("Home"),
    [reportReturnTab, setReportReturnTab] = useState("Home"),
    [communityInitialTab, setCommunityInitialTab] = useState<"consultations" | "meetings">("consultations");
  const qc = useQueryClient();
  const sessionUser = useRef<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const exploreScrollY = useRef(0);
  const mainScrollY = useRef(0);
  const onMapPageScroll = useCallback((delta: number) => {
    const nextY = Math.max(0, mainScrollY.current + delta);
    mainScrollY.current = nextY;
    if (tab === "Explore" && !selected) exploreScrollY.current = nextY;
    scroll.current?.scrollTo({ y: nextY, animated: false });
  }, [tab, selected]);
  const openExploreReport = useCallback((report: Report) => {
    setReportReturnTab("Explore");
    setSelected(report);
  }, []);
  useEffect(() => {
    if (reportReturnTab === "Explore" && (selected || tab === "Explore")) {
      const nextY = selected ? 0 : exploreScrollY.current;
      mainScrollY.current = nextY;
      scroll.current?.scrollTo({ y: nextY, animated: false });
      return;
    }
    mainScrollY.current = 0;
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [tab, selected?.id, reportReturnTab]);
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    let active = true, sessionVersion = 0;
    db.auth.getSession().then(({ data, error }) => {
      if (!active || sessionVersion) return;
      sessionUser.current = data.session?.user.id ?? null;
      setUser(data.session?.user.id ?? null);
      if (error) setAuthError(formatAuthError(error));
      setLoading(false);
    }).catch((error: Error) => {
      if (!active || sessionVersion) return;
      setAuthError(formatAuthError(error));
      setLoading(false);
    });
    const { data } = db.auth.onAuthStateChange((event, session) => {
      sessionVersion++;
      const nextUser = session?.user.id ?? null;
      const accountChanged = !!sessionUser.current && sessionUser.current !== nextUser;
      sessionUser.current = nextUser;
      setUser(nextUser);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT" || accountChanged) {
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
        setAuthError(formatAuthError(e, "verification"));
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
      active = false;
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
    refetchInterval: 30_000,
    queryFn: async () => {
      const [profile, categories, barangays, announcements, unread, settings] = await Promise.all([
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
      result<{ include_samples: boolean }>(db!.from("analytics_settings").select("include_samples").single()),
      ]);
      if (unread.error) throw new Error(unread.error.message);
      return { profile, categories, barangays, announcements, unreadCount: unread.count ?? 0, includeSamples: settings.include_samples };
    },
  });
  useEffect(() => {
    if (q.data?.profile.role === "resident" && !q.data.profile.barangay_id) {
      setBarangayMessage("Choose your registered barangay to finish setting up your resident profile.");
      setBarangaysOpen(true);
    }
  }, [q.data?.profile.id, q.data?.profile.barangay_id, q.data?.profile.role]);
  const reportsQuery = useQuery({
    queryKey: ["my-reports", user, page, q.data?.includeSamples],
    enabled: !!user && !!q.data && tab === "Home" && !selected,
    refetchInterval: 30_000,
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
      if (!attachments.length) return { urls: {} as Record<string, string> };
      const urls = await db!.storage.from("report-evidence").createSignedUrls(attachments.map((item) => item.path), 3600);
      if (urls.error) throw urls.error;
      return { urls: Object.fromEntries(attachments.flatMap((item, index) => urls.data[index]?.signedUrl ? [[item.report_id, urls.data[index].signedUrl!]] : [])) };
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
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 11 }}>
          <Image source={require("../assets/iligan-connect-logo.png")} accessibilityLabel="Iligan Connect logo" resizeMode="contain" style={{ width: 46, height: 46 }} />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text numberOfLines={1} style={[s.eyebrow, { color: colors.brand, fontSize: 13, letterSpacing: 1.8 }]}>ILIGAN CONNECT</Text>
            {!compactPhone && <Text numberOfLines={1} style={{ fontSize: 9, letterSpacing: 1.3, color: "#5d7378", fontWeight: "600" }}>A CLEANER · SAFER · STRONGER ILIGAN</Text>}
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
            color={colors.brandDark}
          />
          {!!q.data?.unreadCount && (
            <View
              style={{
                position: "absolute",
                right: 8,
                top: 6,
                width: 8,
                height: 8,
                backgroundColor: colors.brand,
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
          style={Platform.select({ web: { flex: 1, scrollPaddingBottom: 124 } })}
          ref={scroll}
          scrollEnabled={!(tab === "Explore" && !selected && exploreMapGestureActive)}
          onScroll={(event) => { mainScrollY.current = event.nativeEvent.contentOffset.y; if (tab === "Explore" && !selected) exploreScrollY.current = mainScrollY.current; }}
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
              tintColor={colors.brand}
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
                    onMapGestureActiveChange={setExploreMapGestureActive}
                    onMapPageScroll={onMapPageScroll}
                    suspendExpandedMap={!!selected && reportReturnTab === "Explore"}
                    includeSamples={q.data.includeSamples}
                  />
                </View>}
                {selected ? (
                  <ReportTracking
                    key={selected.id}
                    report={selected}
                    residentId={q.data.profile.id}
                    categoryName={q.data.categories.find((item) => item.id === selected.category_id)?.name ?? "Community report"}
                    barangayName={q.data.barangays.find((item) => item.id === selected.barangay_id)?.name ?? "Iligan City"}
                    onMapPageScroll={onMapPageScroll}
                    backLabel={reportReturnTab === "Notifications" ? "Back to notifications" : reportReturnTab === "Explore" ? "Back to map" : "Back to reports"}
                    close={() => { setSelected(null); setTab(reportReturnTab); }}
                  />
                ) : tab === "Report" ? (
                  <ReportForm
                    residentProfile={q.data.profile}
                    onEditProfile={() => setTab("Profile")}
                    categories={q.data.categories}
                    barangays={q.data.barangays}
                    initialCategory={category}
                    initialBarangay={q.data.profile.barangay_id || ""}
                    onMapPageScroll={onMapPageScroll}
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
                    initialConsultationId={communityTarget.consultationId}
                    initialMeetingRequestId={communityTarget.meetingRequestId}
                  />
                ) : tab === "Announcements" ? (
                  <Announcements barangays={q.data.barangays} initialSelected={selectedAnnouncement} />
                ) : tab === "Notifications" ? (
                  <NotificationCenter
                    profileId={q.data.profile.id}
                    backLabel={`Back to ${notificationReturnTab.toLowerCase()}`}
                    onBack={() => setTab(notificationReturnTab)}
                    onNavigate={async (destination, reportId, communitySection, announcementId, consultationId, meetingRequestId) => {
                      if (reportId) {
                        let report = await result<Report | null>(db!.from("reports").select("*").eq("id", reportId).maybeSingle());
                        if (!report) report = (await result<Report[]>(db!.rpc("public_report_by_id", { p_id: reportId })))[0] ?? null;
                        if (!report) throw new Error("This report is no longer available to your account.");
                        setReportReturnTab("Notifications");
                        setSelected(report);
                      }
                      if (destination === "Community") {
                        setCommunityInitialTab(communitySection || "consultations");
                        setCommunityTarget({ consultationId, meetingRequestId });
                      }
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
                      if (destination === "Community") setCommunityTarget({});
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
                      <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 21 }}>Good day,</Text>
                      <Text accessibilityRole="header" adjustsFontSizeToFit numberOfLines={2} style={{ maxWidth: "95%", color: "#10263f", fontSize: 29, lineHeight: 35, fontWeight: "800", letterSpacing: -0.8 }}>Welcome, {q.data.profile.display_name || "neighbor"}.</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Choose your barangay" accessibilityHint="Updates the barangay on your profile" onPress={() => { setBarangayMessage(""); setBarangaysOpen(true); }} style={({ pressed }) => [{ minHeight: 48, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 9, marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, borderWidth: 1, borderColor: "#d9e9ed", backgroundColor: "#ffffffed" }, pressed && { opacity: 0.8 }]}>
                        <Ionicons name="location" size={19} color={colors.brand} />
                        <Text numberOfLines={1} style={{ maxWidth: 215, color: "#526b82", fontSize: 14, fontWeight: "600" }}>{q.data.barangays.find((b) => b.id === q.data.profile.barangay_id)?.name || "Choose your barangay"} · Iligan City</Text>
                        <Ionicons name="chevron-down" size={16} color={colors.muted} />
                      </Pressable>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Start a report" onPress={() => report()} style={({ pressed }) => [{ minHeight: 150, justifyContent: "center", padding: 20, borderRadius: 24, backgroundColor: colors.brandDark, overflow: "hidden", shadowColor: colors.brandDark, shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 48 }, elevation: 3 }, pressed && { opacity: 0.92, transform: [{ scale: 0.995 }] }]}>
                      <View pointerEvents="none" style={{ position: "absolute", right: -50, top: -54, width: 225, height: 225, borderRadius: 120, borderWidth: 1, borderColor: "#ffffff16" }} />
                      <View pointerEvents="none" style={{ position: "absolute", right: -15, bottom: -100, width: 235, height: 190, borderRadius: 120, borderWidth: 1, borderColor: "#41c5b123" }} />
                      <View style={{ maxWidth: "60%", gap: 6 }}>
                        <Text style={{ color: "#b8efe8", fontSize: 11, fontWeight: "800", letterSpacing: 1.7 }}>REPORT & TRACK</Text>
                        <Text style={{ color: "white", fontSize: 21, lineHeight: 25, fontWeight: "800", letterSpacing: -0.45 }}>Report a local issue.</Text>
                        <Text style={{ color: "#d2e5e5", fontSize: 12, lineHeight: 18 }}>Help us build a cleaner, safer and stronger Iligan City. Share details and follow every update.</Text>
                      </View>
                      <View pointerEvents="none" style={{ position: "absolute", right: 56, bottom: 16, width: 70, height: 74, borderRadius: 13, padding: 9, backgroundColor: "#f4fbfc", transform: [{ rotate: "-7deg" }] }}>
                        <Ionicons name="location" size={23} color={colors.brand} />
                        <View style={{ height: 6, width: 45, marginTop: 6, borderRadius: 4, backgroundColor: "#76c9c4" }} />
                        <View style={{ height: 5, width: 36, marginTop: 6, borderRadius: 4, backgroundColor: "#c6dce1" }} />
                      </View>
                      <View pointerEvents="none" style={{ position: "absolute", right: 35, bottom: 16, width: 43, height: 51, borderRadius: 9, borderWidth: 3, borderColor: colors.mint, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", transform: [{ rotate: "8deg" }] }}><Ionicons name="image-outline" size={24} color={colors.mint} /></View>
                      <View style={{ position: "absolute", right: 20, top: "17%", width: 54, height: 54, borderRadius: 28, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center", shadowColor: colors.brandDark, shadowOpacity: 0.2, shadowRadius: 8, elevation: 3 }}><Ionicons name="arrow-forward" size={26} color={colors.brandDark} /></View>
                    </Pressable>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 50, marginTop: 3 }}>
                      <Text style={{ flex: 1, minWidth: 0, color: "#12343d", fontSize: compactPhone ? 18 : 20, fontWeight: "800", letterSpacing: -0.3 }}>What can you report?</Text>
                      {q.data.categories.length > 4 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAllCategories }} onPress={() => setShowAllCategories((open) => !open)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 4 }}><Text style={{ color: colors.brand, fontSize: 13, fontWeight: "700" }}>{showAllCategories ? "Show less" : `See all ${q.data.categories.length}`}</Text><Ionicons name={showAllCategories ? "chevron-up" : "chevron-forward"} size={18} color={colors.brand} /></Pressable>}
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 11 }}>
                      {(showAllCategories ? q.data.categories : q.data.categories.slice(0, 4)).map((item) => {
                        const tone = categoryToneFor(item.name);
                        const description = item.name.toLowerCase().includes("light") ? "Non-working or damaged lights" : item.name.toLowerCase().includes("road") ? "Potholes, cracks and road hazards" : item.name.toLowerCase().includes("drain") ? "Clogged, damaged or poor drainage" : item.name.toLowerCase().includes("waste") ? "Illegal dumping, overflowing bins" : item.name.toLowerCase().includes("wire") ? "Low-hanging or unsafe wires" : "Missing signs or faded road markings";
                        return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Report ${categoryDisplayName(item.name)}. ${description}`} style={({ pressed }) => [{ width: "48.5%", minHeight: 80, padding: 7, borderRadius: 20, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white", flexDirection: "row", alignItems: "center", gap: 6, shadowColor: "#12343d", shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 48 }, elevation: 1 }, pressed && { backgroundColor: "#f6fbfa", opacity: 0.86 }]} onPress={() => report(item.id)}>
                          <View style={{ width: compactPhone ? 32 : 38, height: 44, borderRadius: 17, backgroundColor: tone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(item.name)} size={compactPhone ? 21 : 23} color={tone.foreground} /></View>
                          <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={2} style={{ color: "#12343d", fontSize: 12, lineHeight: 16, fontWeight: "700" }}>{categoryDisplayName(item.name)}</Text><Text numberOfLines={2} style={{ color: "#5d7378", fontSize: 12, lineHeight: 16 }}>{description}</Text></View>
                          {!compactPhone && <Ionicons name="chevron-forward" size={14} color="#9aabba" />}
                        </Pressable>;
                      })}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 7 }}><Text style={{ color: "#12343d", fontSize: 20, fontWeight: "800", letterSpacing: -0.3 }}>From your community</Text><Pressable accessibilityRole="button" onPress={() => { setSelectedAnnouncement(null); setTab("Announcements"); }} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: colors.brand, fontSize: 13, fontWeight: "700" }}>View all</Text></Pressable></View>
                    {q.data.announcements.length ? q.data.announcements.map((a) => (
                      <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`${a.kind}: ${a.title}. Open official update`} style={({ pressed }) => [{ minHeight: 94, flexDirection: "row", alignItems: "center", gap: 13, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white" }, pressed && { opacity: 0.85 }]} onPress={() => { setSelectedAnnouncement(a.id); setTab("Announcements"); }}>
                        <View style={{ width: 48, height: 48, borderRadius: 17, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name={a.kind.toLowerCase().includes("meeting") ? "calendar-outline" : "megaphone-outline"} size={22} color={colors.brand} /></View>
                        <View style={{ flex: 1, gap: 5 }}><Text style={{ color: "#008d86", fontSize: 10, fontWeight: "800", letterSpacing: 1.3 }}>{a.kind.toUpperCase()}</Text><Text numberOfLines={2} style={{ color: "#10263f", fontSize: 15, lineHeight: 20, fontWeight: "700" }}>{a.title}</Text><Text style={{ color: "#5d7378", fontSize: 12 }}>Read official update</Text></View>
                        <Ionicons name="chevron-forward" size={18} color="#9aabba" />
                      </Pressable>
                    )) : <View style={{ minHeight: 86, borderRadius: 18, padding: 16, backgroundColor: "#ffffff", justifyContent: "center" }}><Text style={{ color: "#526b82", fontSize: 14 }}>No new community announcements.</Text><Text style={s.small}>Check back for official city and barangay updates.</Text></View>}
                    <Pressable accessibilityRole="button" onPress={() => { setSelectedAnnouncement(null); setTab("Announcements"); }} style={({ pressed }) => [{ minHeight: 54, borderRadius: 18, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }, pressed && { opacity: 0.82 }]}><Text style={{ color: colors.brand, fontSize: 15, fontWeight: "800" }}>All official announcements</Text><Ionicons name="chevron-forward" size={18} color={colors.brand} /></Pressable>
                    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 9, marginBottom: 1 }}>
                      <Text style={{ color: "#10263f", fontSize: 20, fontWeight: "800", letterSpacing: -0.3 }}>Your reports</Text>
                      <Text style={{ color: "#5d7378", fontSize: 13 }}>{reportsQuery.data ? `${reportsQuery.data.count} total` : ""}</Text>
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
                          style={({ pressed }) => [{ minHeight: 96, flexDirection: "row", alignItems: "center", gap: 11, padding: 10, borderRadius: 20, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white", shadowColor: "#12343d", shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 48 }, elevation: 1 }, pressed && { backgroundColor: "#f8fbf9", opacity: 0.9 }]}
                          key={r.id}
                          onPress={() => { setReportReturnTab("Home"); setSelected(r); }}
                        >
                          {reportPhotos.data?.urls[r.id] && !failedReportPhotos[r.id] ? <PhotoViewer source={{ uri: reportPhotos.data.urls[r.id] }} label={`${categoryName} report photo`} onError={() => setFailedReportPhotos((value) => ({ ...value, [r.id]: true }))} style={{ width: 78, height: 78, borderRadius: 14, backgroundColor: "#eaf2f1" }} /> : <View style={{ width: 78, height: 78, borderRadius: 14, backgroundColor: categoryToneFor(categoryName).background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(categoryName)} size={27} color={categoryToneFor(categoryName).foreground} /></View>}
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
                      <Text style={{ alignSelf: "flex-start", color: "#5d7378", fontSize: 13 }} accessibilityLiveRegion="polite">{reportsLoading ? `Loading page ${page + 1}…` : `Page ${page + 1} of ${Math.max(1, Math.ceil((reportsQuery.data?.count ?? 0) / REPORT_PAGE_SIZE))}`}</Text>
                      <View style={s.actionRow}>
                        <Pressable accessibilityRole="button" accessibilityLabel="Previous report page" disabled={!page || reportsQuery.isFetching} onPress={() => setPage((value) => Math.max(0, value - 1))} style={{ flex: 1, minHeight: 54, borderWidth: 1, borderColor: "#e4eff0", borderRadius: 17, backgroundColor: "white", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: !page || reportsQuery.isFetching ? 0.48 : 1 }}><Ionicons name="chevron-back" size={19} color={colors.brand} /><Text style={{ color: !page ? "#9aabba" : "#526b82", fontSize: 14, fontWeight: "700" }}>Previous</Text></Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel="Next report page" disabled={reportsQuery.isFetching || !!reportsQuery.error || (page + 1) * REPORT_PAGE_SIZE >= (reportsQuery.data?.count ?? 0)} onPress={() => setPage((value) => value + 1)} style={{ flex: 1, minHeight: 54, borderWidth: 1, borderColor: "#dcebe8", borderRadius: 17, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: reportsQuery.isFetching || !!reportsQuery.error || (page + 1) * REPORT_PAGE_SIZE >= (reportsQuery.data?.count ?? 0) ? 0.48 : 1 }}><Text style={{ color: colors.brand, fontSize: 14, fontWeight: "800" }}>Next</Text><Ionicons name="chevron-forward" size={19} color={colors.brand} /></Pressable>
                      </View>
                    </View>}
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
        onClose={() => {
          if (q.data?.profile.role === "resident" && !q.data.profile.barangay_id) {
            setBarangayMessage("Choose your registered barangay to finish setting up your resident profile.");
            return;
          }
          setBarangaysOpen(false);
        }}
        title="Choose a barangay"
        subtitle="Select your home barangay. It is saved to your profile and used as the default for new reports."
        searchPlaceholder="Search barangay"
        items={(q.data?.barangays || []).map((item) => ({ id: item.id, name: item.name, description: `Community updates for ${item.name}`, icon: "location-outline" as const, tone: { background: "#e5f6f2", foreground: colors.brand } }))}
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
                if (name === "Community") { setCommunityInitialTab("consultations"); setCommunityTarget({}); }
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
                color={tab === name ? colors.brand : colors.muted}
              />
            )}
            <Text style={[s.navText, tab === name && { color: colors.brand }]}>
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
    [firstName, setFirstName] = useState(""),
    [middleName, setMiddleName] = useState(""),
    [lastName, setLastName] = useState(""),
    [age, setAge] = useState(""),
    [ageTouched, setAgeTouched] = useState(false),
    [mobile, setMobile] = useState(""),
    [mobileTouched, setMobileTouched] = useState(false),
    [registeredBarangay, setRegisteredBarangay] = useState(""),
    [barangayPickerOpen, setBarangayPickerOpen] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false),
    [otp, setOtp] = useState(""),
    [resendSeconds, setResendSeconds] = useState(0),
    [message, setMessage] = useState(initialError),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false);
  const [messageIsError, setMessageIsError] = useState(!!initialError);
  const [termsOpen, setTermsOpen] = useState(false),
    [termsReachedEnd, setTermsReachedEnd] = useState(false),
    [termsRead, setTermsRead] = useState(false),
    [termsAccepted, setTermsAccepted] = useState(false);
  useEffect(() => {
    if (mode !== "verify" || resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [mode, resendSeconds]);
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
  const signupBarangays = useQuery({
    queryKey: ["public-signup-barangays"],
    enabled: configured && mode === "register",
    staleTime: Infinity,
    queryFn: () => result<Lookup[]>(db!.rpc("signup_barangays")),
  });
  const registeredBarangayName = signupBarangays.data?.find((item) => item.id === registeredBarangay)?.name;
  const fullName = residentDisplayName(firstName, middleName, lastName);
  const namePartsProblem = residentNamePartsError(firstName, middleName, lastName);
  const ageProblem = residentAgeError(age, true);
  const redirect = () =>
    Platform.OS === "web"
      ? window.location.origin
      : Linking.createURL("/", { scheme: "iliganconnect", isTripleSlashed: true });
  const changeMode = (next: string) => {
    setBarangayPickerOpen(false);
    setTermsOpen(false); setTermsReachedEnd(false); setTermsRead(false); setTermsAccepted(false);
    setMobileTouched(false);
    setAgeTouched(false);
    setFirstName(""); setMiddleName(""); setLastName(""); setAge("");
    setMode(next);
    setMessage("");
    setMessageIsError(false);
    setPassword("");
    setConfirmPassword("");
    setConfirmPasswordTouched(false);
    setOtp("");
    setResendSeconds(0);
    setShowPassword(false);
  };
  const setAuthFailure = (error: unknown, step: "sign-in" | "verification" | "resend" | "recovery" | "password" = "sign-in") => {
    setMessage(formatAuthError(error, step));
    setMessageIsError(true);
  };
  async function resendSignupCode() {
    if (busy || resendSeconds > 0 || !db) return;
    setBusy(true); setMessage(""); setMessageIsError(false);
    try {
      const { error } = await db.auth.resend({
        type: "signup",
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: redirect() },
      });
      if (error) throw error;
      setOtp("");
      setResendSeconds(EMAIL_RESEND_INTERVAL_SECONDS);
      setMessage("If this address can receive verification messages, a new verification message is on the way.");
    } catch (error) {
      setAuthFailure(error, "resend");
    } finally { setBusy(false); }
  }
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
      if (/provider|unsupported/i.test(details)) {
        setMessage(`${provider === "google" ? "Google" : "Facebook"} sign-in needs to be enabled by the administrator.`);
        setMessageIsError(true);
      } else setAuthFailure(error);
    } finally { setBusy(false); }
  }
  return (
    <SafeAreaView style={[s.screen, { backgroundColor: colors.brandDark }]}>
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
                  {mode === "register" || mode === "verify"
                    ? "Join your community"
                    : mode === "reset"
                      ? "Recover your account"
                      : "Welcome back"}
                </Text>
                <Text style={s.small}>
                  {mode === "register"
                    ? "Create an account to report and follow local issues."
                    : mode === "verify"
                      ? "Enter the one-time code sent to your email to activate your account."
                    : mode === "reset"
                      ? "We’ll send a secure recovery link to your email."
                      : "Sign in to see your reports and community updates."}
                </Text>
              </View>
            {configured ? mode === "verify" ? (
              <>
                <Text style={s.body}>Check <Text style={{ fontWeight: "700" }}>{email.trim().toLowerCase()}</Text> for your verification code. If the email contains a confirmation link, opening it will verify your account too.</Text>
                <Field
                  label={`${EMAIL_OTP_LENGTH}-digit email code`} required hint={`Enter the code from your email. It expires after ${EMAIL_OTP_EXPIRY_SECONDS / 60} minutes.`}
                  value={otp}
                  onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH))}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={EMAIL_OTP_LENGTH}
                />
                <Button title={busy ? "Verifying…" : "Verify email"} disabled={busy || otp.length !== EMAIL_OTP_LENGTH} loading={busy} onPress={async () => {
                  if (!new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`).test(otp)) { setMessage(`Enter the ${EMAIL_OTP_LENGTH}-digit code from your email.`); setMessageIsError(true); return; }
                  setBusy(true); setMessage(""); setMessageIsError(false);
                  try {
                    const { error } = await db!.auth.verifyOtp({ email: email.trim().toLowerCase(), token: otp, type: "signup" });
                    if (error) throw error;
                    setOtp("");
                  } catch (error) { setAuthFailure(error, "verification"); }
                  finally { setBusy(false); }
                }} />
                <Pressable accessibilityRole="button" disabled={busy || resendSeconds > 0} style={s.textAction} onPress={() => void resendSignupCode()}>
                  <Text style={[s.textActionLabel, (busy || resendSeconds > 0) && { opacity: 0.55 }]}>{resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Resend verification code"}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} style={s.textAction} onPress={() => changeMode("register")}>
                  <Text style={s.textActionLabel}>Change email or account details</Text>
                </Pressable>
              </>
            ) : (
              <>
                {mode === "register" && (
                  <View style={{ gap: 11 }}>
                    <Text style={s.eyebrow}>PERSONAL DETAILS</Text>
                    <Field
                      label="First name" required minLength={1} validationKind="name" hint="Use your name as it appears on your records."
                      placeholder="First name"
                      value={firstName}
                      onChangeText={setFirstName}
                      maxLength={60}
                      autoCapitalize="words"
                      autoComplete="given-name"
                    />
                    <Field
                      label="Middle name (optional)" validationKind="name" hint="Leave blank if you do not use a middle name."
                      placeholder="Middle name"
                      value={middleName}
                      onChangeText={setMiddleName}
                      maxLength={60}
                      autoCapitalize="words"
                      autoComplete="additional-name"
                    />
                    <Field
                      label="Last name" required minLength={1} validationKind="name"
                      error={fullName.length > 100 ? "Use no more than 100 characters across all name fields." : undefined}
                      placeholder="Last name"
                      value={lastName}
                      onChangeText={setLastName}
                      maxLength={60}
                      autoCapitalize="words"
                      autoComplete="family-name"
                    />
                    <Field
                      label="Age" required hint="Enter a whole number from 1 to 120."
                      placeholder="Age"
                      value={age}
                      onChangeText={(value) => setAge(value.replace(/\D/g, "").slice(0, 3))}
                      onBlur={() => setAgeTouched(true)}
                      error={ageTouched ? residentAgeError(age, true) || undefined : undefined}
                      validationKind="age"
                      maxLength={3}
                      keyboardType="number-pad"
                      autoComplete="off"
                    />
                    <Field
                      label="Mobile number (optional)"
                      hint="Philippine mobile number, for example 0917 123 4567. Authorized administrators can view it."
                      placeholder="0917 123 4567"
                      value={mobile}
                      onChangeText={setMobile}
                      onBlur={() => setMobileTouched(true)}
                      error={mobileTouched ? mobileInputError(mobile) || undefined : undefined}
                      validationKind="phone"
                      maxLength={24}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                    />
                    <View style={{ gap: 7 }}>
                      <Text style={s.fieldLabel}>Registered barangay <Text style={{ color: "#a43d35" }}>*</Text></Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={registeredBarangayName ? `Registered barangay: ${registeredBarangayName}` : "Choose your registered barangay"}
                        accessibilityHint="This becomes the barangay saved to your resident profile and used to prefill new reports."
                        accessibilityState={{ disabled: signupBarangays.isPending || (!signupBarangays.data && !signupBarangays.isError) }}
                        disabled={signupBarangays.isPending || (!signupBarangays.data && !signupBarangays.isError)}
                        onPress={() => signupBarangays.isError ? void signupBarangays.refetch() : setBarangayPickerOpen(true)}
                        style={({ pressed }) => [{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: registeredBarangayName ? "#c8e2dc" : colors.line, backgroundColor: "#fff", opacity: pressed ? 0.8 : 1 }]}
                      >
                        {signupBarangays.isPending ? <ActivityIndicator size="small" color={colors.brand} /> : <Ionicons name={signupBarangays.isError ? "refresh-outline" : "location-outline"} size={19} color={colors.brand} />}
                        <Text numberOfLines={1} style={{ flex: 1, color: registeredBarangayName ? colors.brandDark : colors.muted, fontSize: 14, fontWeight: registeredBarangayName ? "700" : "500" }}>
                          {signupBarangays.isPending ? "Loading barangays…" : signupBarangays.isError ? "Retry loading barangays" : registeredBarangayName || "Choose your barangay"}
                        </Text>
                        {!signupBarangays.isPending && <Ionicons name={signupBarangays.isError ? "reload" : "chevron-down"} size={17} color={colors.muted} />}
                      </Pressable>
                      {signupBarangays.isError ? (
                        <Text accessibilityRole="alert" style={s.error}>The barangay list could not load. Retry before creating your account.</Text>
                      ) : (
                        <Text style={s.small}>Saved to your profile and used as the default barangay for new reports.</Text>
                      )}
                    </View>
                    <Text style={s.eyebrow}>ACCOUNT DETAILS</Text>
                  </View>
                )}
                <Field maxLength={254}
                  label="Email address" required validationKind="email" hint="Enter the address you used to register."
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                />
                {mode !== "reset" && (
                  <Field maxLength={1024}
                    label={
                      mode === "register"
                        ? `Password (at least ${MIN_PASSWORD_LENGTH} characters)`
                        : "Password"
                    }
                    required
                    hint={mode === "register" ? "Avoid reusing a password from another account." : undefined}
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
                {mode === "register" && <Field
                  label="Confirm password"
                  required
                  hint="Enter the same password again."
                  error={confirmPasswordTouched && !confirmPassword ? "Confirm your password." : confirmPassword && password !== confirmPassword ? "Passwords do not match." : undefined}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  onBlur={() => setConfirmPasswordTouched(true)}
                  maxLength={1024}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  trailing={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={showPassword ? "Hide passwords" : "Show passwords"}
                      accessibilityState={{ selected: showPassword }}
                      hitSlop={8}
                      onPress={() => setShowPassword((visible) => !visible)}
                      style={s.inputAction}
                    ><Text style={s.inputActionText}>{showPassword ? "Hide" : "Show"}</Text></Pressable>
                  }
                />}
                {mode === "register" && <View style={[s.card, { gap: 10, padding: 13, backgroundColor: "#f8fbfa" }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="document-text-outline" size={19} color={colors.brand} /></View>
                    <View style={{ flex: 1, gap: 2 }}><Text style={s.fieldLabel}>Terms and Conditions</Text><Text style={s.small}>Read the terms before creating your account.</Text></View>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Read Terms and Conditions" onPress={() => { setTermsReachedEnd(false); setTermsOpen(true); }} style={({ pressed }) => [{ minHeight: 46, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "#cfe4df", backgroundColor: "white", flexDirection: "row", alignItems: "center", justifyContent: "space-between", opacity: pressed ? 0.78 : 1 }]}>
                    <Text style={{ color: colors.brand, fontSize: 13, fontWeight: "700" }}>{termsRead ? "Terms reviewed" : "Read Terms and Conditions"}</Text>
                    <Ionicons name={termsRead ? "checkmark-circle" : "open-outline"} size={18} color={colors.brand} />
                  </Pressable>
                  <Pressable accessibilityRole="checkbox" accessibilityLabel="I have read and agree to the Terms and Conditions" accessibilityState={{ checked: termsAccepted, disabled: !termsRead }} disabled={!termsRead} onPress={() => setTermsAccepted((value) => !value)} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, opacity: !termsRead ? 0.55 : pressed ? 0.78 : 1 }]}>
                    <View style={{ width: 23, height: 23, borderRadius: 6, borderWidth: 1.5, borderColor: termsAccepted ? colors.brand : "#9aadae", backgroundColor: termsAccepted ? colors.brand : "white", alignItems: "center", justifyContent: "center" }}>{termsAccepted && <Ionicons name="checkmark" size={16} color="white" />}</View>
                    <Text style={{ flex: 1, color: colors.brandDark, fontSize: 13, lineHeight: 19 }}>I have read and agree to the Terms and Conditions.<Text style={{ color: "#b42318" }}> *</Text></Text>
                  </Pressable>
                  {!termsRead && <Text style={s.small}>Open the terms and scroll to the end to enable agreement.</Text>}
                </View>}
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
                    (mode === "register" && (
                      password.length < MIN_PASSWORD_LENGTH ||
                      !confirmPassword || password !== confirmPassword ||
                      !!namePartsProblem ||
                      !!ageProblem ||
                      !registeredBarangay ||
                      !!mobileInputError(mobile) ||
                      signupBarangays.isPending ||
                      signupBarangays.isError ||
                      !signupBarangays.data?.some((item) => item.id === registeredBarangay) ||
                      !termsRead || !termsAccepted
                    ))
                  }
                  loading={busy}
                  onPress={async () => {
                    const problem = emailInputError(email) || (mode === "register" ? namePartsProblem || ageProblem || mobileInputError(mobile) || (password !== confirmPassword ? "Passwords do not match." : "") || (!registeredBarangay || !signupBarangays.data?.some((item) => item.id === registeredBarangay) ? "Choose your registered barangay before creating an account." : "") || (!termsRead || !termsAccepted ? "Read and agree to the Terms and Conditions before creating an account." : "") : "") || (mode !== "reset" ? passwordInputError(password, mode === "register" ? MIN_PASSWORD_LENGTH : 1) : "");
                    if (problem) { setMessage(problem); setMessageIsError(true); return; }
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
                                  data: {
                                    registration_type: "resident",
                                    first_name: firstName.trim(),
                                    middle_name: middleName.trim() || null,
                                    last_name: lastName.trim(),
                                    age: Number(age),
                                    display_name: fullName,
                                    phone: normalizePhilippineMobile(mobile) || null,
                                    barangay_id: registeredBarangay,
                                    terms_version: RESIDENT_TERMS_VERSION,
                                    terms_accepted_at: new Date().toISOString(),
                                  },
                                  emailRedirectTo: redirect(),
                                },
                              })
                            : await db!.auth.signInWithPassword({
                                email: email.trim().toLowerCase(),
                                password,
                              });
                        if (response.error) throw response.error;
                        if (mode === "register") { setPassword(""); setConfirmPassword(""); setConfirmPasswordTouched(false); }
                        if (mode === "register" && !response.data.session) {
                          setMode("verify");
                          setEmail(email.trim().toLowerCase());
                          setOtp("");
                          setResendSeconds(EMAIL_RESEND_INTERVAL_SECONDS);
                          setMessage(`If this address can receive verification messages, check for a code or confirmation link. Codes expire in ${EMAIL_OTP_EXPIRY_SECONDS / 60} minutes.`);
                        }
                      }
                    } catch (e) {
                      setAuthFailure(e, mode === "reset" ? "recovery" : "sign-in");
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                {mode === "login" && (providers.data?.google || providers.data?.facebook) && <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}><View style={{ height: 1, flex: 1, backgroundColor: "#e0eaee" }} /><Text style={{ color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.8 }}>OR CONTINUE WITH</Text><View style={{ height: 1, flex: 1, backgroundColor: "#e0eaee" }} /></View>
                  <View style={{ flexDirection: "row", gap: 9 }}>
                    {([ ["google", "logo-google", "Google", "#4285f4"], ["facebook", "logo-facebook", "Facebook", "#1877f2"] ] as const).filter(([provider]) => providers.data?.[provider]).map(([provider, icon, title, tint]) => <Pressable key={provider} accessibilityRole="button" accessibilityLabel={`Continue with ${title}`} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void signInSocial(provider)} style={({ pressed }) => [{ flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 13, borderWidth: 1, borderColor: "#dce7ed", backgroundColor: "white", opacity: busy ? 0.55 : pressed ? 0.78 : 1 }]}><Ionicons name={icon} size={18} color={tint} /><Text style={{ color: colors.brandDark, fontSize: 12, fontWeight: "700" }}>{title}</Text></Pressable>)}
                  </View>
                  <Text style={s.small}>New residents should create an account with email and accept the current terms first.</Text>
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
            {!!message && (
              <Text accessibilityRole="alert" style={messageIsError ? s.error : s.body}>
                {message}
              </Text>
            )}
          </View>
          <SelectionSheet
            visible={barangayPickerOpen}
            onClose={() => setBarangayPickerOpen(false)}
            title="Choose your barangay"
            subtitle="This becomes the barangay saved to your resident profile and used for new reports."
            searchPlaceholder="Search barangay"
            confirmLabel="Use this barangay"
            items={(signupBarangays.data || []).map((item) => ({ id: item.id, name: item.name, icon: "location-outline" as const, tone: { background: colors.brandSoft, foreground: colors.brand } }))}
            value={registeredBarangay}
            onConfirm={setRegisteredBarangay}
          />
          <Modal visible={termsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTermsOpen(false)}>
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: "white" }}>
                <View style={{ flex: 1, gap: 3 }}><Text accessibilityRole="header" style={[s.title, { fontSize: 18 }]}>Resident Terms of Use</Text><Text style={s.small}>Iligan Connect · Version {RESIDENT_TERMS_VERSION}</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close terms" onPress={() => setTermsOpen(false)} style={{ width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: "white", alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={21} color={colors.brandDark} /></Pressable>
              </View>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 18, gap: 15, paddingBottom: 24 }}
                showsVerticalScrollIndicator
                onScroll={(event) => {
                  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                  if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 24) setTermsReachedEnd(true);
                }}
                scrollEventThrottle={80}
              >
                <Text style={[s.body, { fontSize: 14 }]}>Please read these terms before registering. They explain how to use the reporting and community features responsibly.</Text>
                {RESIDENT_TERMS.map((section) => <View key={section.title} style={{ gap: 5 }}><Text style={[s.fieldLabel, { fontSize: 14 }]}>{section.title}</Text><Text style={[s.body, { fontSize: 13, lineHeight: 20 }]}>{section.body}</Text></View>)}
              </ScrollView>
              <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: "white", gap: 8 }}>
                {!termsReachedEnd && <Text style={s.small}>Scroll through the terms to continue.</Text>}
                <Button title={termsRead ? "Done" : "I’ve read the terms"} disabled={!termsReachedEnd} onPress={() => { setTermsRead(true); setTermsOpen(false); }} />
              </View>
            </SafeAreaView>
          </Modal>
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
      <Field maxLength={1024}
        label="New password" hint={`Use at least ${MIN_PASSWORD_LENGTH} characters.`}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      <Field maxLength={1024}
        label="Confirm password" error={confirm && password !== confirm ? "Passwords must match exactly." : undefined}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
      />
      <Button
        title={busy ? "Updating…" : "Update password"}
        disabled={busy || !!passwordInputError(password, MIN_PASSWORD_LENGTH) || password !== confirm}
        onPress={async () => {
          setBusy(true);
          setMessage("");
          try {
            const { error } = await db!.auth.updateUser({ password });
            if (error) throw error;
            setMessage("Password updated.");
            setPassword("");
            setConfirm("");
            onDone?.();
          } catch (error) {
            setMessage(error instanceof Error && error.message.toLowerCase().includes("rate limit")
              ? "Too many attempts. Wait a few minutes before trying again."
              : "We could not update your password. Check the requirements and try again.");
          } finally { setBusy(false); }
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
  const [firstName, setFirstName] = useState(p.first_name || ""),
    [middleName, setMiddleName] = useState(p.middle_name || ""),
    [lastName, setLastName] = useState(p.last_name || ""),
    [age, setAge] = useState(p.age == null ? "" : String(p.age)),
    [phone, setPhone] = useState(p.phone || ""),
    [barangay, setBarangay] = useState(p.barangay_id || ""),
    [notifications, setNotifications] = useState(p.notifications_enabled),
    [deviceAlertsAllowed, setDeviceAlertsAllowed] = useState<boolean | null>(null),
    [deviceAlertsCanAsk, setDeviceAlertsCanAsk] = useState(true),
    [phoneAlertsEnabled, setPhoneAlertsEnabled] = useState(false),
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
  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    const refresh = () => {
      void Promise.all([Notifications.getPermissionsAsync(), getDevicePushPreference(p.id), hasRegisteredDevicePushToken(p.id)]).then(([permission, preference, registered]) => {
        if (!active) return;
        setDeviceAlertsAllowed(permission.granted);
        setDeviceAlertsCanAsk(permission.canAskAgain);
        setPhoneAlertsEnabled(permission.granted && preference !== false && (registered || !expoProjectId()));
      }).catch(() => { if (active) { setDeviceAlertsAllowed(false); setPhoneAlertsEnabled(false); } });
    };
    refresh();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    return () => { active = false; subscription.remove(); };
  }, [p.id]);
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
  const storedFullName = residentDisplayName(p.first_name || "", p.middle_name || "", p.last_name || "") || p.display_name;
  const initials = storedFullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join("") || "R";
  const hasNameParts = !!(p.first_name || p.middle_name || p.last_name || firstName.trim() || middleName.trim() || lastName.trim());
  const namePartsProblem = hasNameParts ? residentNamePartsError(firstName, middleName, lastName) : "";
  const fullNameTooLong = residentDisplayName(firstName, middleName, lastName).length > 100;
  const ageProblem = age.trim() ? residentAgeError(age) : "";
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
    if (namePartsProblem) { setMessage(namePartsProblem); return; }
    if (ageProblem) { setMessage(ageProblem); return; }
    const phoneProblem = mobileInputError(phone);
    if (phoneProblem) { setMessage(phoneProblem); return; }
    const displayName = hasNameParts ? residentDisplayName(firstName, middleName, lastName) : p.display_name;
    const nextAge = age.trim() ? Number(age) : p.age ?? null;
    if (writeLock.current) return;
    const normalizedPhone = normalizePhilippineMobile(phone) || null;
    const changes: Partial<Pick<Profile, "display_name" | "first_name" | "middle_name" | "last_name" | "age" | "barangay_id" | "phone">> = {};
    if (displayName !== p.display_name) changes.display_name = displayName;
    if (hasNameParts) {
      if (firstName.trim() !== (p.first_name || "")) changes.first_name = firstName.trim();
      if ((middleName.trim() || null) !== (p.middle_name || null)) changes.middle_name = middleName.trim() || null;
      if (lastName.trim() !== (p.last_name || "")) changes.last_name = lastName.trim();
    }
    if (nextAge !== (p.age ?? null)) changes.age = nextAge;
    if ((barangay || null) !== p.barangay_id) changes.barangay_id = barangay || null;
    if (normalizedPhone !== (p.phone || null)) changes.phone = normalizedPhone;
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
      if (!value) {
        await setDevicePushPreference(p.id, false);
        setPhoneAlertsEnabled(false);
        await removeDevicePushTokens(p.id).catch(() => undefined);
        await syncResidentBackgroundAlerts(false);
      }
      else if (deviceAlertsAllowed && phoneAlertsEnabled) void registerDevicePushToken(p.id).catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ["home", p.id] });
      setMessage(value ? "Notifications are on." : "Notifications are off.");
    } catch (error) {
      setMessage((error as Error).message || "Could not update your notification preference.");
    } finally { setNotificationBusy(false); }
  }

  async function togglePhoneAlerts(value: boolean) {
    if (notificationBusy || value === phoneAlertsEnabled) return;
    setNotificationBusy(true);
    setMessage("");
    try {
      if (!value) {
        await setDevicePushPreference(p.id, false);
        setPhoneAlertsEnabled(false);
        await removeDevicePushTokens(p.id).catch(() => undefined);
        await syncResidentBackgroundAlerts(false);
        return;
      }
      let permissionGranted = deviceAlertsAllowed === true;
      if (!permissionGranted && !deviceAlertsCanAsk) {
        await setDevicePushPreference(p.id, true);
        await NativeLinking.openSettings();
        return;
      }
      if (!permissionGranted) {
        if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("community-alerts", { name: "Community alerts", importance: Notifications.AndroidImportance.HIGH, sound: "default", vibrationPattern: [0, 250, 250, 250] });
        const permission = await Notifications.requestPermissionsAsync();
        permissionGranted = permission.granted;
        setDeviceAlertsAllowed(permission.granted);
        setDeviceAlertsCanAsk(permission.canAskAgain);
      }
      if (!permissionGranted) {
        setPhoneAlertsEnabled(false);
        setMessage("Allow notifications in phone settings to turn on phone alerts.");
        return;
      }
      await setDevicePushPreference(p.id, true);
      const registration = await registerDevicePushToken(p.id);
      if (registration !== "registered" && registration !== "not-configured") {
        setMessage("Phone alerts are unavailable. Please try again.");
        return;
      }
      if (!notifications) {
        await result(db!.from("profiles").update({ notifications_enabled: true }).eq("id", p.id));
        setNotifications(true);
        await qc.invalidateQueries({ queryKey: ["home", p.id] });
      }
      setPhoneAlertsEnabled(true);
      await syncResidentBackgroundAlerts(registration === "not-configured");
      if (registration === "not-configured") setMessage("Phone alerts check for updates while the app is closed. Delivery may be delayed.");
    } catch {
      setMessage("Phone alerts are unavailable. Please try again.");
    } finally { setNotificationBusy(false); }
  }

  async function confirmSignOut() {
    if (signOutBusy) return;
    setSignOutBusy(true);
    try {
      await removeDevicePushTokens(p.id).catch(() => undefined);
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
    { key: "meetings", title: "Meeting requests", count: totals?.meeting_requests, icon: "calendar-outline" as const, tone: { background: "#e5f6f2", foreground: colors.brand }, action: () => onNavigate("Community", "meetings") },
  ];
  const privacyItems = [
    { key: "profile", title: "Profile visibility", icon: "person-circle-outline" as const, body: "Your name, age, mobile number, email, and home barangay are account details visible to you and authorized administrators. Public report views use the report’s approved public information, not your private contact details." },
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
          <Ionicons name="person-circle-outline" size={34} color={colors.brand} />
        </View>
      </View>

      <View style={{ minHeight: 112, flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 22, backgroundColor: "#073f47", borderWidth: 1, borderColor: "#073f47", overflow: "hidden", shadowColor: "#073f47", shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 }}>
        <View pointerEvents="none" style={{ position: "absolute", right: -30, top: -66, width: 190, height: 190, borderRadius: 100, borderWidth: 1, borderColor: "#ffffff20" }} />
        <Pressable accessibilityRole="button" accessibilityLabel={p.avatar_path ? "Change profile photo" : "Add profile photo"} disabled={photoBusy} onPress={() => setPhotoMenu(true)} style={({ pressed }) => [{ width: 62, height: 62, borderRadius: 22, backgroundColor: "#dff5ef", alignItems: "center", justifyContent: "center", overflow: "hidden" }, pressed && { opacity: 0.8 }]}>{avatar.data ? <Image source={{ uri: avatar.data }} accessibilityLabel="Your profile photo" resizeMode="cover" style={{ width: 62, height: 62 }} /> : <Text accessibilityLabel={`Avatar initials ${initials}`} style={{ color: colors.brand, fontSize: 23, fontWeight: "800" }}>{initials}</Text>}{photoBusy && <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#071b2770" }}><Ionicons name="hourglass-outline" size={19} color="white" /></View>}</Pressable>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={{ color: "#70d8ca", fontSize: 10, fontWeight: "800", letterSpacing: 1.35 }}>ILIGAN CONNECT ACCOUNT</Text><Text numberOfLines={2} style={{ color: "white", fontSize: 18, lineHeight: 22, fontWeight: "800" }}>{p.display_name.trim() || "Resident"}</Text><Text numberOfLines={1} style={{ color: "#d2e5e5", fontSize: 12 }}>{label(p.role)} · Iligan City</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={p.avatar_path ? "Edit profile photo" : "Add profile photo"} disabled={photoBusy} onPress={() => setPhotoMenu(true)} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: 12, borderWidth: 1, borderColor: "#44cbb7", opacity: photoBusy ? 0.6 : pressed ? 0.75 : 1 }]}><Ionicons name="camera-outline" size={17} color="#b8fff3" /><Text numberOfLines={1} style={{ color: "white", fontSize: 11, fontWeight: "700" }}>{photoBusy ? "Saving" : "Edit photo"}</Text></Pressable>
      </View>

      {message && <View accessibilityRole="alert" style={{ flexDirection: "row", gap: 7, alignItems: "flex-start", padding: 10, borderRadius: 13, backgroundColor: /updated|removed|up to date|are on|are off|allowed/i.test(message) ? "#eff9f5" : "#fff2f0" }}><Ionicons name={/updated|removed|up to date|are on|are off|allowed/i.test(message) ? "checkmark-circle-outline" : "alert-circle-outline"} size={18} color={/updated|removed|up to date|are on|are off|allowed/i.test(message) ? colors.brand : "#a43d35"} /><Text style={{ flex: 1, color: /updated|removed|up to date|are on|are off|allowed/i.test(message) ? colors.brand : "#a43d35", fontSize: 12, lineHeight: 17 }}>{message}</Text></View>}

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="person-circle-outline" size={21} color={colors.brand} /><Text style={[s.title, { flex: 1, marginBottom: 0 }]}>Personal details</Text><Pressable accessibilityRole="button" accessibilityLabel={editing ? "Cancel profile editing" : "Edit personal details"} onPress={() => { setMessage(""); if (editing) { setFirstName(p.first_name || ""); setMiddleName(p.middle_name || ""); setLastName(p.last_name || ""); setAge(p.age == null ? "" : String(p.age)); setPhone(p.phone || ""); setBarangay(p.barangay_id || ""); } setEditing(!editing); }} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, borderRadius: 13, backgroundColor: "#e8f7f3" }, pressed && { opacity: 0.75 }]}><Ionicons name={editing ? "close-outline" : "create-outline"} size={17} color={colors.brand} /><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "800" }}>{editing ? "Cancel" : "Edit"}</Text></Pressable></View>
        <View style={[s.card, { padding: 12, gap: 0, borderRadius: 18 }]}>
          {editing ? <>
            <Field label="First name" required minLength={1} validationKind="name" hint="Use the name on your official records." placeholder="First name" value={firstName} onChangeText={setFirstName} maxLength={60} autoCapitalize="words" autoComplete="given-name" leading={<Ionicons name="person-outline" size={19} color={colors.brand} />} />
            <Field label="Middle name (optional)" validationKind="name" hint="Leave blank if you do not use a middle name." placeholder="Middle name" value={middleName} onChangeText={setMiddleName} maxLength={60} autoCapitalize="words" autoComplete="additional-name" leading={<Ionicons name="person-outline" size={19} color={colors.brand} />} />
            <Field label="Last name" required minLength={1} validationKind="name" error={fullNameTooLong ? "Use no more than 100 characters across all name fields." : undefined} placeholder="Last name" value={lastName} onChangeText={setLastName} maxLength={60} autoCapitalize="words" autoComplete="family-name" leading={<Ionicons name="person-outline" size={19} color={colors.brand} />} />
            <Field label="Age" validationKind="age" hint="Leave blank to keep the saved age. Only you and authorized city administrators can view it." placeholder="Age" value={age} onChangeText={(value) => setAge(value.replace(/\D/g, "").slice(0, 3))} error={age ? residentAgeError(age) || undefined : undefined} maxLength={3} keyboardType="number-pad" autoComplete="off" leading={<Ionicons name="calendar-outline" size={19} color={colors.brand} />} />
            <Field label="Mobile number (optional)" validationKind="phone" hint="Philippine mobile number, e.g. 0917 123 4567." placeholder="0917 123 4567" value={phone} onChangeText={setPhone} maxLength={24} keyboardType="phone-pad" autoComplete="tel" error={phone ? mobileInputError(phone) || undefined : undefined} leading={<Ionicons name="call-outline" size={19} color={colors.brand} />} />
            <View style={{ gap: 7, marginTop: 3 }}><Text style={s.fieldLabel}>Your barangay</Text><Choices compact title="Choose a barangay" subtitle="Choose your home barangay for relevant local updates." sheetKind="barangay" items={barangays} value={barangay} onChange={setBarangay} leadingIcon="location-outline" /></View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}><Button grow secondary title="Cancel" disabled={busy} onPress={() => { setFirstName(p.first_name || ""); setMiddleName(p.middle_name || ""); setLastName(p.last_name || ""); setAge(p.age == null ? "" : String(p.age)); setPhone(p.phone || ""); setBarangay(p.barangay_id || ""); setEditing(false); setMessage(""); }} /><Button grow title="Save changes" loading={busy} disabled={!!namePartsProblem || !!ageProblem || !!mobileInputError(phone)} onPress={() => void saveProfile()} /></View>
          </> : <>
            <ProfileInfoRow icon="person-outline" label="Full name" value={p.display_name.trim() || "Not set"} />
            <ProfileInfoRow icon="calendar-outline" label="Age" value={p.age == null ? "Not provided" : String(p.age)} />
            <ProfileInfoRow icon="call-outline" label="Mobile number" value={p.phone || "Not provided"} />
            <ProfileInfoRow icon="location-outline" label="Your barangay" value={homeBarangay} />
            <ProfileInfoRow icon="mail-outline" label="Email address" value={userEmail} last />
          </>}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="options-outline" size={20} color={colors.brand} /><Text style={[s.title, { marginBottom: 0 }]}>Notification preferences</Text></View>
        <View style={[s.card, { padding: 12, gap: 8, borderRadius: 18 }]}>
          <Pressable aria-checked={notifications} {...(Platform.OS === "web" ? { onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === " ") { event.preventDefault(); if (!event.repeat) void updateNotifications(!notifications); } } } : {})} accessibilityRole="switch" accessibilityLabel="In-app updates for reports, community, meetings, and announcements" accessibilityState={{ disabled: notificationBusy, checked: notifications, busy: notificationBusy }} disabled={notificationBusy} onPress={() => void updateNotifications(!notifications)} style={{ minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 15, backgroundColor: "#f5fbf9" }}>
            <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: "#e1f5f1", alignItems: "center", justifyContent: "center" }}><Ionicons name="notifications-outline" size={20} color={colors.brand} /></View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={s.fieldLabel}>In-app updates</Text><Text style={s.small}>Report, community, meeting and official announcement updates.</Text></View>
            <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{Platform.OS === "web" ? <View style={{ width: 40, height: 20, borderRadius: 10, backgroundColor: notifications ? "#08756b" : colors.line, alignItems: notifications ? "flex-end" : "flex-start" }}><View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: notifications ? colors.brand : "#f6fbfa" }} /></View> : <Switch accessible={false} disabled={notificationBusy} value={notifications} trackColor={{ false: colors.line, true: "#08756b" }} thumbColor={notifications ? colors.brand : "#f6fbfa"} />}</View>
          </Pressable>
          {Platform.OS !== "web" && <View style={{ minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
            <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: "#e1f5f1", alignItems: "center", justifyContent: "center" }}><Ionicons name="phone-portrait-outline" size={20} color={colors.brand} /></View>
            <Text style={[s.fieldLabel, { flex: 1 }]}>Phone alerts</Text>
            <Switch accessibilityRole="switch" accessibilityLabel="Phone alerts" accessibilityState={{ disabled: notificationBusy || deviceAlertsAllowed === null, checked: phoneAlertsEnabled && deviceAlertsAllowed === true }} disabled={notificationBusy || deviceAlertsAllowed === null} value={phoneAlertsEnabled && deviceAlertsAllowed === true} onValueChange={(value) => void togglePhoneAlerts(value)} trackColor={{ false: colors.line, true: "#08756b" }} thumbColor={phoneAlertsEnabled && deviceAlertsAllowed === true ? colors.brand : "#f6fbfa"} />
          </View>}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="stats-chart-outline" size={20} color={colors.brand} /><Text style={[s.title, { marginBottom: 0 }]}>My activity</Text></View>
        <View style={{ flexDirection: "row", gap: 7 }}>
          {activityCards.map((item) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`${item.title}: ${item.count ?? (activity.isPending ? "loading" : "unavailable")}`} onPress={item.action} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 92, justifyContent: "space-between", gap: 5, padding: 8, borderRadius: 16, borderWidth: 1, borderColor: "#dfebee", backgroundColor: "white" }, pressed && { backgroundColor: "#f5fbf9", opacity: 0.84 }]}>
            <View style={{ width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: item.tone.background }}><Ionicons name={item.icon} size={17} color={item.tone.foreground} /></View>
            <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>{item.title}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 3 }}><Text style={{ color: colors.brandDark, fontSize: 17, fontWeight: "800" }}>{activity.isPending ? "…" : activity.error ? "—" : item.count ?? 0}</Text><Ionicons name="chevron-forward" size={15} color={colors.muted} /></View>
          </Pressable>)}
        </View>
        {activity.error && <Pressable accessibilityRole="button" onPress={() => void activity.refetch()} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}><Ionicons name="refresh-outline" size={15} color={colors.brand} /><Text style={[s.small, { color: colors.brand }]}>Activity counts unavailable · Retry</Text></Pressable>}
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="lock-closed-outline" size={19} color={colors.brand} /><Text style={[s.title, { marginBottom: 0 }]}>Account & security</Text></View>
        <View style={[s.card, { padding: 12, gap: 2, borderRadius: 18 }]}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: password }} onPress={() => setPassword(!password)} style={({ pressed }) => [{ minHeight: 55, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 }, pressed && { opacity: 0.78 }]}>
            <View style={{ width: 39, height: 39, borderRadius: 14, backgroundColor: "#e8f4ff", alignItems: "center", justifyContent: "center" }}><Ionicons name="key-outline" size={19} color="#2879b4" /></View>
            <View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "800" }}>Change password</Text><Text style={s.small}>Update your sign-in password securely.</Text></View><Ionicons name={password ? "chevron-up" : "chevron-forward"} size={18} color={colors.muted} />
          </Pressable>
          {password && <View style={{ paddingHorizontal: 3, paddingBottom: 9 }}><PasswordChange /></View>}
          <View style={{ height: 1, backgroundColor: colors.line, marginHorizontal: 2 }} />
          <View style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 }}><View style={{ width: 39, height: 39, borderRadius: 14, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="mail-outline" size={19} color={colors.brand} /></View><View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "800" }}>Email verification</Text><Text numberOfLines={1} style={s.small}>{auth.data?.email_confirmed_at ? "Email address verified" : auth.isPending ? "Checking account status…" : auth.data?.email ? "Email address not verified" : "Verification status unavailable"}</Text></View><Ionicons name={auth.data?.email_confirmed_at ? "checkmark-circle" : "information-circle-outline"} size={18} color={auth.data?.email_confirmed_at ? "#07845a" : colors.muted} /></View>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="shield-checkmark-outline" size={20} color={colors.brand} /><Text style={[s.title, { marginBottom: 0 }]}>Privacy & data</Text></View>
        <View style={[s.card, { padding: 12, gap: 0, borderRadius: 18 }]}>
          {privacyItems.map((item, index) => <View key={item.key}>
            {index > 0 && <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 48 }} />}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: privacy === item.key }} onPress={() => setPrivacy(privacy === item.key ? "" : item.key)} style={({ pressed }) => [{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 }, pressed && { opacity: 0.78 }]}>
              <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: item.key === "location" ? "#e8f4ff" : "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={item.icon} size={18} color={item.key === "location" ? "#2879b4" : colors.brand} /></View>
              <Text style={{ flex: 1, color: colors.brandDark, fontSize: 13, fontWeight: "700" }}>{item.title}</Text><Ionicons name={privacy === item.key ? "chevron-up" : "chevron-forward"} size={17} color={colors.muted} />
            </Pressable>
            {privacy === item.key && <Text style={[s.small, { paddingLeft: 48, paddingRight: 6, paddingBottom: 11 }]}>{item.body}</Text>}
          </View>)}
          <Text style={[s.small, { marginTop: 5, paddingHorizontal: 3 }]}>Account deletion is not available in the app. An official request channel and records-retention review are needed before deletion can be safely offered.</Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="help-circle-outline" size={20} color={colors.brand} /><Text style={[s.title, { marginBottom: 0 }]}>Help & support</Text></View>
        <View style={[s.card, { padding: 12, gap: 1, borderRadius: 18 }]}>
          {helpItems.map((item, index) => <View key={item.key}>
            {index > 0 && <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 2 }} />}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: help === item.key }} onPress={() => setHelp(help === item.key ? "" : item.key)} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 2 }, pressed && { opacity: 0.78 }]}><Text style={{ flex: 1, color: colors.brandDark, fontSize: 13, fontWeight: "700" }}>{item.title}</Text><Ionicons name={help === item.key ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} /></Pressable>
            {help === item.key && <Text style={[s.small, { paddingHorizontal: 2, paddingBottom: 10 }]}>{item.body}</Text>}
          </View>)}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 7, padding: 10, borderRadius: 13, backgroundColor: "#eef5fb" }}><Ionicons name="information-circle-outline" size={18} color="#3776b7" style={{ marginTop: 1 }} /><Text style={[s.small, { flex: 1, color: "#355675" }]}>Iligan Connect helps report and coordinate civic issues. It is not an emergency response service. For immediate danger, contact local emergency services.</Text></View>
          <Text style={[s.small, { paddingHorizontal: 3, marginTop: 5 }]}>No in-app support contact is configured. Use official Iligan City channels for account-specific assistance.</Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="information-circle-outline" size={20} color={colors.brand} /><Text style={[s.title, { marginBottom: 0 }]}>About Iligan Connect</Text></View>
        <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 11, padding: 13, borderRadius: 18 }]}><View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="leaf-outline" size={20} color={colors.brand} /></View><View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.brandDark, fontSize: 14, fontWeight: "800" }}>Iligan Connect</Text><Text style={s.small}>A cleaner · safer · stronger Iligan</Text></View><Text style={[s.small, { fontWeight: "700" }]}>v{version}</Text></View>
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
            <Pressable accessibilityRole="button" onPress={() => setPhotoMenu(false)} style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.muted, fontSize: 13, fontWeight: "700" }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function PhotoAction({ icon, title, onPress, destructive = false }: { icon: "images-outline" | "camera-outline" | "trash-outline"; title: string; onPress: () => void; destructive?: boolean }) {
  const color = destructive ? "#ad403d" : colors.brand;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: destructive ? "#f1d9d7" : "#dcece9", backgroundColor: destructive ? "#fff8f7" : "#f7fbfa" }, pressed && { opacity: 0.78 }]}><Ionicons name={icon} size={20} color={color} /><Text style={{ color, fontSize: 14, fontWeight: "700" }}>{title}</Text></Pressable>;
}

function ProfileInfoRow({ icon, label, value, last = false }: { icon: "person-outline" | "calendar-outline" | "location-outline" | "mail-outline" | "call-outline"; label: string; value: string; last?: boolean }) {
  return <View>
    <View style={{ minHeight: 67, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 2, paddingVertical: 8 }}>
      <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={19} color={colors.brand} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={s.small}>{label}</Text><Text selectable numberOfLines={2} style={{ color: colors.brandDark, fontSize: 14, lineHeight: 19, fontWeight: "600" }}>{value}</Text></View>
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
  onNavigate: (t: string, reportId?: string | null, communitySection?: "consultations" | "meetings", announcementId?: string | null, consultationId?: string | null, meetingRequestId?: string | null) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const [page, setPage] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications", profileId, filter, page],
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = db!.from("notifications")
        .select("id,title,read_at,report_id,consultation_id,meeting_request_id,announcement_id,created_at", { count: "exact" })
        .eq("user_id", profileId);
      if (filter === "unread") query = query.is("read_at", null);
      if (filter === "read") query = query.not("read_at", "is", null);
      const [list, total, unread] = await Promise.all([
        query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(page * 20, page * 20 + 19),
        db!.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profileId),
        db!.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profileId).is("read_at", null),
      ]);
      for (const response of [list, total, unread]) if (response.error) throw response.error;
      return { items: (list.data ?? []) as {
        id: string;
        title: string;
        read_at: string | null;
        report_id: string | null;
        consultation_id: string | null;
        meeting_request_id: string | null;
        announcement_id: string | null;
        created_at: string;
      }[], count: list.count ?? 0, total: total.count ?? 0, unread: unread.count ?? 0 };
    },
  });
  const visibleNotifications = q.data?.items ?? [];
  const unreadCount = q.data?.unread;
  const readCount = q.data ? q.data.total - q.data.unread : undefined;
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
          <Pressable accessibilityRole="button" accessibilityLabel={`Filter notifications, currently ${filter}`} accessibilityHint="Choose all, unread, or read notifications" accessibilityState={{ expanded: filterOpen }} onPress={() => setFilterOpen(true)} style={({ pressed }) => [{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: "#dcebe7", backgroundColor: "#ffffffed" }, pressed && { opacity: 0.75 }]}>
            <Ionicons name="options-outline" size={17} color={colors.brand} />
            <Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "700" }}>{filter === "all" ? "All" : filter === "unread" ? "Unread" : "Read"}</Text>
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
              style={({ pressed }) => [{ minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 18, borderWidth: 1, borderColor: "#e5eff1", backgroundColor: "white", shadowColor: colors.brandDark, shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 48 }, elevation: 1 }, pressed && { backgroundColor: "#f3f8f5" }]}
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
                await onNavigate(destination, n.report_id, n.meeting_request_id ? "meetings" : undefined, n.announcement_id, n.consultation_id, n.meeting_request_id);
                if (!n.read_at) {
                  await result(
                    db!.from("notifications")
                      .update({ read_at: new Date().toISOString() })
                      .eq("id", n.id).eq("user_id", profileId).is("read_at", null),
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
                <Ionicons name={icon} size={23} color={colors.brand} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={[s.body, { fontSize: 14, lineHeight: 19, fontWeight: n.read_at ? "500" : "700" }]} numberOfLines={2}>{n.title}</Text>
                <Text style={s.small}>{opening === n.id ? "Opening update…" : new Date(n.created_at).toLocaleString()}</Text>
              </View>
              {!n.read_at && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }} />}
              <Ionicons name="chevron-forward" size={17} color={colors.muted} />
            </Pressable>
          );
        })
      ) : (
        <View style={[s.card, { alignItems: "center", paddingVertical: 28 }]}>
          <View style={{ width: 56, height: 56, borderRadius: 20, backgroundColor: "#e7f7f3", alignItems: "center", justifyContent: "center" }}><Ionicons name="notifications-off-outline" size={26} color={colors.brand} /></View>
          <Text style={s.title}>{filter === "all" ? "You’re all caught up" : `No ${filter} notifications`}</Text>
          <Text style={[s.small, { textAlign: "center" }]}>{filter === "all" ? "Updates about your reports and community will appear here." : "Choose another filter to see more notifications."}</Text>
        </View>
      )}
      {(page > 0 || (q.data?.count ?? 0) > 20) && <View style={{ gap: 8 }}>
        <Text style={[s.small, { textAlign: "center" }]}>Page {page + 1} of {Math.max(1, Math.ceil((q.data?.count ?? 0) / 20))}</Text>
        <View style={s.actionRow}>
          <Button grow secondary title="Previous" disabled={!page || q.isFetching} onPress={() => setPage((value) => Math.max(0, value - 1))} />
          <Button grow secondary title="Next" disabled={q.isFetching || !!q.error || (page + 1) * 20 >= (q.data?.count ?? 0)} onPress={() => setPage((value) => value + 1)} />
        </View>
      </View>}
      {message && <Text accessibilityRole="alert" style={s.error}>{message}</Text>}
      <Modal visible={filterOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setFilterOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#10263f77" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close notification filters" onPress={() => setFilterOpen(false)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
          <View style={{ paddingTop: 10, paddingHorizontal: 18, paddingBottom: 28, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "white", gap: 8 }}>
            <View style={{ alignSelf: "center", width: 46, height: 5, borderRadius: 3, backgroundColor: "#c8d2df", marginBottom: 5 }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <View style={{ gap: 2 }}><Text accessibilityRole="header" style={{ color: colors.brandDark, fontSize: 20, fontWeight: "800" }}>Filter notifications</Text><Text style={s.small}>Choose which updates to show.</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close notification filters" onPress={() => setFilterOpen(false)} style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#eff3f8" }}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>
            </View>
            {([
              ["all", "All notifications", q.data?.total, "notifications-outline"],
              ["unread", "Unread", unreadCount, "mail-unread-outline"],
              ["read", "Read", readCount, "mail-open-outline"],
            ] as const).map(([id, title, count, icon]) => {
              const selected = filter === id;
              return <Pressable key={id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => { setFilter(id); setPage(0); setFilterOpen(false); }} style={({ pressed }) => [{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: selected ? colors.brand : colors.line, backgroundColor: selected ? colors.brandSoft : colors.surface }, pressed && { opacity: 0.8 }]}>
                <Ionicons name={icon} size={20} color={selected ? colors.brand : colors.muted} />
                <Text style={{ flex: 1, color: selected ? colors.brand : colors.brandDark, fontSize: 14, fontWeight: selected ? "700" : "600" }}>{title}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{count ?? "…"}</Text>
                {selected && <Ionicons name="checkmark-circle" size={19} color={colors.brand} />}
              </Pressable>;
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}
