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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
import { Profile, Lookup, Report, Status, statuses, label, textInputError, residentNamePartsError, residentDisplayName, residentAgeError, emailInputError, mobileInputError, normalizePhilippineMobile, passwordInputError, MIN_PASSWORD_LENGTH, EMAIL_OTP_LENGTH, EMAIL_OTP_EXPIRY_SECONDS, EMAIL_RESEND_INTERVAL_SECONDS } from "@community/shared";
import { ReportForm, ReportTracking, Explore as ExploreScreen } from "../features/reports";
import { Community as CommunityScreen, Announcements } from "../features/community";
import { ListSkeleton } from "../components/loading";
const REPORT_PAGE_SIZE = 5;
const RESIDENT_TERMS_VERSION = "2026-11-15";
const RESIDENT_APP_VERSION = (require("../app.json") as { expo: { version: string } }).expo.version;
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
async function signOutResident(profileId: string) {
  await removeDevicePushTokens(profileId).catch(() => undefined);
  const { error } = await db!.auth.signOut();
  if (error) throw error;
}
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
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const compactPhone = viewportWidth < 360;
  const tabletWeb = Platform.OS === "web" && viewportWidth >= 768 && viewportWidth < 1200;
  const desktopWeb = Platform.OS === "web" && viewportWidth >= 1200;
  const compactTablet = tabletWeb && viewportHeight < 760;
  const wideDashboard = desktopWeb || (tabletWeb && viewportWidth >= 1024);
  const tabletContentMaxWidth = viewportWidth < 840
    ? Math.max(700, viewportWidth - 32)
    : viewportWidth < 1024 ? 820 : viewportWidth < 1080 ? 880 : 940;
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
    [reportStatusFilter, setReportStatusFilter] = useState<Status | "all">("all"),
    [showAllCategories, setShowAllCategories] = useState(false),
    [showAllReports, setShowAllReports] = useState(false),
    [reportsReturnTab, setReportsReturnTab] = useState<"Home" | "Profile">("Home"),
    [barangaysOpen, setBarangaysOpen] = useState(false),
    [barangayBusy, setBarangayBusy] = useState(false),
    [barangayMessage, setBarangayMessage] = useState(""),
    [failedReportPhotos, setFailedReportPhotos] = useState<Record<string, boolean>>({}),
    [refreshing, setRefreshing] = useState(false),
    [exploreMapGestureActive, setExploreMapGestureActive] = useState(false),
    [desktopNotificationsOpen, setDesktopNotificationsOpen] = useState(false),
    [notificationReturnTab, setNotificationReturnTab] = useState("Home"),
    [reportReturnTab, setReportReturnTab] = useState("Home"),
    [communityInitialTab, setCommunityInitialTab] = useState<"consultations" | "meetings">("consultations"),
    [desktopHoveredNavigationTab, setDesktopHoveredNavigationTab] = useState<string | null>(null),
    [desktopFocusedNavigationTab, setDesktopFocusedNavigationTab] = useState<string | null>(null),
    [desktopSignOutConfirm, setDesktopSignOutConfirm] = useState(false),
    [desktopSignOutBusy, setDesktopSignOutBusy] = useState(false),
    [desktopSignOutError, setDesktopSignOutError] = useState("");
  const qc = useQueryClient();
  const sessionUser = useRef<string | null>(null);
  const barangaysAnchorRef = useRef<View>(null);
  const scroll = useRef<ScrollView>(null);
  const exploreScrollY = useRef(0);
  const mainScrollY = useRef(0);
  const onMapPageScroll = useCallback((delta: number) => {
    const nextY = Math.max(0, mainScrollY.current + delta);
    mainScrollY.current = nextY;
    if (tab === "Explore" && !selected) exploreScrollY.current = nextY;
    scroll.current?.scrollTo({ y: nextY, animated: false });
  }, [tab, selected]);
  const scrollToPageTop = useCallback(() => {
    mainScrollY.current = 0;
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, []);
  const onScrollToReportSection = useCallback((y: number) => {
    const nextY = Math.max(0, y);
    mainScrollY.current = nextY;
    scroll.current?.scrollTo({ y: nextY, animated: true });
  }, []);
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
        setDesktopNotificationsOpen(false);
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
  useEffect(() => {
    if (desktopWeb && tab === "Notifications") setTab(notificationReturnTab === "Notifications" ? "Home" : notificationReturnTab);
  }, [desktopWeb, tab, notificationReturnTab]);
  const q = useQuery({
    queryKey: ["home", user],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      const profile = await result<Profile>(
        db!.from("profiles").select("*").eq("id", user!).single(),
      );
      if (profile.role !== "resident") {
        return {
          profile,
          categories: [] as Lookup[],
          barangays: [] as Lookup[],
          announcements: [] as { id: string; title: string; kind: string }[],
          unreadCount: 0,
          includeSamples: false,
        };
      }
      const [categories, barangays, announcements, unread, settings] = await Promise.all([
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
          .limit(2),
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
    queryKey: ["my-reports", user, page, q.data?.includeSamples, showAllReports ? reportStatusFilter : "all"],
    enabled: !!user && q.data?.profile.role === "resident" && tab === "Home" && !selected,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let reports = db!.from("reports")
        .select("*", { count: "exact" }).eq("resident_id", user!)
      if (showAllReports && reportStatusFilter !== "all") reports = reports.eq("status", reportStatusFilter);
      const { data, count, error } = await reports
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
    enabled: !!user && q.data?.profile.role === "resident" && tab === "Home" && !selected && reportIds.length > 0,
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
  if (!user) return <Auth initialError={authError} onRecoveryVerified={() => setRecovery(true)} />;
  if (recovery)
    return (
      <SafeAreaView style={s.screen}>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.heading}>Choose a new password</Text>
          <PasswordChange onDone={() => setRecovery(false)} />
        </ScrollView>
      </SafeAreaView>
    );
  if (q.data && q.data.profile.role !== "resident")
    return (
      <SafeAreaView style={s.screen}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
          <View style={[s.card, { width: "100%", maxWidth: 460, alignItems: "center", gap: 12, padding: 24 }]}>
            <Ionicons name="lock-closed-outline" size={28} color={colors.brand} />
            <Text accessibilityRole="header" style={[s.heading, { textAlign: "center" }]}>Resident access only</Text>
            <Text style={[s.body, { textAlign: "center" }]}>This website is for resident accounts. Your account belongs to the staff workspace. Sign out here and use the staff site to continue.</Text>
            <Button icon="log-out-outline" title="Sign out" onPress={() => void db!.auth.signOut()} />
          </View>
        </View>
      </SafeAreaView>
    );
  const report = (id = "") => {
    setCategory(id);
    setSelected(null);
    setShowAllReports(false);
    setTab("Report");
  };
  const homeReports = reportsQuery.data?.reports ?? [];
  const navigationTab = showAllReports ? reportsReturnTab : tab;
  async function confirmDesktopSignOut() {
    if (desktopSignOutBusy || !q.data?.profile.id) return;
    setDesktopSignOutBusy(true);
    setDesktopSignOutError("");
    try {
      await signOutResident(q.data.profile.id);
      setDesktopSignOutConfirm(false);
    } catch (error) {
      setDesktopSignOutError((error as Error).message || "Could not sign out. Please try again.");
    } finally {
      setDesktopSignOutBusy(false);
    }
  }
  const chooseNavigationTab = (name: string) => {
    if (tab === name && !selected && !(name === "Home" && showAllReports)) return;
    setSelected(null);
    setShowAllReports(false);
    if (name === "Report") report();
    else {
      if (name === "Community") { setCommunityInitialTab("consultations"); setCommunityTarget({}); }
      setTab(name);
    }
  };
  const navigateFromNotification = async (
    destination: string,
    reportId?: string | null,
    communitySection?: "consultations" | "meetings",
    announcementId?: string | null,
    consultationId?: string | null,
    meetingRequestId?: string | null,
    fromDesktopModal = false,
  ) => {
    if (reportId) {
      let report = await result<Report | null>(db!.from("reports").select("*").eq("id", reportId).maybeSingle());
      if (!report) report = (await result<Report[]>(db!.rpc("public_report_by_id", { p_id: reportId })))[0] ?? null;
      if (!report) throw new Error("This report is no longer available to your account.");
      setReportReturnTab(fromDesktopModal ? notificationReturnTab : "Notifications");
      setSelected(report);
    }
    if (destination === "Community") {
      setCommunityInitialTab(communitySection || "consultations");
      setCommunityTarget({ consultationId, meetingRequestId });
    }
    if (destination === "Announcements") setSelectedAnnouncement(announcementId || null);
    setTab(destination);
    if (fromDesktopModal) setDesktopNotificationsOpen(false);
  };
  const openConsultationReport = async (reportId: string, origin: { consultationId?: string; meetingRequestId?: string }) => {
    let report = await result<Report | null>(db!.from("reports").select("*").eq("id", reportId).maybeSingle());
    if (!report) report = (await result<Report[]>(db!.rpc("public_report_by_id", { p_id: reportId })))[0] ?? null;
    if (!report) throw new Error("This linked report is no longer available to your account.");
    setReportReturnTab("Community");
    setCommunityInitialTab(origin.meetingRequestId ? "meetings" : "consultations");
    setCommunityTarget(origin);
    setSelected(report);
    setTab("Community");
  };
  const renderNavigation = (variant: "mobile" | "tablet" | "desktop") => (
    <View style={[
      s.nav,
      variant === "tablet" && { width: "100%", maxWidth: tabletContentMaxWidth, alignSelf: "center", marginHorizontal: 0, marginBottom: compactTablet ? 8 : 10, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 16, shadowOpacity: 0.06, elevation: 2 },
      variant === "desktop" && { flexDirection: "column", width: "100%", marginHorizontal: 0, marginBottom: 0, paddingHorizontal: 0, paddingVertical: 6, gap: 4, borderWidth: 0, borderRadius: 0, backgroundColor: "transparent", shadowOpacity: 0, elevation: 0 },
    ]}>
      {tabs.map(([name, icon]) => {
        const active = navigationTab === name;
        const desktopHighlighted = variant === "desktop" && (active || desktopHoveredNavigationTab === name || desktopFocusedNavigationTab === name);
        return (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => chooseNavigationTab(name)}
            onHoverIn={() => { if (variant === "desktop") setDesktopHoveredNavigationTab(name); }}
            onHoverOut={() => { if (variant === "desktop") setDesktopHoveredNavigationTab((current) => current === name ? null : current); }}
            onFocus={() => { if (variant === "desktop") setDesktopFocusedNavigationTab(name); }}
            onBlur={() => { if (variant === "desktop") setDesktopFocusedNavigationTab((current) => current === name ? null : current); }}
            style={[s.navItem,
              variant === "tablet" && { minHeight: compactTablet ? 44 : 48, paddingVertical: 4, gap: 2 },
              variant === "desktop" && { flex: 0, minHeight: 46, flexDirection: "row", justifyContent: "flex-start", paddingHorizontal: 12, paddingVertical: 7, gap: 11, borderRadius: 10 },
              active && variant !== "desktop" && s.navItemActive,
              desktopHighlighted && { backgroundColor: colors.brand },
            ]}
          >
            {name === "Report" ? (
              <View style={[s.navAction,
                active && variant !== "desktop" && s.navActionActive,
                variant !== "mobile" && { width: 30, height: 30, marginTop: 0, marginBottom: 0, borderRadius: 15, shadowOpacity: 0, elevation: 0 },
                variant === "tablet" && { width: 34, height: 34, borderRadius: 17 },
                variant === "desktop" && { width: 20, height: 20, borderRadius: 10, backgroundColor: desktopHighlighted ? "#ffffff26" : "transparent", shadowOpacity: 0 },
              ]}>
                <Ionicons name={icon} size={variant === "desktop" ? 20 : 22} color={variant === "desktop" ? desktopHighlighted ? "white" : "#60777c" : "white"} />
              </View>
            ) : (
            <Ionicons name={icon} size={variant === "desktop" ? 20 : 22} color={variant === "desktop" ? desktopHighlighted ? "white" : "#60777c" : active ? colors.brand : colors.muted} />
            )}
            <Text style={[s.navText,
              variant !== "mobile" && { fontSize: variant === "desktop" ? 14 : 11 },
              variant === "desktop" && { flex: 1, textAlign: "left" },
              active && variant !== "desktop" && { color: colors.brand },
              variant === "desktop" && { color: desktopHighlighted ? "white" : "#536d73" },
            ]}>{name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const contentMaxWidth = desktopWeb
    ? 1360
    : tabletWeb ? tabletContentMaxWidth : 620;
  return (
    <SafeAreaView style={s.screen}>
      <View style={{ width: "100%", borderBottomWidth: 1, borderColor: colors.line, backgroundColor: "white" }}>
      <View style={{
        paddingHorizontal: desktopWeb ? 24 : tabletWeb ? (viewportWidth < 840 ? 16 : 20) : 18,
        paddingVertical: 8,
        minHeight: desktopWeb ? 68 : tabletWeb ? (compactTablet ? 58 : 64) : 58,
        width: "100%",
        maxWidth: desktopWeb ? undefined : tabletWeb ? tabletContentMaxWidth : undefined,
        alignSelf: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 11 }}>
          <Image source={require("../assets/iligan-connect-logo.png")} accessibilityLabel="Iligan Connect logo" resizeMode="contain" style={{ width: 46, height: 46 }} />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text numberOfLines={1} style={[s.eyebrow, { color: colors.brand, fontSize: 13, letterSpacing: 1.8 }]}>ILIGAN CONNECT</Text>
            {!compactPhone && <Text numberOfLines={1} style={{ fontSize: 9, letterSpacing: 1.3, color: "#5d7378", fontWeight: "600" }}>A CLEANER · SAFER · STRONGER ILIGAN</Text>}
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            accessibilityLabel={q.data?.unreadCount ? `Notifications, ${q.data.unreadCount} unread` : "Notifications"}
            accessibilityHint="Opens your notifications"
            accessibilityRole="button"
            accessibilityState={{ selected: desktopWeb ? desktopNotificationsOpen : tab === "Notifications" }}
            onPress={() => {
              if (desktopWeb) {
                setNotificationReturnTab(tab === "Notifications" ? "Home" : tab);
                setDesktopNotificationsOpen(true);
                return;
              }
              setSelected(null);
              setNotificationReturnTab(tab === "Notifications" ? "Home" : tab);
              setTab("Notifications");
            }}
            style={({ pressed }) => [
              { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 16 },
              (pressed || (desktopWeb ? desktopNotificationsOpen : tab === "Notifications")) && { backgroundColor: "#eaf5ef" },
            ]}
          >
            <Ionicons name="notifications-outline" size={23} color={colors.brandDark} />
            {!!q.data?.unreadCount && (
              <View
                style={{
                  position: "absolute",
                  right: 3,
                  top: 3,
                  minWidth: 19,
                  height: 19,
                  paddingHorizontal: 4,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#d93025",
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: "white",
                }}
                pointerEvents="none"
                accessible={false}
              >
                <Text style={{ color: "white", fontSize: 10, lineHeight: 13, fontWeight: "800" }}>
                  {q.data.unreadCount > 99 ? "99+" : q.data.unreadCount}
                </Text>
              </View>
            )}
          </Pressable>
          {desktopWeb && <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={() => { setDesktopSignOutError(""); setDesktopSignOutConfirm(true); }}
            style={({ pressed }) => [{ minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1, borderColor: "#f0d9d7", backgroundColor: "#fff8f7", opacity: pressed ? 0.76 : 1 }]}
          >
            <Ionicons name="log-out-outline" size={17} color="#ad403d" />
            <Text style={{ color: "#ad403d", fontSize: 12, fontWeight: "800" }}>Sign out</Text>
          </Pressable>}
        </View>
      </View>
      </View>
      <View style={[{ flex: 1, minHeight: 0 }, desktopWeb && { flexDirection: "row" }]}>
      {desktopWeb && <View style={{ width: 232, paddingHorizontal: 16, paddingTop: 26, paddingBottom: 12, borderRightWidth: 1, borderColor: "#e2ece9", backgroundColor: "#fbfdfc" }}>
        <Text style={{ marginLeft: 11, marginBottom: 12, color: "#70858a", fontSize: 10, fontWeight: "800", letterSpacing: 1.1 }}>YOUR WORKSPACE</Text>
        {renderNavigation("desktop")}
        <View style={{ flex: 1 }} />
        <View style={{ margin: 4, marginBottom: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#e2ece9", backgroundColor: "#f2f8f6" }}><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="location-outline" size={17} color={colors.brand} /><Text style={{ color: colors.brandDark, fontSize: 12, fontWeight: "700" }}>Iligan City</Text></View><Text style={{ marginTop: 4, marginLeft: 25, color: "#60777c", fontSize: 10, lineHeight: 15 }}>Community reporting · Lanao del Norte</Text></View>
        <View style={{ marginHorizontal: 8, paddingTop: 12, paddingBottom: 4, borderTopWidth: 1, borderTopColor: "#e2ece9", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: "#70858a", fontSize: 10, fontWeight: "700" }}>APP VERSION</Text>
          <Text style={{ color: colors.brandDark, fontSize: 11, fontWeight: "800" }}>v{RESIDENT_APP_VERSION}</Text>
        </View>
      </View>}
      <KeyboardAvoidingView
        style={{ flex: 1, minWidth: 0, backgroundColor: desktopWeb ? "#f5f8f7" : undefined }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {tabletWeb && renderNavigation("tablet")}
        <ScrollView
          style={Platform.select({ web: { flex: 1, width: "100%", scrollPaddingBottom: tabletWeb || desktopWeb ? 36 : 124 } })}
          ref={scroll}
          scrollEnabled={Platform.OS === "android" || !(tab === "Explore" && !selected && exploreMapGestureActive)}
          onScroll={(event) => { mainScrollY.current = event.nativeEvent.contentOffset.y; if (tab === "Explore" && !selected) exploreScrollY.current = mainScrollY.current; }}
          scrollEventThrottle={16}
          contentContainerStyle={[
            s.scroll,
            tab === "Home" && { gap: 9, paddingTop: 12 },
            (tabletWeb || desktopWeb) && { maxWidth: contentMaxWidth, paddingHorizontal: desktopWeb ? 40 : viewportWidth < 840 ? 16 : 20, paddingTop: desktopWeb ? 36 : compactTablet ? 14 : 20, paddingBottom: desktopWeb ? 48 : compactTablet ? 26 : 32, gap: desktopWeb ? 24 : compactTablet ? 12 : 15 },
          ]}
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
          {desktopWeb && !selected && ["Home", "Explore", "Community", "Report", "Profile", "Notifications", "Announcements"].includes(tab) && <View style={{ minHeight: 82, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 24, marginBottom: 3, paddingBottom: 19, borderBottomWidth: 1, borderBottomColor: "#e0e9e7" }}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text accessibilityRole="header" style={{ color: "#173b45", fontSize: 27, lineHeight: 33, fontWeight: "700", letterSpacing: -0.65 }}>{tab === "Home" ? "Home" : tab === "Explore" ? "Explore Iligan" : tab === "Community" ? "Community" : tab === "Report" ? "Report a concern" : tab === "Profile" ? "Your profile" : tab === "Notifications" ? "Notifications" : "Announcements"}</Text>
              <Text numberOfLines={1} style={{ color: "#61777d", fontSize: 13, lineHeight: 19 }}>{tab === "Home" ? "Reports and local updates from your community." : tab === "Explore" ? "Browse local reports, places and barangay activity." : tab === "Community" ? "Join conversations and follow meeting updates in your area." : tab === "Report" ? "Share an issue with the city and follow its progress." : tab === "Profile" ? "Personal details, settings, and help for your resident account." : tab === "Notifications" ? "Updates about your reports and community activity." : "Official updates from your barangay and Iligan City."}</Text>
            </View>
            {tab !== "Report" && tab !== "Home" && <Pressable accessibilityRole="button" accessibilityLabel="Start a report" onPress={() => report()} style={({ pressed }) => [{ minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 15, borderRadius: 9, backgroundColor: colors.brand, opacity: pressed ? 0.85 : 1 }]}><Ionicons name="add" size={18} color="white" /><Text style={{ color: "white", fontSize: 13, fontWeight: "700" }}>New report</Text></Pressable>}
          </View>}
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
                    myBarangayId={q.data.profile.barangay_id || ""}
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
                    backLabel={reportReturnTab === "Notifications" ? "Back to notifications" : reportReturnTab === "Explore" ? "Back to map" : reportReturnTab === "Community" ? "Back to conversation" : "Back to reports"}
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
                    onScrollToReportSection={onScrollToReportSection}
                    onSaved={() => {
                      setTab("Home");
                      setPage(0);
                      setReportStatusFilter("all");
                      setReportsReturnTab("Home");
                      setShowAllReports(true);
                      void qc.invalidateQueries({ queryKey: ["my-reports", user] });
                    }}
                  />
                ) : tab === "Explore" ? null : tab === "Community" ? (
                  <Community
                    residentId={q.data.profile.id}
                    barangays={q.data.barangays}
                    categories={q.data.categories}
                    defaultBarangay={q.data.profile.barangay_id || ""}
                    onPageNavigate={scrollToPageTop}
                    initialTab={communityInitialTab}
                    initialConsultationId={communityTarget.consultationId}
                    initialMeetingRequestId={communityTarget.meetingRequestId}
                    onOpenReport={openConsultationReport}
                  />
                ) : tab === "Announcements" ? (
                  <Announcements barangays={q.data.barangays} initialSelected={selectedAnnouncement} />
                ) : tab === "Notifications" && !desktopWeb ? (
                  <NotificationCenter
                    profileId={q.data.profile.id}
                    backLabel={`Back to ${notificationReturnTab.toLowerCase()}`}
                    onBack={() => setTab(notificationReturnTab)}
                    onNavigate={(destination, reportId, communitySection, announcementId, consultationId, meetingRequestId) => navigateFromNotification(destination, reportId, communitySection, announcementId, consultationId, meetingRequestId)}
                  />
                ) : tab === "Profile" ? (
                  <ProfileForm
                    profile={q.data.profile}
                    barangays={q.data.barangays}
                    onPageNavigate={scrollToPageTop}
                    onNavigate={(destination, communityTab, homePage) => {
                      if (communityTab) setCommunityInitialTab(communityTab);
                      if (destination === "Community") setCommunityTarget({});
                      if (destination === "Home") {
                        setPage(0);
                        setReportsReturnTab(homePage === "reports" ? "Profile" : "Home");
                        setShowAllReports(homePage === "reports");
                        scrollToPageTop();
                      } else setShowAllReports(false);
                      setTab(destination);
                    }}
                  />
                ) : (
                  <View style={wideDashboard && !showAllReports ? { flexDirection: "row", alignItems: "flex-start", gap: desktopWeb ? 28 : 24 } : { gap: 16 }}>
                    <View style={wideDashboard && !showAllReports ? { flex: desktopWeb ? 1.15 : 1, minWidth: 0, gap: desktopWeb ? 22 : 18 } : { gap: 12 }}>
                    {showAllReports ? (
                      <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${reportsReturnTab}`} onPress={() => { setShowAllReports(false); setPage(0); setTab(reportsReturnTab); scrollToPageTop(); }} style={({ pressed }) => [{ alignSelf: "flex-start", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, borderRadius: 22, backgroundColor: "#def6f3" }, pressed && { opacity: 0.8 }]}><Ionicons name="arrow-back" size={17} color={colors.brand} /><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "800" }}>Back to {reportsReturnTab}</Text></Pressable>
                    ) : <>
                    <View style={desktopWeb ? { minHeight: 112, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 20, overflow: "visible" } : { minHeight: tabletWeb ? compactTablet ? 104 : 112 : 120, justifyContent: "flex-end", paddingHorizontal: 3, paddingBottom: 4, overflow: "hidden" }}>
                      {!desktopWeb && <View pointerEvents="none" style={{ position: "absolute", right: -14, top: -8, width: "108%", height: 150 }}>
                        <Image source={require("../assets/iligan-home-header.jpg")} accessible={false} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
                      </View>}
                      <View style={{ flex: 1, minWidth: 0, gap: desktopWeb ? 2 : 0 }}>
                        <Text style={{ color: colors.muted, fontSize: desktopWeb ? 13 : 16, lineHeight: desktopWeb ? 19 : 21 }}>Good day,</Text>
                        <Text accessibilityRole="header" adjustsFontSizeToFit numberOfLines={2} style={{ maxWidth: desktopWeb ? "100%" : "95%", color: "#10263f", fontSize: desktopWeb ? 32 : 29, lineHeight: desktopWeb ? 39 : 35, fontWeight: "800", letterSpacing: -0.8 }}>Welcome, {q.data.profile.display_name || "neighbor"}.</Text>
                      </View>
                      <Pressable ref={barangaysAnchorRef} accessibilityRole="button" accessibilityLabel="Choose your barangay" accessibilityHint="Updates the barangay on your profile" accessibilityState={{ expanded: barangaysOpen }} onPress={() => { setBarangayMessage(""); setBarangaysOpen((open) => !open); }} style={({ pressed }) => [{ minHeight: desktopWeb ? 42 : 48, alignSelf: desktopWeb ? "center" : "flex-start", flexDirection: "row", alignItems: "center", gap: 9, marginTop: desktopWeb ? 0 : 12, paddingHorizontal: desktopWeb ? 12 : 14, paddingVertical: 8, borderRadius: desktopWeb ? 9 : 24, borderWidth: 1, borderColor: "#d9e9ed", backgroundColor: "white" }, pressed && { opacity: 0.8 }]}>
                        <Ionicons name="location" size={19} color={colors.brand} />
                        <Text numberOfLines={1} style={{ maxWidth: 215, color: "#526b82", fontSize: 14, fontWeight: "600" }}>{q.data.barangays.find((b) => b.id === q.data.profile.barangay_id)?.name || "Choose your barangay"} · Iligan City</Text>
                        <Ionicons name="chevron-down" size={16} color={colors.muted} />
                      </Pressable>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Start a report" onPress={() => report()} style={({ pressed }) => [{ minHeight: desktopWeb ? 184 : tabletWeb ? compactTablet ? 124 : 136 : 150, justifyContent: "center", padding: desktopWeb ? 26 : tabletWeb ? 16 : 20, borderRadius: tabletWeb ? 20 : 24, backgroundColor: colors.brandDark, overflow: "hidden", shadowColor: colors.brandDark, shadowOpacity: desktopWeb ? 0.12 : 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: desktopWeb ? 5 : 48 }, elevation: 3 }, pressed && { opacity: 0.92, transform: [{ scale: 0.995 }] }]}>
                      <View pointerEvents="none" style={{ position: "absolute", right: -50, top: -54, width: 225, height: 225, borderRadius: 120, borderWidth: 1, borderColor: "#ffffff16" }} />
                      <View pointerEvents="none" style={{ position: "absolute", right: -15, bottom: -100, width: 235, height: 190, borderRadius: 120, borderWidth: 1, borderColor: "#41c5b123" }} />
                      <View style={{ maxWidth: desktopWeb ? "70%" : "60%", gap: 6 }}>
                        <Text style={{ color: "#b8efe8", fontSize: 11, fontWeight: "800", letterSpacing: 1.7 }}>REPORT & TRACK</Text>
                        <Text style={{ color: "white", fontSize: desktopWeb ? 25 : 21, lineHeight: desktopWeb ? 31 : 25, fontWeight: "800", letterSpacing: -0.45 }}>Report a local issue.</Text>
                        <Text style={{ color: "#d2e5e5", fontSize: desktopWeb ? 14 : 12, lineHeight: desktopWeb ? 21 : 18 }}>Help us build a cleaner, safer and stronger Iligan City. Share details and follow every update.</Text>
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
                        return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Report ${categoryDisplayName(item.name)}. ${description}`} style={({ pressed }) => [{ width: "48.5%", minHeight: tabletWeb ? compactTablet ? 66 : 72 : 80, padding: tabletWeb ? 6 : 7, borderRadius: tabletWeb ? 16 : 20, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white", flexDirection: "row", alignItems: "center", gap: 6, shadowColor: "#12343d", shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 48 }, elevation: 1 }, pressed && { backgroundColor: "#f6fbfa", opacity: 0.86 }]} onPress={() => report(item.id)}>
                          <View style={{ width: compactPhone ? 32 : 38, height: 44, borderRadius: 17, backgroundColor: tone.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(item.name)} size={compactPhone ? 21 : 23} color={tone.foreground} /></View>
                          <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={2} style={{ color: "#12343d", fontSize: 12, lineHeight: 16, fontWeight: "700" }}>{categoryDisplayName(item.name)}</Text><Text numberOfLines={2} style={{ color: "#5d7378", fontSize: 12, lineHeight: 16 }}>{description}</Text></View>
                          {!compactPhone && <Ionicons name="chevron-forward" size={14} color="#9aabba" />}
                        </Pressable>;
                      })}
                    </View>
                    <View style={{ gap: 8, marginTop: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 34 }}><Text style={{ color: "#12343d", fontSize: 15, fontWeight: "800", letterSpacing: -0.2 }}>From your community</Text><Pressable accessibilityRole="button" accessibilityLabel="View all announcements" onPress={() => { setSelectedAnnouncement(null); setTab("Announcements"); }} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 8 }}><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "700" }}>View all</Text><Ionicons name="chevron-forward" size={14} color={colors.brand} /></Pressable></View>
                    {q.data.announcements.length ? q.data.announcements.map((a) => (
                      <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`${a.kind}: ${a.title}. Open official update`} style={({ pressed }) => [{ minHeight: 76, flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 16, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white" }, pressed && { opacity: 0.85, backgroundColor: "#f9fcfb" }]} onPress={() => { setSelectedAnnouncement(a.id); setTab("Announcements"); }}>
                        <View style={{ width: compactPhone ? 40 : 44, height: compactPhone ? 40 : 44, borderRadius: 15, backgroundColor: "#e5f7f4", alignItems: "center", justifyContent: "center" }}><Ionicons name={a.kind.toLowerCase().includes("meeting") ? "calendar-outline" : "megaphone-outline"} size={20} color={colors.brand} /></View>
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text numberOfLines={1} style={{ color: "#008d86", fontSize: 10, lineHeight: 12, fontWeight: "800", letterSpacing: 0.7 }}>{a.kind.toUpperCase()}</Text><Text numberOfLines={2} style={{ color: "#10263f", fontSize: 13, lineHeight: 16, fontWeight: "700" }}>{a.title}</Text><Text style={{ color: "#5d7378", fontSize: 11, lineHeight: 14 }}>Read official update</Text></View>
                        <Ionicons name="chevron-forward" size={16} color="#8499a8" />
                      </Pressable>
                    )) : <View style={{ minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 15, paddingHorizontal: 11, backgroundColor: "white", borderWidth: 1, borderColor: "#e4eff0" }}><View style={{ width: 36, height: 36, borderRadius: 13, backgroundColor: "#e5f7f4", alignItems: "center", justifyContent: "center" }}><Ionicons name="megaphone-outline" size={18} color={colors.brand} /></View><View style={{ flex: 1, gap: 2 }}><Text style={{ color: "#12343d", fontSize: 12, lineHeight: 15, fontWeight: "700" }}>No new community announcements.</Text><Text style={{ color: "#5d7378", fontSize: 11, lineHeight: 14 }}>Check back for city and barangay updates.</Text></View></View>}
                    </View>
                    </>}
                    </View>
                    <View style={wideDashboard && !showAllReports ? { flex: desktopWeb ? 0.85 : 1, minWidth: 0, gap: desktopWeb ? 22 : 18 } : { gap: 12 }}>
                    <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: 8 }}>
                      <Text style={{ flex: 1, minWidth: 0, color: "#10263f", fontSize: 16, fontWeight: "800", letterSpacing: -0.2 }}>Your reports</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text accessibilityLiveRegion="polite" style={{ color: "#5d7378", fontSize: 11, fontWeight: "600" }}>{reportsQuery.data ? `${reportsQuery.data.count} ${showAllReports && reportStatusFilter !== "all" ? label(reportStatusFilter).toLowerCase() : "total"}` : ""}</Text>
                        {!showAllReports && <Pressable accessibilityRole="button" accessibilityLabel="View all your reports" onPress={() => { setPage(0); setReportsReturnTab("Home"); setShowAllReports(true); scrollToPageTop(); }} style={({ pressed }) => [{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 4 }, pressed && { opacity: 0.75 }]}><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "700" }}>View all</Text><Ionicons name="chevron-forward" size={14} color={colors.brand} /></Pressable>}
                      </View>
                    </View>
                    {showAllReports && <View style={{ gap: 6 }}>
                      <Text style={s.small}>Filter by status</Text>
                      <Choices
                        grow
                        compact
                        title="All statuses"
                        sheetTitle="Filter your reports"
                        subtitle="Choose a status to narrow your report list."
                        leadingIcon="options-outline"
                        searchable={false}
                        items={[{ id: "all", name: "All statuses" }, ...statuses.map((status) => ({ id: status, name: label(status) }))]}
                        value={reportStatusFilter}
                        onChange={(value) => { setReportStatusFilter(value as Status | "all"); setPage(0); }}
                      />
                    </View>}
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
                          style={({ pressed }) => [{ minHeight: 88, flexDirection: "row", alignItems: "center", gap: 11, padding: 11, borderRadius: 16, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white" }, pressed && { backgroundColor: "#f8fbf9", opacity: 0.9 }]}
                          key={r.id}
                          onPress={() => { setReportReturnTab("Home"); setSelected(r); }}
                        >
                          {reportPhotos.data?.urls[r.id] && !failedReportPhotos[r.id] ? <PhotoViewer source={{ uri: reportPhotos.data.urls[r.id] }} label={`${categoryName} report photo`} onError={() => setFailedReportPhotos((value) => ({ ...value, [r.id]: true }))} style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: "#eaf2f1" }} /> : <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: categoryToneFor(categoryName).background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(categoryName)} size={26} color={categoryToneFor(categoryName).foreground} /></View>}
                          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                            <Text style={[s.title, { fontSize: 13, lineHeight: 16 }]} numberOfLines={2}>{r.title}</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                              <View style={[s.statusBadge, { backgroundColor: tone.background }]}>
                                <Text numberOfLines={1} style={{ color: tone.foreground, fontSize: 10, fontWeight: "700" }}>{label(r.status)}</Text>
                              </View>
                              <Text style={{ color: colors.muted, fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString()}</Text>
                            </View>
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                        </Pressable>
                        );
                      })
                    ) : (
                      <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 9, padding: 11, borderRadius: 16, borderWidth: 1, borderColor: "#e4eff0", backgroundColor: "white" }}>
                        <View style={{ width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#f0f6f8" }}><Ionicons name="documents-outline" size={20} color="#3976a8" /></View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ color: "#12343d", fontSize: 12, lineHeight: 15, fontWeight: "700" }}>{showAllReports && reportStatusFilter !== "all" ? "No reports match this status." : page ? "No reports on this page." : "Your reports will appear here."}</Text>
                          <Text style={{ color: "#5d7378", fontSize: 11, lineHeight: 14 }}>{showAllReports && reportStatusFilter !== "all" ? "Choose All statuses to see every report." : "Once submitted, you can follow every recorded update."}</Text>
                        </View>
                      </View>
                    )}
                    {(page > 0 || (reportsQuery.data?.count ?? 0) > REPORT_PAGE_SIZE) && <View style={{ gap: 9 }}>
                      <Text style={{ alignSelf: "flex-start", color: "#5d7378", fontSize: 13 }} accessibilityLiveRegion="polite">{reportsLoading ? `Loading page ${page + 1}…` : `Page ${page + 1} of ${Math.max(1, Math.ceil((reportsQuery.data?.count ?? 0) / REPORT_PAGE_SIZE))}`}</Text>
                      <View style={s.actionRow}>
                        <Pressable accessibilityRole="button" accessibilityLabel="Previous report page" disabled={!page || reportsQuery.isFetching} onPress={() => setPage((value) => Math.max(0, value - 1))} style={{ flex: 1, minHeight: 54, borderWidth: 1, borderColor: "#e4eff0", borderRadius: 17, backgroundColor: "white", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: !page || reportsQuery.isFetching ? 0.48 : 1 }}><Ionicons name="chevron-back" size={19} color={colors.brand} /><Text style={{ color: !page ? "#9aabba" : "#526b82", fontSize: 14, fontWeight: "700" }}>Previous</Text></Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel="Next report page" disabled={reportsQuery.isFetching || !!reportsQuery.error || (page + 1) * REPORT_PAGE_SIZE >= (reportsQuery.data?.count ?? 0)} onPress={() => setPage((value) => value + 1)} style={{ flex: 1, minHeight: 54, borderWidth: 1, borderColor: "#dcebe8", borderRadius: 17, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: reportsQuery.isFetching || !!reportsQuery.error || (page + 1) * REPORT_PAGE_SIZE >= (reportsQuery.data?.count ?? 0) ? 0.48 : 1 }}><Text style={{ color: colors.brand, fontSize: 14, fontWeight: "800" }}>Next</Text><Ionicons name="chevron-forward" size={19} color={colors.brand} /></Pressable>
                      </View>
                    </View>}
                    </View>
                    <View style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 13, backgroundColor: "#e7f3fd", borderWidth: 1, borderColor: "#d4e8fb" }}><Ionicons name="information-circle" size={17} color="#2875bd" /><Text style={{ flex: 1, color: "#526b82", fontSize: 10, lineHeight: 14 }}>Not an emergency service. Stay clear of dangerous infrastructure while documenting a report.</Text></View>
                    </View>
                  </View>
                )}
              </>
            )
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      </View>
      {desktopWeb && q.data && <Modal visible={desktopNotificationsOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setDesktopNotificationsOpen(false)}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#071b276b" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close notifications" onPress={() => setDesktopNotificationsOpen(false)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
          <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 760, maxHeight: "86%", minHeight: 280, overflow: "hidden", borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, shadowColor: colors.brandDark, shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 }}>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10, padding: 22 }} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
              <NotificationCenter
                profileId={q.data.profile.id}
                backLabel="Close notifications"
                modal
                onBack={() => setDesktopNotificationsOpen(false)}
                onNavigate={(destination, reportId, communitySection, announcementId, consultationId, meetingRequestId) => navigateFromNotification(destination, reportId, communitySection, announcementId, consultationId, meetingRequestId, true)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>}
      {desktopWeb && <Modal visible={desktopSignOutConfirm} transparent animationType="fade" onRequestClose={() => !desktopSignOutBusy && setDesktopSignOutConfirm(false)}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 22, backgroundColor: "#071b27aa" }}>
          <View accessibilityRole="alert" style={[s.card, { width: "100%", maxWidth: 390, padding: 20, gap: 12, borderRadius: 18 }]}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: "#fff0ee", alignItems: "center", justifyContent: "center" }}><Ionicons name="log-out-outline" size={22} color="#ad403d" /></View>
            <Text style={[s.title, { fontSize: 19 }]}>Sign out of Iligan Connect?</Text>
            <Text style={s.small}>You can sign in again anytime. Your reports, requests, and profile will remain saved.</Text>
            {desktopSignOutError ? <Text accessibilityRole="alert" style={[s.small, { color: "#a43d35" }]}>{desktopSignOutError}</Text> : null}
            <View style={{ flexDirection: "row", gap: 9, marginTop: 3 }}>
              <Button grow secondary title="Cancel" disabled={desktopSignOutBusy} onPress={() => setDesktopSignOutConfirm(false)} />
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: desktopSignOutBusy, busy: desktopSignOutBusy }} disabled={desktopSignOutBusy} onPress={() => void confirmDesktopSignOut()} style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#ad403d", opacity: desktopSignOutBusy ? 0.6 : pressed ? 0.84 : 1 }]}><Text style={s.buttonText}>{desktopSignOutBusy ? "Signing out…" : "Sign out"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>}
      <SelectionSheet
        visible={barangaysOpen}
        anchorRef={barangaysAnchorRef}
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
      {!tabletWeb && !desktopWeb && renderNavigation("mobile")}
    </SafeAreaView>
  );
}
function Auth({ initialError, onRecoveryVerified }: { initialError: string; onRecoveryVerified: () => void }) {
  const insets = useSafeAreaInsets();
  const { width: authWidth, height: authHeight } = useWindowDimensions();
  const tabletAuthWeb = Platform.OS === "web" && authWidth >= 768 && authWidth < 1200;
  const wideAuthWeb = Platform.OS === "web" && authWidth >= 1200;
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
  const minimalDesktopLogin = wideAuthWeb && mode === "login";
  const registeredBarangayAnchorRef = useRef<View>(null);
  const minimalDesktopRegister = wideAuthWeb && mode === "register";
  const [messageIsError, setMessageIsError] = useState(!!initialError);
  const [termsOpen, setTermsOpen] = useState(false),
    [termsReachedEnd, setTermsReachedEnd] = useState(false),
    [termsRead, setTermsRead] = useState(false),
    [termsAccepted, setTermsAccepted] = useState(false);
  useEffect(() => {
    if ((mode !== "verify" && mode !== "recovery-code") || resendSeconds <= 0) return;
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
  async function sendRecoveryCode() {
    if (busy || !db) return;
    const problem = emailInputError(email);
    if (problem) { setMessage(problem); setMessageIsError(true); return; }
    setBusy(true); setMessage(""); setMessageIsError(false);
    try {
      const { error } = await db.auth.resetPasswordForEmail(email.trim().toLowerCase());
      if (error) throw error;
      setMode("recovery-code");
      setOtp("");
      setResendSeconds(EMAIL_RESEND_INTERVAL_SECONDS);
      setMessage(`If an account exists for this email, a ${EMAIL_OTP_LENGTH}-digit recovery code was sent. It expires in ${EMAIL_OTP_EXPIRY_SECONDS / 60} minutes.`);
    } catch (error) { setAuthFailure(error, "recovery"); }
    finally { setBusy(false); }
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
    <View style={{ flex: 1, backgroundColor: "white" }}>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: minimalDesktopLogin ? "white" : colors.brandDark }} />
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: "transparent" }}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, backgroundColor: minimalDesktopLogin ? "white" : colors.paper }}
        >
        <ScrollView
          style={{ flex: 1, backgroundColor: minimalDesktopLogin ? "white" : colors.paper }}
          contentContainerStyle={[
            s.authScroll,
            tabletAuthWeb && { maxWidth: 760, paddingHorizontal: 24, paddingVertical: 24 },
            wideAuthWeb && { maxWidth: minimalDesktopLogin ? 1520 : 1360, width: "100%", minHeight: Math.max(0, authHeight - 32), flexDirection: "row", alignItems: minimalDesktopLogin ? "stretch" : "flex-start", justifyContent: "center", gap: minimalDesktopLogin ? 0 : 24, paddingHorizontal: minimalDesktopLogin ? 32 : 24, paddingVertical: minimalDesktopLogin ? 0 : 36, paddingBottom: minimalDesktopLogin ? 0 : 36, backgroundColor: minimalDesktopLogin ? "white" : "transparent" },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={[s.authHero, wideAuthWeb && { width: "48%", maxWidth: 600, minWidth: 420, height: 600, flexShrink: 0, alignSelf: "flex-start", justifyContent: "space-between", padding: 40, paddingTop: 40, gap: 20, borderRadius: 28, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }, minimalDesktopLogin && { width: "56%", maxWidth: 840, minWidth: 420, height: "auto", flexShrink: 1, alignSelf: "stretch", justifyContent: "center", padding: 56, gap: 44, borderRadius: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 1, borderRightColor: "#e4ece9", backgroundColor: "white", overflow: "visible" }, minimalDesktopRegister && { display: "none" }]}>
            <View style={s.authBrand}>
              <Image source={require("../assets/iligan-connect-logo.png")} accessibilityLabel="Iligan Connect logo" resizeMode="contain" style={{ width: minimalDesktopLogin ? 62 : wideAuthWeb ? 54 : 48, height: minimalDesktopLogin ? 62 : wideAuthWeb ? 54 : 48 }} />
              <View>
                <Text style={[s.authBrandName, minimalDesktopLogin && { color: colors.brandDark }]}>ILIGAN CONNECT</Text>
                <Text style={[s.authBrandPlace, minimalDesktopLogin && { color: colors.muted }]}>Community reporting · Iligan City</Text>
              </View>
            </View>
            <View style={[s.authCopy, wideAuthWeb && { maxWidth: 520, gap: 14 }, minimalDesktopLogin && { maxWidth: 560, gap: 13 }]}>
              <Text accessibilityRole="header" style={[s.authTitle, wideAuthWeb && { fontSize: 42, lineHeight: 50, letterSpacing: -1.2 }, minimalDesktopLogin && { fontSize: 48, lineHeight: 56, letterSpacing: -1.5, color: colors.brandDark }]}>
                Make your neighborhood count.
              </Text>
              <Text style={[s.authSubtitle, wideAuthWeb && { maxWidth: 460, fontSize: 16, lineHeight: 25, color: colors.muted }, minimalDesktopLogin && { maxWidth: 480, fontSize: 17, lineHeight: 27 }]}>
                Iligan City listens. Share a local concern, follow what happens next, and join the conversation.
              </Text>
            </View>
            {wideAuthWeb && !minimalDesktopLogin && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {["Report local concerns", "Track updates", "Connect with your barangay"].map((item) => <View key={item} style={{ paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1, borderColor: "#ffffff30", borderRadius: 20, backgroundColor: "#ffffff12" }}>
                <Text style={{ color: "#e1f1ed", fontSize: 11, fontWeight: "600" }}>{item}</Text>
              </View>)}
            </View>}
            {wideAuthWeb && !minimalDesktopLogin && <View style={{ width: "100%", height: 210, overflow: "hidden", borderWidth: 1, borderColor: "#ffffff40", borderRadius: 18 }}>
              <Image source={require("../assets/iligan-home-header.jpg")} accessibilityLabel="Iligan City Hall" resizeMode="cover" style={{ width: "100%", height: "100%" }} />
            </View>}
          </View>
          <View style={[s.authPanel, wideAuthWeb && mode !== "register" && { flex: 1, minWidth: 420, maxWidth: 520, alignSelf: "flex-start", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", paddingHorizontal: 0, paddingVertical: 0 }, minimalDesktopLogin && { minWidth: 420, maxWidth: 600, alignSelf: "stretch", justifyContent: "center", paddingHorizontal: 48 }, minimalDesktopRegister && { flexGrow: 0, flexShrink: 0, width: 640, minWidth: 0, maxWidth: 640, alignItems: "stretch", justifyContent: "flex-start" }]}>
            <View style={[s.card, s.authCard, wideAuthWeb && { maxWidth: mode === "register" ? 640 : 520, padding: 32, gap: 18, borderRadius: 24 }, minimalDesktopLogin && { maxWidth: 500, padding: 0, gap: 20, borderWidth: 0, borderColor: "transparent", borderRadius: 0, backgroundColor: "transparent", shadowOpacity: 0, shadowRadius: 0, elevation: 0 }]}>
              <View style={s.authCardHeading}>
                <Text accessibilityRole="header" style={[s.authTitleText, wideAuthWeb && { fontSize: 26, letterSpacing: -0.45 }]}>
                  {mode === "register" || mode === "verify"
                    ? "Join your community"
                    : mode === "reset"
                      ? "Recover your account"
                      : mode === "recovery-code"
                        ? "Enter recovery code"
                      : "Welcome back"}
                </Text>
                <Text style={s.small}>
                  {mode === "register"
                    ? "Create an account to report and follow local issues."
                    : mode === "verify"
                      ? "Enter the one-time code sent to your email to activate your account."
                    : mode === "reset"
                      ? "We’ll send a recovery code to your email."
                    : mode === "recovery-code"
                      ? "Verify the code from your email to continue and choose a new password."
                      : "Sign in to see your reports and community updates."}
                </Text>
              </View>
            {configured ? mode === "verify" || mode === "recovery-code" ? (
              <>
                <Text style={s.body}>{mode === "verify" ? <>Check <Text style={{ fontWeight: "700" }}>{email.trim().toLowerCase()}</Text> for your verification code. If the email contains a confirmation link, opening it will verify your account too.</> : <>Check <Text style={{ fontWeight: "700" }}>{email.trim().toLowerCase()}</Text> for your password reset code. Enter it here to continue resetting your password.</>}</Text>
                <Field
                  label={`${EMAIL_OTP_LENGTH}-digit ${mode === "verify" ? "email" : "recovery"} code`} required hint={`Enter the code from your email. It expires after ${EMAIL_OTP_EXPIRY_SECONDS / 60} minutes.`}
                  value={otp}
                  onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH))}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={EMAIL_OTP_LENGTH}
                />
                <Button title={busy ? "Verifying…" : mode === "verify" ? "Verify email" : "Verify recovery code"} disabled={busy || otp.length !== EMAIL_OTP_LENGTH} loading={busy} onPress={async () => {
                  if (!new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`).test(otp)) { setMessage(`Enter the ${EMAIL_OTP_LENGTH}-digit code from your email.`); setMessageIsError(true); return; }
                  setBusy(true); setMessage(""); setMessageIsError(false);
                  try {
                    const recovering = mode === "recovery-code";
                    const { error } = await db!.auth.verifyOtp({ email: email.trim().toLowerCase(), token: otp, type: recovering ? "recovery" : "signup" });
                    if (error) throw error;
                    setOtp("");
                    if (recovering) onRecoveryVerified();
                  } catch (error) { setAuthFailure(error, "verification"); }
                  finally { setBusy(false); }
                }} />
                <Pressable accessibilityRole="button" disabled={busy || resendSeconds > 0} style={s.textAction} onPress={() => void (mode === "verify" ? resendSignupCode() : sendRecoveryCode())}>
                  <Text style={[s.textActionLabel, (busy || resendSeconds > 0) && { opacity: 0.55 }]}>{resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : mode === "verify" ? "Resend verification code" : "Resend recovery code"}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} style={s.textAction} onPress={() => changeMode(mode === "verify" ? "register" : "reset")}>
                  <Text style={s.textActionLabel}>{mode === "verify" ? "Change email or account details" : "Use a different email"}</Text>
                </Pressable>
              </>
            ) : (
              <>
                {mode === "register" && (
                  <View style={[{ gap: 11 }, wideAuthWeb && { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 14 }]}>
                    <Text style={[s.eyebrow, wideAuthWeb && { width: "100%" }]}>PERSONAL DETAILS</Text>
                    <View style={wideAuthWeb ? { width: "47%" } : undefined}><Field
                      label="First name" required minLength={1} validationKind="name" hint="Use your name as it appears on your records."
                      placeholder="First name"
                      value={firstName}
                      onChangeText={setFirstName}
                      maxLength={60}
                      autoCapitalize="words"
                      autoComplete="given-name"
                    /></View>
                    <View style={wideAuthWeb ? { width: "47%" } : undefined}><Field
                      label="Last name" required minLength={1} validationKind="name"
                      error={fullName.length > 100 ? "Use no more than 100 characters across all name fields." : undefined}
                      placeholder="Last name"
                      value={lastName}
                      onChangeText={setLastName}
                      maxLength={60}
                      autoCapitalize="words"
                      autoComplete="family-name"
                    /></View>
                    <View style={wideAuthWeb ? { width: "47%" } : undefined}><Field
                      label="Middle name (optional)" validationKind="name" hint="Leave blank if you do not use a middle name."
                      placeholder="Middle name"
                      value={middleName}
                      onChangeText={setMiddleName}
                      maxLength={60}
                      autoCapitalize="words"
                      autoComplete="additional-name"
                    /></View>
                    <View style={wideAuthWeb ? { width: "47%" } : undefined}><Field
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
                    /></View>
                    <View style={wideAuthWeb ? { width: "47%" } : undefined}><Field
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
                    /></View>
                    <View style={[{ gap: 7 }, wideAuthWeb && { width: "47%" }]}>
                      <Text style={s.fieldLabel}>Registered barangay <Text style={{ color: "#a43d35" }}>*</Text></Text>
                      <Pressable
                        ref={registeredBarangayAnchorRef}
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
                    <Text style={[s.eyebrow, wideAuthWeb && { width: "100%" }]}>ACCOUNT DETAILS</Text>
                  </View>
                )}
                <View style={[{ gap: 18 }, wideAuthWeb && mode === "register" && { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }]}>
                <View style={wideAuthWeb && mode === "register" ? { width: "100%" } : undefined}><Field maxLength={254}
                  label="Email address" required validationKind="email" hint="Enter the address you used to register."
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                /></View>
                {mode !== "reset" && (
                  <View style={wideAuthWeb && mode === "register" ? { width: "47%" } : undefined}><Field maxLength={1024}
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
                  /></View>
                )}
                {mode === "register" && <View style={wideAuthWeb ? { width: "47%" } : undefined}><Field
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
                /></View>}
                </View>
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
                          ? "Send recovery code"
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
                    if (mode === "reset") { await sendRecoveryCode(); return; }
                    const problem = emailInputError(email) || (mode === "register" ? namePartsProblem || ageProblem || mobileInputError(mobile) || (password !== confirmPassword ? "Passwords do not match." : "") || (!registeredBarangay || !signupBarangays.data?.some((item) => item.id === registeredBarangay) ? "Choose your registered barangay before creating an account." : "") || (!termsRead || !termsAccepted ? "Read and agree to the Terms and Conditions before creating an account." : "") : "") || passwordInputError(password, mode === "register" ? MIN_PASSWORD_LENGTH : 1);
                    if (problem) { setMessage(problem); setMessageIsError(true); return; }
                    setBusy(true);
                    setMessage("");
                    setMessageIsError(false);
                    try {
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
                {minimalDesktopLogin && <Pressable accessibilityRole="button" style={s.textAction} onPress={() => changeMode("reset")}>
                  <Text style={s.small}>Forgot password?</Text>
                </Pressable>}
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  style={({ pressed }) => [minimalDesktopLogin ? { minHeight: 52, width: "100%", alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 26, borderWidth: 1, borderColor: colors.brand, backgroundColor: "white", opacity: busy ? 0.55 : pressed ? 0.78 : 1 } : s.textAction]}
                  onPress={() => changeMode(mode === "login" ? "register" : "login")}
                >
                  <Text style={[s.textActionLabel, minimalDesktopLogin && { color: colors.brand, fontSize: 15 }]}>
                    {mode === "login" ? "New here? Create an account" : mode === "register" ? "Already have an account? Sign in" : "Back to sign in"}
                  </Text>
                </Pressable>
                {mode === "login" && !minimalDesktopLogin && (
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
            anchorRef={registeredBarangayAnchorRef}
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
    </View>
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
  onPageNavigate,
  onNavigate,
}: {
  profile: Profile;
  barangays: Lookup[];
  onPageNavigate: () => void;
  onNavigate: (destination: "Home" | "Community", communityTab?: "consultations" | "meetings", homePage?: "reports") => void;
}) {
  const [profilePage, setProfilePage] = useState<"profile" | "settings" | "help">("profile"),
    [firstName, setFirstName] = useState(p.first_name || ""),
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
    [signOutBusy, setSignOutBusy] = useState(false),
    [currentEmailInput, setCurrentEmailInput] = useState(""),
    [newEmailInput, setNewEmailInput] = useState(""),
    [emailCode, setEmailCode] = useState(""),
    [verifiedCurrentEmail, setVerifiedCurrentEmail] = useState(""),
    [pendingEmail, setPendingEmail] = useState(""),
    [emailStage, setEmailStage] = useState<"idle" | "verify-current" | "new" | "verify-new" | "verify-current-change">("idle"),
    [emailBusy, setEmailBusy] = useState(false),
    [emailResendSeconds, setEmailResendSeconds] = useState(0);
  const qc = useQueryClient();
  const writeLock = useRef(false);
  const photoLock = useRef(false);
  const { width: screenWidth } = useWindowDimensions();
  const desktopProfile = Platform.OS === "web" && screenWidth >= 1200;
  const contentWidth = Math.min(screenWidth, desktopProfile ? 1360 : 620) - (desktopProfile ? 80 : 36);
  const compactProfile = contentWidth < 320;
  const wideProfile = contentWidth >= 500;
  const avatarSize = wideProfile ? 108 : compactProfile ? 82 : 96;
  useEffect(() => {
    if (emailResendSeconds <= 0) return;
    const timer = setTimeout(() => setEmailResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [emailResendSeconds]);
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

  function clearEmailChange() {
    setCurrentEmailInput("");
    setNewEmailInput("");
    setEmailCode("");
    setVerifiedCurrentEmail("");
    setPendingEmail("");
    setEmailStage("idle");
    setEmailResendSeconds(0);
  }

  function toggleProfileEditing() {
    setMessage("");
    if (!editing) {
      setFirstName(p.first_name || "");
      setMiddleName(p.middle_name || "");
      setLastName(p.last_name || "");
      setAge(p.age == null ? "" : String(p.age));
      setPhone(p.phone || "");
      setBarangay(p.barangay_id || "");
      setEditing(true);
      return;
    }
    setFirstName(p.first_name || "");
    setMiddleName(p.middle_name || "");
    setLastName(p.last_name || "");
    setAge(p.age == null ? "" : String(p.age));
    setPhone(p.phone || "");
    setBarangay(p.barangay_id || "");
    setEditing(false);
    if (emailStage === "verify-new" || emailStage === "verify-current-change") {
      setEmailCode("");
      setMessage("Profile editing canceled. Your email change is still waiting for verification.");
    } else {
      clearEmailChange();
    }
  }

  async function sendCurrentEmailCode() {
    if (emailBusy || emailResendSeconds > 0) return;
    const enteredEmail = currentEmailInput.trim().toLowerCase();
    if (emailInputError(enteredEmail)) { setMessage(emailInputError(enteredEmail)); return; }
    setEmailBusy(true);
    setMessage("");
    try {
      const { data, error } = await db!.auth.getUser();
      if (error) throw error;
      if (data.user?.id !== p.id || !data.user.email) throw new Error("Your session changed. Sign in again to update your email.");
      const accountEmail = data.user.email.trim().toLowerCase();
      if (enteredEmail !== accountEmail) throw new Error("Enter the current email address on your account to continue.");
      const { error: sendError } = await db!.auth.signInWithOtp({ email: data.user.email, options: { shouldCreateUser: false } });
      if (sendError) throw sendError;
      setVerifiedCurrentEmail(data.user.email);
      setEmailCode("");
      setEmailStage("verify-current");
      setEmailResendSeconds(EMAIL_RESEND_INTERVAL_SECONDS);
      setMessage("Verification code sent to your current email.");
    } catch (error) {
      setMessage((error as Error).message || "Could not send the verification code. Please try again.");
    } finally { setEmailBusy(false); }
  }

  async function requestEmailChange() {
    if (emailBusy || emailResendSeconds > 0) return;
    const nextEmail = newEmailInput.trim().toLowerCase();
    const problem = emailInputError(nextEmail);
    if (problem) { setMessage(problem); return; }
    if (nextEmail === verifiedCurrentEmail.trim().toLowerCase()) { setMessage("Choose an email address different from your current one."); return; }
    setEmailBusy(true);
    setMessage("");
    try {
      const { data, error } = await db!.auth.getUser();
      if (error) throw error;
      if (data.user?.id !== p.id || data.user.email?.trim().toLowerCase() !== verifiedCurrentEmail.trim().toLowerCase()) {
        throw new Error("Your current email changed. Start the verification again.");
      }
      const { error: updateError } = await db!.auth.updateUser({ email: nextEmail });
      if (updateError) throw updateError;
      setPendingEmail(nextEmail);
      setEmailCode("");
      setEmailStage("verify-new");
      setEmailResendSeconds(EMAIL_RESEND_INTERVAL_SECONDS);
      setMessage("Confirmation codes sent. Confirm the new address and, if prompted, the code sent to your current email.");
    } catch (error) {
      setMessage((error as Error).message || "Could not start the email change. Please try again.");
    } finally { setEmailBusy(false); }
  }

  async function resendEmailCode() {
    if (emailBusy || emailResendSeconds > 0) return;
    if (emailStage === "verify-current") return void sendCurrentEmailCode();
    setEmailBusy(true);
    setMessage("");
    try {
      const { error } = await db!.auth.resend({ type: "email_change", email: verifiedCurrentEmail });
      if (error) throw error;
      setEmailResendSeconds(EMAIL_RESEND_INTERVAL_SECONDS);
      setEmailCode("");
      setMessage("A new email-change code was sent.");
    } catch (error) {
      setMessage((error as Error).message || "Could not resend the code. Please try again shortly.");
    } finally { setEmailBusy(false); }
  }

  async function verifyEmailCode() {
    if (emailBusy) return;
    if (!new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`).test(emailCode)) { setMessage(`Enter the ${EMAIL_OTP_LENGTH}-digit code from your email.`); return; }
    const verifyingCurrentAddress = emailStage === "verify-current";
    const email = emailStage === "verify-new" ? pendingEmail : verifiedCurrentEmail;
    setEmailBusy(true);
    setMessage("");
    try {
      const { data, error } = await db!.auth.verifyOtp({ email, token: emailCode, type: verifyingCurrentAddress ? "email" : "email_change" });
      if (error) throw error;
      let verifiedUser = data.user;
      if (!verifiedUser) {
        const { data: current, error: currentError } = await db!.auth.getUser();
        if (currentError) throw currentError;
        verifiedUser = current.user;
      }
      if (verifiedUser?.id !== p.id) {
        await db!.auth.signOut();
        await qc.invalidateQueries({ queryKey: ["profile-auth", p.id] });
        throw new Error("This code belongs to another account. Sign in to the correct account and try again.");
      }
      setEmailCode("");
      setEmailResendSeconds(0);
      if (verifyingCurrentAddress) {
        setEmailStage("new");
        setMessage("Current email verified. Enter the new email address below.");
        return;
      }
      const { data: latest, error: latestError } = await db!.auth.getUser();
      if (latestError) throw latestError;
      if (latest.user?.id !== p.id) throw new Error("Your session changed. Sign in again to finish the email change.");
      if (latest.user.email?.trim().toLowerCase() === pendingEmail.trim().toLowerCase()) {
        clearEmailChange();
        await qc.invalidateQueries({ queryKey: ["profile-auth", p.id] });
        setMessage("Email address updated.");
      } else if (emailStage === "verify-new") {
        setEmailStage("verify-current-change");
        setMessage("New email confirmed. Enter the code sent to your current email to finish the secure change.");
      } else {
        throw new Error("The email change is not complete yet. Check both inboxes for the remaining confirmation code.");
      }
    } catch (error) {
      setMessage((error as Error).message || "Could not verify that code. Check it and try again.");
    } finally { setEmailBusy(false); }
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
      await signOutResident(p.id);
      setSignOutConfirm(false);
    } catch (error) {
      setSignOutConfirm(false);
      setMessage((error as Error).message || "Could not sign out. Please try again.");
    } finally { setSignOutBusy(false); }
  }

  const activityCards = [
    { key: "reports", title: "Reports submitted", chartLabel: "Reports", count: totals?.reports_submitted, icon: "document-text-outline" as const, tone: { background: "#e4f3ff", foreground: "#0875d1" }, action: () => onNavigate("Home", undefined, "reports") },
    { key: "discussions", title: "My discussions", chartLabel: "Discussions", count: totals?.discussions, icon: "chatbubble-ellipses-outline" as const, tone: { background: "#edf0ff", foreground: "#435fce" }, action: () => onNavigate("Community", "consultations") },
    { key: "meetings", title: "Meeting requests", chartLabel: "Meetings", count: totals?.meeting_requests, icon: "calendar-outline" as const, tone: { background: "#e5f6f2", foreground: colors.brand }, action: () => onNavigate("Community", "meetings") },
  ];
  const activityChartItems = activityCards.map((item) => ({ ...item, value: item.count ?? 0 }));
  const largestActivity = Math.max(0, ...activityChartItems.map((item) => item.value));
  const leadingActivity = activityChartItems.filter((item) => item.value === largestActivity && largestActivity > 0);
  const activityInsight = leadingActivity.length === 1
    ? `Most activity: ${leadingActivity[0].chartLabel}`
    : leadingActivity.length > 1 ? `Top activity: ${leadingActivity.map((item) => item.chartLabel).join(" and ")}` : "No activity recorded yet";
  const privacyItems = [
    { key: "profile", title: "Profile visibility", icon: "person-circle-outline" as const, body: "Your name, age, mobile number, email, and home barangay are account details visible to you and authorized administrators. Public report views use the report’s approved public information, not your private contact details." },
    { key: "location", title: "Report location privacy", icon: "location-outline" as const, body: "The city receives the precise location you confirm to assess the issue. Public map views use an approximate location." },
    { key: "photos", title: "Photo privacy", icon: "image-outline" as const, body: "Your profile picture is private to your account and is not shown on public reports. Report photos are shared with authorized reviewers under the report’s visibility settings." },
    { key: "data", title: "Account data", icon: "document-text-outline" as const, body: "Your profile, reports, community activity, and meeting requests remain linked to your account so you can track them. Historical report locations are not changed when you update your home barangay." },
  ];
  const helpItems = [
    { key: "report", title: "Report a community issue", bisayaTitle: "Pagreport og problema sa komunidad", icon: "add-circle-outline" as const, english: ["Tap Report in the bottom menu.", "Choose the issue type, then enter a short title and a clear description. Add a photo if it helps and it is safe to take one.", "Use your current location or tap the map where the issue is. Check that the pin and barangay are correct.", "Review the details and tap Submit report. Keep the report number so you can find it again."], bisaya: ["Pindota ang Report sa ubos nga menu.", "Pilia ang klase sa problema, dayon butangi og mubo nga ulohan ug klaro nga detalye. Pagdugang og litrato kung makatabang ug luwas kini kuhaan.", "Gamita ang imong kasamtangang lokasyon o pindota ang mapa sa eksaktong lugar. Siguroa nga sakto ang pin ug barangay.", "Susiha ang mga detalye ug pindota ang Submit report. I-save ang report number aron dali nimo kining makita pag-usab."] },
    { key: "tracking", title: "Follow updates on a report", bisayaTitle: "Pagsubay sa update sa report", icon: "time-outline" as const, english: ["Open Home and find Your reports, or open a report from Explore.", "Tap a report to see its current status and updates recorded by the barangay or responsible office.", "If Follow is available, tap it to keep the report easy to find and receive updates in the app when notifications are on."], bisaya: ["Ablihi ang Home ug pangitaa ang Your reports, o ablihi ang report gikan sa Explore.", "Pindota ang report aron makita ang kahimtang niini ug ang mga update gikan sa barangay o opisina nga nag-atiman.", "Kung naa ang Follow, pindota kini aron dali nimo masubay ang report ug makadawat ka og update sa app kung naka-on ang notifications."] },
    { key: "community", title: "Join a discussion or request a meeting", bisayaTitle: "Apil sa panaghisgot o hangyo og meeting", icon: "chatbubbles-outline" as const, english: ["Open Community from the bottom menu.", "Choose a discussion or consultation to read and join. Keep comments respectful and do not post passwords, private addresses, or other sensitive details.", "To ask for an in-person conversation, open Meeting requests and submit what you want to discuss. The barangay will review the request and send meeting details when arranged."], bisaya: ["Ablihi ang Community sa ubos nga menu.", "Pilia ang panaghisgot o consultation nga gusto nimong basahon ug apilan. Magtinahuray sa comments ug ayaw pagbutang og password, pribadong adres, o sensitibong detalye.", "Kung gusto kag personal nga panagkita, ablihi ang Meeting requests ug isulat ang gusto nimong hisgotan. Susihon kini sa barangay ug ipadala ang detalye kung ma-arrange na ang meeting."] },
    { key: "announcements", title: "Read city and barangay announcements", bisayaTitle: "Pagbasa sa mga pahibalo sa siyudad ug barangay", icon: "megaphone-outline" as const, english: ["Open Announcements from Home or the Community area.", "Choose an announcement to read its details, date, and any attached image.", "Check back for schedule changes or new official information."], bisaya: ["Ablihi ang Announcements gikan sa Home o Community.", "Pilia ang pahibalo aron mabasa ang detalye, petsa, ug litrato kung naa.", "Balik-balik og tan-aw kung adunay kausaban sa iskedyul o bag-ong opisyal nga impormasyon."] },
  ];
  const emailChangeSubtitle = emailStage === "verify-current" ? `Enter the code sent to ${verifiedCurrentEmail}.`
    : emailStage === "new" ? "Your current email is verified. Enter the new address to continue."
    : emailStage === "verify-new" ? `Enter the code sent to ${pendingEmail}.`
    : emailStage === "verify-current-change" ? "Confirm the code sent to your current email to finish."
    : "Verify your current email before requesting a change.";
  const emailChangeSection = <View style={{ gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: "#e5f5f1", alignItems: "center", justifyContent: "center" }}><Ionicons name="mail-outline" size={18} color={colors.brand} /></View><View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={s.fieldLabel}>Change email address</Text><Text style={s.small}>{emailChangeSubtitle}</Text></View></View>
    {emailStage === "idle" && <>
      <Field label="Current email" required validationKind="email" placeholder="Enter your current email" value={currentEmailInput} onChangeText={setCurrentEmailInput} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={254} />
      <Button icon="mail-outline" loading={emailBusy} disabled={!!emailInputError(currentEmailInput)} title="Send code to current email" onPress={() => void sendCurrentEmailCode()} />
    </>}
    {emailStage === "verify-current" && <>
      <Text style={s.body}>Enter the {EMAIL_OTP_LENGTH}-digit code sent to {verifiedCurrentEmail}.</Text>
      <Field label="Verification code" required placeholder={`${EMAIL_OTP_LENGTH}-digit code`} value={emailCode} onChangeText={(value) => setEmailCode(value.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH))} keyboardType="number-pad" autoComplete="one-time-code" maxLength={EMAIL_OTP_LENGTH} />
      <Button icon="checkmark-circle-outline" loading={emailBusy} disabled={emailCode.length !== EMAIL_OTP_LENGTH} title="Verify current email" onPress={() => void verifyEmailCode()} />
      <Button secondary loading={emailBusy} disabled={emailResendSeconds > 0} title={emailResendSeconds > 0 ? `Resend code in ${emailResendSeconds}s` : "Send another code"} onPress={() => void resendEmailCode()} />
    </>}
    {emailStage === "new" && <>
      <Text style={s.body}>Current email verified: {verifiedCurrentEmail}</Text>
      <Field label="New email" required validationKind="email" placeholder="Enter your new email" value={newEmailInput} onChangeText={setNewEmailInput} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={254} />
      <Button icon="send-outline" loading={emailBusy} disabled={!!emailInputError(newEmailInput) || newEmailInput.trim().toLowerCase() === verifiedCurrentEmail.trim().toLowerCase()} title="Send confirmation code" onPress={() => void requestEmailChange()} />
    </>}
    {(emailStage === "verify-new" || emailStage === "verify-current-change") && <>
      <View style={{ padding: 10, borderRadius: 13, backgroundColor: "#eff8f6", flexDirection: "row", gap: 8, alignItems: "flex-start" }}><Ionicons name="information-circle-outline" size={18} color={colors.brand} /><Text style={[s.small, { flex: 1 }]}>{emailStage === "verify-new" ? <>Enter the code sent to <Text style={{ fontWeight: "700" }}>{pendingEmail}</Text>. If secure email change is enabled, a second code is also required from your current email.</> : <>The new email is confirmed. Enter the remaining code sent to <Text style={{ fontWeight: "700" }}>{verifiedCurrentEmail}</Text>.</>}</Text></View>
      <Field label={emailStage === "verify-new" ? "New email verification code" : "Current email confirmation code"} required placeholder={`${EMAIL_OTP_LENGTH}-digit code`} value={emailCode} onChangeText={(value) => setEmailCode(value.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH))} keyboardType="number-pad" autoComplete="one-time-code" maxLength={EMAIL_OTP_LENGTH} />
      <Button icon="checkmark-circle-outline" loading={emailBusy} disabled={emailCode.length !== EMAIL_OTP_LENGTH} title={emailStage === "verify-new" ? "Verify new email" : "Finish email change"} onPress={() => void verifyEmailCode()} />
      <Button secondary loading={emailBusy} disabled={emailResendSeconds > 0} title={emailResendSeconds > 0 ? `Resend code in ${emailResendSeconds}s` : "Send confirmation codes again"} onPress={() => void resendEmailCode()} />
    </>}
  </View>;
  return (
    <>
      {desktopProfile && <View style={{ flexDirection: "row", gap: 18, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#dfe9e7" }}>
        {([
          ["profile", "Profile details", "person-circle-outline"],
          ["settings", "Settings", "settings-outline"],
          ["help", "Help center", "help-circle-outline"],
        ] as const).map(([page, title, icon]) => {
          const active = profilePage === page;
          return <Pressable key={page} accessibilityRole="tab" accessibilityLabel={title} accessibilityState={{ selected: active }} onPress={() => { if (active) return; onPageNavigate(); setMessage(""); setProfilePage(page); }} style={({ pressed }) => [{ minWidth: 145, minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 10, borderBottomWidth: active ? 2 : 0, borderBottomColor: colors.brand, opacity: pressed ? 0.78 : 1 }]}>
            <Ionicons name={icon} size={17} color={active ? colors.brand : colors.muted} />
            <Text style={{ color: active ? colors.brand : colors.muted, fontSize: 12, lineHeight: 16, fontWeight: active ? "800" : "600" }}>{title}</Text>
          </Pressable>;
        })}
      </View>}
      {profilePage === "profile" && <>
        <View style={{ overflow: "hidden", borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, shadowColor: colors.brandDark, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 }}>
          <View style={{ height: wideProfile ? 150 : compactProfile ? 112 : 130, overflow: "hidden", backgroundColor: colors.brandDark }}>
            <Image source={require("../assets/iligan-community-profile-header.jpg")} accessible={false} resizeMode="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
            <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#063d4375" }} />
            <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 2 }}><Text style={{ color: "#c7f4e9", fontSize: 9, fontWeight: "800", letterSpacing: 1.4 }}>ILIGAN CONNECT</Text><Text style={{ color: "white", fontSize: 13, fontWeight: "700" }}>Resident profile</Text></View>
          </View>
          <View style={{ paddingHorizontal: compactProfile ? 12 : 16, paddingBottom: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: compactProfile ? 10 : 14, marginTop: -Math.min(avatarSize * 0.34, 36) }}>
              <View style={{ position: "relative", flexShrink: 0 }}>
                <Pressable accessibilityRole="button" accessibilityLabel={p.avatar_path ? "Change profile photo" : "Add profile photo"} disabled={photoBusy} onPress={() => setPhotoMenu(true)} style={({ pressed }) => [{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, borderWidth: 4, borderColor: colors.paper, backgroundColor: "#e2f4ee", alignItems: "center", justifyContent: "center", overflow: "hidden", shadowColor: colors.brandDark, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }, pressed && { opacity: 0.82 }]}>
                  {avatar.data ? <Image source={{ uri: avatar.data }} accessibilityLabel="Your profile photo" resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : <Text accessibilityLabel={`Avatar initials ${initials}`} style={{ color: colors.brand, fontSize: compactProfile ? 25 : 30, fontWeight: "800" }}>{initials}</Text>}
                  {photoBusy && <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#071b2770" }}><Ionicons name="hourglass-outline" size={20} color="white" /></View>}
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={p.avatar_path ? "Edit profile photo" : "Add profile photo"} disabled={photoBusy} onPress={() => setPhotoMenu(true)} style={({ pressed }) => [{ position: "absolute", right: 0, bottom: 1, width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: colors.paper, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", opacity: photoBusy ? 0.6 : pressed ? 0.75 : 1 }]}><Ionicons name="camera-outline" size={17} color="white" /></Pressable>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 6, paddingTop: Math.min(avatarSize * 0.34, 36) }}>
                <Text accessibilityRole="header" adjustsFontSizeToFit numberOfLines={2} style={{ color: colors.brandDark, fontSize: compactProfile ? 19 : wideProfile ? 25 : 22, lineHeight: compactProfile ? 23 : 28, fontWeight: "800", letterSpacing: -0.4 }}>{p.display_name.trim() || "Resident"}</Text>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5 }}><Ionicons name="location-outline" size={15} color={colors.brand} style={{ marginTop: 1 }} /><Text numberOfLines={2} style={[s.small, { flex: 1, minWidth: 0, fontSize: 11 }]}>{homeBarangay} · Iligan City</Text></View>
                <View style={{ alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, backgroundColor: "#e8f5f1" }}><Text style={{ color: colors.brand, fontSize: 10, fontWeight: "800" }}>{label(p.role)}</Text></View>
              </View>
            </View>
            <View style={{ marginTop: 14 }}><Button icon={editing ? "close-outline" : "create-outline"} secondary={editing} disabled={busy || emailBusy} title={editing ? "Cancel editing" : "Edit profile"} onPress={toggleProfileEditing} /></View>
          </View>
        </View>
      </>}

      {profilePage !== "profile" && <>
        {!desktopProfile && <AppBackNavigation label="Back to profile" onBack={() => { onPageNavigate(); setProfilePage("profile"); }} />}
        <View style={{ gap: 4, paddingHorizontal: 2 }}>
          <Text accessibilityRole="header" style={s.heading}>{profilePage === "settings" ? "Settings" : "Help & support"}</Text>
          <Text style={s.subtitle}>{profilePage === "settings" ? "Choose how your account and updates work." : "Simple answers in English and Binisaya."}</Text>
        </View>
      </>}

      {message && <View accessibilityRole="alert" style={{ flexDirection: "row", gap: 7, alignItems: "flex-start", padding: 10, borderRadius: 13, backgroundColor: /updated|removed|up to date|are on|are off|allowed|verified|code.*sent|codes sent|confirmed|editing canceled|still waiting/i.test(message) ? "#eff9f5" : "#fff2f0" }}><Ionicons name={/updated|removed|up to date|are on|are off|allowed|verified|code.*sent|codes sent|confirmed|editing canceled|still waiting/i.test(message) ? "checkmark-circle-outline" : "alert-circle-outline"} size={18} color={/updated|removed|up to date|are on|are off|allowed|verified|code.*sent|codes sent|confirmed|editing canceled|still waiting/i.test(message) ? colors.brand : "#a43d35"} /><Text style={{ flex: 1, color: /updated|removed|up to date|are on|are off|allowed|verified|code.*sent|codes sent|confirmed|editing canceled|still waiting/i.test(message) ? colors.brand : "#a43d35", fontSize: 12, lineHeight: 17 }}>{message}</Text></View>}

      {profilePage === "profile" && <View style={desktopProfile ? { flexDirection: "row", alignItems: "flex-start", gap: 24 } : { gap: 18 }}>
      <View style={desktopProfile ? { flex: 1.05, minWidth: 0, gap: 18 } : { gap: 18 }}>
      <View style={{ gap: 8 }}>
        <View style={{ minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="person-circle-outline" size={21} color={colors.brand} /><Text style={[s.title, { flex: 1, marginBottom: 0 }]}>Personal details</Text></View>
        <View style={[s.card, { padding: 12, gap: 0, borderRadius: 18 }]}>
          {editing ? <>
            <Field label="First name" required minLength={1} validationKind="name" hint="Use the name on your official records." placeholder="First name" value={firstName} onChangeText={setFirstName} maxLength={60} autoCapitalize="words" autoComplete="given-name" leading={<Ionicons name="person-outline" size={19} color={colors.brand} />} />
            <Field label="Middle name (optional)" validationKind="name" hint="Leave blank if you do not use a middle name." placeholder="Middle name" value={middleName} onChangeText={setMiddleName} maxLength={60} autoCapitalize="words" autoComplete="additional-name" leading={<Ionicons name="person-outline" size={19} color={colors.brand} />} />
            <Field label="Last name" required minLength={1} validationKind="name" error={fullNameTooLong ? "Use no more than 100 characters across all name fields." : undefined} placeholder="Last name" value={lastName} onChangeText={setLastName} maxLength={60} autoCapitalize="words" autoComplete="family-name" leading={<Ionicons name="person-outline" size={19} color={colors.brand} />} />
            <Field label="Age" validationKind="age" hint="Leave blank to keep the saved age. Only you and authorized city administrators can view it." placeholder="Age" value={age} onChangeText={(value) => setAge(value.replace(/\D/g, "").slice(0, 3))} error={age ? residentAgeError(age) || undefined : undefined} maxLength={3} keyboardType="number-pad" autoComplete="off" leading={<Ionicons name="calendar-outline" size={19} color={colors.brand} />} />
            <Field label="Mobile number (optional)" validationKind="phone" hint="Philippine mobile number, e.g. 0917 123 4567." placeholder="0917 123 4567" value={phone} onChangeText={setPhone} maxLength={24} keyboardType="phone-pad" autoComplete="tel" error={phone ? mobileInputError(phone) || undefined : undefined} leading={<Ionicons name="call-outline" size={19} color={colors.brand} />} />
            <View style={{ gap: 7, marginTop: 3 }}><Text style={s.fieldLabel}>Your barangay</Text><Choices compact title="Choose a barangay" subtitle="Choose your home barangay for relevant local updates." sheetKind="barangay" items={barangays} value={barangay} onChange={setBarangay} leadingIcon="location-outline" myBarangayId={p.barangay_id || undefined} /></View>
            {emailChangeSection}
            <View style={{ marginTop: 12 }}><Button title="Save changes" loading={busy} disabled={emailBusy || !!namePartsProblem || !!ageProblem || !!mobileInputError(phone)} onPress={() => void saveProfile()} /></View>
          </> : <>
            <ProfileInfoRow icon="person-outline" label="Full name" value={p.display_name.trim() || "Not set"} />
            <ProfileInfoRow icon="calendar-outline" label="Age" value={p.age == null ? "Not provided" : String(p.age)} />
            <ProfileInfoRow icon="call-outline" label="Mobile number" value={p.phone || "Not provided"} />
            <ProfileInfoRow icon="location-outline" label="Your barangay" value={homeBarangay} />
            <ProfileInfoRow icon="mail-outline" label="Email address" value={userEmail} last />
          </>}
        </View>
        {!editing && emailStage !== "idle" && <View style={[s.card, { padding: 12, gap: 0, borderRadius: 18 }]}>{emailChangeSection}</View>}
      </View>
      </View>

      <View style={desktopProfile ? { flex: 0.95, minWidth: 0, gap: 18 } : { gap: 18 }}>
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

      {desktopProfile && <View accessibilityRole="image" accessibilityLabel={`Activity breakdown: ${activityChartItems.map((item) => `${item.title}, ${item.value}`).join(", ")}`} style={[s.card, { padding: 16, gap: 14, borderRadius: 16 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#e5f6f2" }}><Ionicons name="stats-chart-outline" size={18} color={colors.brand} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: colors.brandDark, fontSize: 15, lineHeight: 20, fontWeight: "800" }}>Activity breakdown</Text><Text style={s.small}>Your account activity by type · all time</Text></View>
        </View>
        {activity.isPending ? <View style={{ minHeight: 84, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}><ActivityIndicator size="small" color={colors.brand} /><Text style={s.small}>Loading activity overview…</Text></View>
          : activity.error ? <Text style={[s.small, { minHeight: 48, textAlignVertical: "center" }]}>Activity overview could not load. Use Retry above to try again.</Text>
          : largestActivity === 0 ? <Text style={[s.small, { minHeight: 48, textAlignVertical: "center" }]}>No activity to chart yet. Your reports, discussions, and meeting requests will appear here.</Text>
          : <>
            <View style={{ gap: 13 }}>
              {activityChartItems.map((item) => <View key={item.key} style={{ minHeight: 24, flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text numberOfLines={1} style={{ width: 92, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>{item.chartLabel}</Text>
                <View style={{ flex: 1, height: 10, overflow: "hidden", borderRadius: 8, backgroundColor: "#eef4f2" }}><View style={{ width: `${(item.value / largestActivity) * 100}%`, minWidth: item.value > 0 ? 7 : 0, height: "100%", borderRadius: 8, backgroundColor: item.tone.foreground }} /></View>
                <Text style={{ width: 28, color: colors.brandDark, fontSize: 13, lineHeight: 18, fontWeight: "800", textAlign: "right", fontVariant: ["tabular-nums"] }}>{item.value}</Text>
              </View>)}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.line }}><Ionicons name="trending-up-outline" size={16} color={colors.brand} /><Text style={{ color: colors.brandDark, fontSize: 12, lineHeight: 17, fontWeight: "700" }}>{activityInsight}</Text></View>
          </>}
      </View>}

      {!desktopProfile && <View style={[s.card, { padding: 8, gap: 2, borderRadius: 18 }]}>
        <ProfileMenuRow icon="settings-outline" title="Settings" detail="Notifications, privacy and account security" onPress={() => { onPageNavigate(); setMessage(""); setProfilePage("settings"); }} />
        <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 49 }} />
        <ProfileMenuRow icon="help-circle-outline" title="Help & support" detail="Step-by-step help in English and Bisaya" onPress={() => { onPageNavigate(); setMessage(""); setProfilePage("help"); }} />
      </View>}
      {!desktopProfile && <View style={{ gap: 8 }}>
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name="phone-portrait-outline" size={19} color={colors.brand} /><Text style={[s.title, { marginBottom: 0 }]}>App version</Text></View>
        <View style={[s.card, { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: 18 }]}>
          <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name="layers-outline" size={20} color={colors.brand} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: colors.brandDark, fontSize: 14, fontWeight: "800" }}>Iligan Connect</Text><Text style={s.small}>Installed app version</Text></View>
          <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: "#e5f6f2" }}><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "800" }}>v{RESIDENT_APP_VERSION}</Text></View>
        </View>
      </View>}
      {!desktopProfile && <Pressable accessibilityRole="button" onPress={() => setSignOutConfirm(true)} style={({ pressed }) => [{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: 15, borderWidth: 1, borderColor: "#f1d9d7", backgroundColor: "white" }, pressed && { opacity: 0.78 }]}><Ionicons name="log-out-outline" size={20} color="#ad403d" /><Text style={{ flex: 1, color: "#ad403d", fontSize: 14, fontWeight: "800" }}>Sign out</Text><Ionicons name="chevron-forward" size={17} color={colors.muted} /></Pressable>}
      </View></View>}

      {profilePage === "settings" && <>
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
      </>}

      {profilePage === "settings" && <>
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

      </>}

      {profilePage === "help" && <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 17, backgroundColor: "#eaf6f3", borderWidth: 1, borderColor: "#dcece5" }}>
          <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "white" }}><Ionicons name="book-outline" size={20} color={colors.brand} /></View>
          <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.brandDark, fontSize: 14, fontWeight: "800" }}>How to use Iligan Connect</Text><Text style={s.small}>Pili og topic sa ubos para makita ang mga lakang ug sabton kini sa English ug Bisaya.</Text></View>
        </View>
        <View style={[s.card, { padding: 10, gap: 2, borderRadius: 18 }]}>
          {helpItems.map((item, index) => <View key={item.key}>
            {index > 0 && <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 48 }} />}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: help === item.key }} onPress={() => setHelp(help === item.key ? "" : item.key)} style={({ pressed }) => [{ minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 }, pressed && { opacity: 0.78 }]}>
              <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={item.icon} size={19} color={colors.brand} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "800" }}>{item.title}</Text><Text style={s.small}>{item.bisayaTitle}</Text></View>
              <Ionicons name={help === item.key ? "chevron-up" : "chevron-down"} size={17} color={colors.muted} />
            </Pressable>
            {help === item.key && <View style={{ marginLeft: contentWidth < 360 ? 0 : 48, marginRight: 3, marginBottom: 12, padding: 11, borderRadius: 14, borderWidth: 1, borderColor: "#e5eeeb", backgroundColor: "#f8fbfa" }}>
              {item.english.map((step, stepIndex) => <View key={stepIndex}>
                {stepIndex > 0 && <View style={{ height: 1, marginVertical: 9, marginLeft: 30, backgroundColor: colors.line }} />}
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#e4f4f0" }}><Text style={{ color: colors.brand, fontSize: 11, fontWeight: "800" }}>{stepIndex + 1}</Text></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={{ color: colors.brandDark, fontSize: 13, lineHeight: 19 }}>{step}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>{item.bisaya[stepIndex]}</Text>
                  </View>
                </View>
              </View>)}
            </View>}
          </View>)}
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: 14, backgroundColor: "#eef5fb" }}><Ionicons name="alert-circle-outline" size={19} color="#3776b7" style={{ marginTop: 1 }} /><View style={{ flex: 1, gap: 4 }}><Text style={{ color: "#244a6c", fontSize: 12, lineHeight: 17 }}>Iligan Connect is for reporting and coordinating community concerns. It is not an emergency service. If someone is in immediate danger, contact local emergency responders.</Text><Text style={{ color: "#355675", fontSize: 12, lineHeight: 17 }}>Ang Iligan Connect para sa pagreport ug pag-coordinate sa mga problema sa komunidad. Dili kini emergency service. Kung adunay nameligro karon, tawag o duol dayon sa lokal nga emergency responders.</Text></View></View>
        <View style={[s.card, { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: 14 }]}><Ionicons name="chatbox-ellipses-outline" size={19} color={colors.brand} style={{ marginTop: 1 }} /><View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.brandDark, fontSize: 12, lineHeight: 17 }}>For account-specific help, contact your barangay office or use an official Iligan City contact channel. Never share your password.</Text><Text style={s.small}>Kung nanginahanglan kag tabang sa imong account, kontaka ang barangay office o gamita ang opisyal nga contact channel sa Iligan City. Ayaw ihatag ang imong password.</Text></View></View>
      </View>}

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

function ProfileMenuRow({ icon, title, detail, onPress }: { icon: "settings-outline" | "help-circle-outline"; title: string; detail: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ minHeight: 66, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 4, paddingVertical: 8, borderRadius: 13 }, pressed && { backgroundColor: "#f5fbf9" }]}>
    <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={20} color={colors.brand} /></View>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={{ color: colors.brandDark, fontSize: 14, fontWeight: "800" }}>{title}</Text><Text numberOfLines={2} style={s.small}>{detail}</Text></View>
    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
  </Pressable>;
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
  modal = false,
}: {
  profileId: string;
  backLabel: string;
  onBack: () => void;
  onNavigate: (t: string, reportId?: string | null, communitySection?: "consultations" | "meetings", announcementId?: string | null, consultationId?: string | null, meetingRequestId?: string | null) => Promise<void>;
  modal?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
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
      <View style={{ minHeight: modal ? 54 : 142, flexDirection: modal ? "row" : "column", alignItems: modal ? "center" : "stretch", justifyContent: "space-between", gap: modal ? 14 : 0, paddingVertical: modal ? 0 : 4, overflow: "hidden" }}>
        {!modal && <>
          <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: "absolute", right: -18, top: 0, width: 360, height: 120, opacity: 0.2 }}>
            <Image source={require("../assets/iligan-notifications-header.jpg")} resizeMode="contain" style={{ width: "100%", height: "100%" }} />
          </View>
          <AppBackNavigation label={backLabel} onBack={onBack} />
        </>}
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: modal ? "center" : "flex-start", gap: 10, marginTop: modal ? 0 : 12 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text accessibilityRole="header" style={[s.heading, { fontSize: modal ? 23 : 29, lineHeight: modal ? 29 : 36, marginBottom: 0 }]}>Notifications</Text>
            {!modal && <Text style={s.subtitle}>Updates about your reports and community.</Text>}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Filter notifications, currently ${filter}`} accessibilityHint="Choose all, unread, or read notifications" accessibilityState={{ expanded: filterOpen }} onPress={() => setFilterOpen(true)} style={({ pressed }) => [{ minHeight: modal ? 44 : 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: modal ? 11 : 12, borderRadius: modal ? 12 : 22, borderWidth: 1, borderColor: "#dcebe7", backgroundColor: modal ? "white" : "#ffffffed" }, pressed && { opacity: 0.75 }]}>
              <Ionicons name="options-outline" size={17} color={colors.brand} />
              <Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "700" }}>{filter === "all" ? "All" : filter === "unread" ? "Unread" : "Read"}</Text>
              <Ionicons name="chevron-down" size={15} color={colors.muted} />
            </Pressable>
            {modal && <Pressable accessibilityRole="button" accessibilityLabel="Close notifications" onPress={onBack} style={({ pressed }) => [{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: colors.line, opacity: pressed ? 0.75 : 1 }]}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>}
          </View>
        </View>
      </View>
      {!!unreadCount && <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 3 }}>
        <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: colors.muted, fontSize: 12 }}>{unreadCount} unread {unreadCount === 1 ? "update" : "updates"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Mark all notifications as read" disabled={markingAll} onPress={async () => {
          setMarkingAll(true);
          setMessage("");
          try {
            await result(db!.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profileId).is("read_at", null));
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["home"] }),
              qc.invalidateQueries({ queryKey: ["notifications", profileId] }),
            ]);
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setMarkingAll(false);
          }
        }} style={({ pressed }) => [{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 11, borderRadius: 22, borderWidth: 1, borderColor: "#dcebe7", backgroundColor: "white", opacity: markingAll ? 0.55 : 1 }, pressed && !markingAll && { opacity: 0.75 }]}>
          {markingAll ? <ActivityIndicator size="small" color={colors.brand} /> : <Ionicons name="checkmark-done-outline" size={17} color={colors.brand} />}
          <Text style={{ color: colors.brandDark, fontSize: 12, fontWeight: "700" }}>{markingAll ? "Marking…" : "Mark all as read"}</Text>
        </Pressable>
      </View>}
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
      <Modal visible={filterOpen} transparent animationType={modal ? "fade" : "slide"} statusBarTranslucent onRequestClose={() => setFilterOpen(false)}>
        <View style={{ flex: 1, alignItems: modal ? "center" : "stretch", justifyContent: modal ? "center" : "flex-end", padding: modal ? 24 : 0, backgroundColor: "#10263f77" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close notification filters" onPress={() => setFilterOpen(false)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
          <View style={modal ? { width: "100%", maxWidth: 420, padding: 18, borderRadius: 18, backgroundColor: "white", gap: 8 } : { paddingTop: 10, paddingHorizontal: 18, paddingBottom: 28, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "white", gap: 8 }}>
            {!modal && <View style={{ alignSelf: "center", width: 46, height: 5, borderRadius: 3, backgroundColor: "#c8d2df", marginBottom: 5 }} />}
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
