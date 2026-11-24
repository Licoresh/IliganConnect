"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openReportFromRow } from "../lib/report-row";
import Image from "next/image";
import appConfig from "../../app/app.json";
import {
  Search,
  RefreshCw,
  ShieldCheck,
  ArrowUpRight,
  Building2,
  ChartNoAxesCombined,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  MessageSquare,
  Settings,
  Users,
  UserRound,
  Megaphone,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  X,
  FileText,
  Clock3,
  BadgeCheck,
  Cog,
  CircleCheck,
  TriangleAlert,
  CalendarDays,
  Eye,
  EyeOff,
  MoreHorizontal,
} from "lucide-react";
import { db, result, configured } from "../lib/client";
import { Profile, Report, Lookup, label } from "@community/shared";
import dynamic from "next/dynamic";
import { Community } from "./community";
import { Analytics, AnalyticsData } from "./analytics";
import { Administration } from "./administration";
import { BarangayResidents } from "./residents-management";
import { SettingsPanel } from "./settings";
import { Reports } from "./reports";
import { OfficeCategoryReports } from "./office-category-reports";
import { AccessContext, useAccess } from "./access-context";
import {
  StaffContext,
  roleNames,
  canOpenSection,
  permissionFingerprint,
} from "../lib/access";
import { NotificationCenter } from "./notification-center";
import { readWorkspaceLocation, shouldResetWorkspace, workspaceLocationUrl, type WorkspaceLocation } from "../lib/workspace-location";
import { ReportCategoryLabel } from "./report-category";
import { ReportThumb, useReportListPhotos } from "./report-photos";
import { reportStatusLabel } from "@community/shared";
const IssueMap = dynamic(() => import("./issue-map"), {
  ssr: false,
  loading: () => <p className="empty">Loading geographic workspace…</p>,
});
function authErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("invalid login credentials"))
    return "That email and password do not match. Check them and try again.";
  if (message.includes("email not confirmed") || message.includes("email_not_confirmed"))
    return "Confirm your email address before signing in.";
  if (message.includes("rate limit") || message.includes("too many requests"))
    return "Too many attempts. Wait a few minutes, then try again.";
  if (message.includes("expired") || message.includes("invalid token"))
    return "That recovery link has expired. Request a new one.";
  if (message.includes("fetch") || message.includes("network"))
    return "We could not reach the sign-in service. Check your connection and retry.";
  return "We could not complete that request. Check your details and try again.";
}
const nav = [
  ["Overview", LayoutDashboard],
  ["Issue reports", ClipboardList],
  ["Category reports", FileText],
  ["Residents", UserRound],
  ["Issue Mapping & Heatmap", MapPinned],
  ["Geographic analytics", ChartNoAxesCombined],
  ["Consultations", MessageSquare],
  ["Meeting requests", Users],
  ["Announcements", Megaphone],
  ["Administration", Settings],
  ["Settings", Settings],
] as const;
const rolePrimarySections: Record<string, string[]> = {
  barangay: ["Overview", "Issue reports", "Residents", "Issue Mapping & Heatmap"],
  office: ["Overview", "Issue reports", "Category reports", "Issue Mapping & Heatmap"],
  admin: ["Overview", "Issue reports", "Issue Mapping & Heatmap", "Administration"],
};
const compactNavLabels: Record<string, string> = {
  "Overview": "Home",
  "Issue reports": "Reports",
  "Category reports": "Categories",
  "Residents": "Residents",
  "Issue Mapping & Heatmap": "Map",
  "Geographic analytics": "Analytics",
  "Consultations": "Consults",
  "Meeting requests": "Meetings",
  "Announcements": "Updates",
  "Administration": "Admin",
  "Settings": "Settings",
};
const appVersion = appConfig.expo.version;
function titleCaseHeading(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
function writeWorkspaceLocation(location: WorkspaceLocation, replace = false) {
  window.history[replace ? "replaceState" : "pushState"](
    null,
    "",
    workspaceLocationUrl(new URL(window.location.href), location),
  );
}
export type References = {
  categories: Lookup[];
  barangays: Lookup[];
  organizations: Lookup[];
  includeSamples?: boolean;
};
export default function Workspace() {
  const [session, setSession] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [section, setSection] = useState("Overview"),
    [drawer, setDrawer] = useState(false),
    [navSheetOpen, setNavSheetOpen] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [scope, setScope] = useState(""),
    [reportQueue, setReportQueue] = useState("all"),
    [recordTarget, setRecordTarget] = useState({ id: "", revision: 0 }),
    [recovery, setRecovery] = useState(false);
  const qc = useQueryClient();
  const previousSection = useRef(section);
  const identity = useRef<string | null>(null),
    permissionStamp = useRef("");
  const menuButton = useRef<HTMLButtonElement>(null),
    navMoreButton = useRef<HTMLButtonElement>(null),
    navSheet = useRef<HTMLDialogElement>(null),
    navSheetNavigating = useRef(false),
    restoreMenuFocus = useRef(false),
    sidebar = useRef<HTMLElement>(null),
    pageTitle = useRef<HTMLHeadingElement>(null),
    focusPageTitle = useRef(false),
    recordEntry = useRef(false);
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    let disposed = false;
    let receivedAuthEvent = false;
    let refreshTimer: ReturnType<typeof setTimeout>;
    db.auth.getSession().then(({ data, error }) => {
      if (disposed || receivedAuthEvent) return;
      identity.current = data.session?.user.id ?? null;
      setSession(identity.current);
      if (error) setError(error.message);
      setLoading(false);
    }).catch((error: Error) => {
      if (disposed || receivedAuthEvent) return;
      setError(authErrorMessage(error));
      setLoading(false);
    });
    const { data } = db.auth.onAuthStateChange((event, s) => {
      if (disposed) return;
      receivedAuthEvent = true;
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      const next = s?.user.id ?? null;
      if (shouldResetWorkspace(identity.current, next)) {
        qc.clear();
        setSection("Overview");
        setScope("");
        setRecordTarget({ id: "", revision: 0 });
        setReportQueue("all");
        setDrawer(false);
        permissionStamp.current = "";
        recordEntry.current = false;
        writeWorkspaceLocation({ section: "Overview", scope: "", recordId: "", queue: "all" }, true);
      }
      identity.current = next;
      setSession(next);
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        clearTimeout(refreshTimer);
        // Supabase queries must start after the auth callback releases its lock.
        refreshTimer = setTimeout(() => {
          if (!disposed && identity.current === next)
            void qc.invalidateQueries({ queryKey: ["staff-context"] });
        }, 0);
      }
      if (event === "SIGNED_OUT") {
        setDrawer(false);
        setRecovery(false);
        setError("You have signed out. Sign in to continue.");
      }
    });
    return () => {
      disposed = true;
      clearTimeout(refreshTimer);
      data.subscription.unsubscribe();
    };
  }, [qc]);
  const access = useQuery({
    queryKey: ["staff-context", session],
    enabled: !!session,
    refetchInterval: 30000,
    refetchOnWindowFocus: "always",
    retry: 1,
    queryFn: () => result<StaffContext | null>(db!.rpc("staff_context")),
  });
  const profile = { ...access, data: access.data?.profile };
  useEffect(() => {
    const route = readWorkspaceLocation(new URL(window.location.href), nav.map(([name]) => name));
    setSection(route.section);
    setScope(route.scope);
    setRecordTarget({ id: route.recordId, revision: 0 });
    setReportQueue(route.queue);
    recordEntry.current = false;
    const restore = () => {
      const route = readWorkspaceLocation(new URL(window.location.href), nav.map(([name]) => name));
      focusPageTitle.current = true;
      setSection(route.section);
      setScope(route.scope);
      setRecordTarget((target) => ({ id: route.recordId, revision: target.revision + 1 }));
      setReportQueue(route.queue);
      recordEntry.current = !!route.recordId;
      setDrawer(false);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [section]);
  useEffect(() => {
    if (focusPageTitle.current) {
      focusPageTitle.current = false;
      pageTitle.current?.focus();
    }
  }, [section, recordTarget.revision]);
  useEffect(() => {
    if (!drawer && restoreMenuFocus.current) {
      restoreMenuFocus.current = false;
      menuButton.current?.focus();
    }
  }, [drawer]);
  useEffect(() => {
    if (!access.data?.authorized || canOpenSection(access.data, section)) return;
    setSection("Overview");
    setScope("");
    setRecordTarget((target) => ({ id: "", revision: target.revision + 1 }));
    setReportQueue("all");
    recordEntry.current = false;
    writeWorkspaceLocation({ section: "Overview", scope: "", recordId: "", queue: "all" }, true);
  }, [access.data, section]);
  useEffect(() => {
    const stamp = permissionFingerprint(access.data);
    if (permissionStamp.current && permissionStamp.current !== stamp) {
      qc.removeQueries({
        predicate: (q) =>
          !["staff-context", "refs"].includes(String(q.queryKey[0])),
      });
      setSection("Overview");
      setScope("");
      setRecordTarget({ id: "", revision: 0 });
      recordEntry.current = false;
      writeWorkspaceLocation({ section: "Overview", scope: "", recordId: "", queue: "all" }, true);
    }
    permissionStamp.current = stamp;
  }, [access.data, qc]);
  useEffect(() => {
    if (!drawer) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        restoreMenuFocus.current = true;
        setDrawer(false);
      }
      if (event.key === "Tab") {
        const nodes =
          sidebar.current?.querySelectorAll<HTMLElement>("a,button");
        if (!nodes?.length) return;
        if (event.shiftKey && document.activeElement === nodes[0]) {
          event.preventDefault();
          nodes[nodes.length - 1].focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === nodes[nodes.length - 1]
        ) {
          event.preventDefault();
          nodes[0].focus();
        }
      }
    };
    const tablet = window.matchMedia("(min-width: 768px)");
    const resize = () => {
      if (tablet.matches) setDrawer(false);
    };
    tablet.addEventListener("change", resize);
    document.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", keys);
      tablet.removeEventListener("change", resize);
    };
  }, [drawer]);
  useEffect(() => {
    const dialog = navSheet.current;
    if (!dialog) return;
    if (navSheetOpen && !dialog.open) dialog.showModal();
    else if (!navSheetOpen && dialog.open) dialog.close();
  }, [navSheetOpen]);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 767px)");
    const closeSheetOutsidePhone = () => {
      if (!mobile.matches) setNavSheetOpen(false);
    };
    mobile.addEventListener("change", closeSheetOutsidePhone);
    return () => mobile.removeEventListener("change", closeSheetOutsidePhone);
  }, []);
  const refs = useQuery({
    queryKey: ["refs", session],
    enabled: !!access.data?.authorized,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [categories, barangays, organizations, settings, problemTypes] = await Promise.all([
      result<Lookup[]>(
        db!.from("report_categories").select("*").order("name"),
      ),
      result<Lookup[]>(
        db!.from("barangays").select("*").order("name"),
      ),
      result<Lookup[]>(
        db!.from("organizations").select("*").order("name"),
      ),
      result<{ include_samples: boolean }>(db!.from("analytics_settings").select("include_samples").single()),
      result<{ category_id: string; code: string; label: string; sort_order: number }[]>(
        db!.from("report_problem_types").select("category_id,code,label,sort_order").order("sort_order"),
      ),
      ]);
      const categoriesWithProblems = categories.map((category) => ({
        ...category,
        problem_types: problemTypes.filter((item) => item.category_id === category.id)
          .map(({ code, label, sort_order }) => ({ code, label, sort_order })),
      }));
      return { categories: categoriesWithProblems, barangays, organizations, includeSamples: settings.include_samples };
    },
  });
  const closeNavSheet = (navigating = false) => {
    if (navigating) navSheetNavigating.current = true;
    if (navSheet.current?.open) navSheet.current.close();
    setNavSheetOpen(false);
  };
  const coordinate = (next: string, id: string) => {
    closeNavSheet(navSheet.current?.open);
    setRecordTarget((target) => ({ id: "", revision: target.revision + 1 }));
    setScope(id);
    setSection(next);
    recordEntry.current = false;
    focusPageTitle.current = true;
    writeWorkspaceLocation({ section: next, scope: id, recordId: "", queue: "all" });
  };
  const navigate = (next: string, recordId = "", queue = "all") => {
    closeNavSheet(navSheet.current?.open);
    setReportQueue(queue);
    setRecordTarget((target) => ({ id: recordId, revision: target.revision + 1 }));
    setScope("");
    setSection(next);
    setDrawer(false);
    recordEntry.current = !!recordId;
    focusPageTitle.current = true;
    writeWorkspaceLocation({ section: next, scope: "", recordId, queue });
  };
  const closeReport = () => {
    if (recordEntry.current) {
      recordEntry.current = false;
      window.history.back();
      return;
    }
    setRecordTarget((target) => ({ id: "", revision: target.revision + 1 }));
    writeWorkspaceLocation({ section, scope, recordId: "", queue: reportQueue }, true);
  };
  if (loading) return <p className="empty">Opening your workspace…</p>;
  if (recovery && session)
    return (
      <main className="login-form">
        <SettingsPanel recovery onDone={() => setRecovery(false)} />
      </main>
    );
  if (!session)
    return (
      <main className="login">
        <section className="login-story">
          <div className="brand">
            <Image src="/iligan-connect-logo.png" alt="" aria-hidden="true" width={48} height={48} /> ILIGAN CONNECT
          </div>
          <h1>
            Local concerns.
            <br />
            Shared responsibility.
          </h1>
          <p>
            A clearer view of our communities. One place to assess issues,
            coordinate responses, and keep residents informed.
          </p>
          <div className="story-line">
            <MapPinned /> Report <span>→</span> Assess <span>→</span> Coordinate
          </div>
          <small>Iligan City, Philippines · Administrative workspace</small>
        </section>
        <section className="login-form">
          <div className="brand login-brand">
            <Image
              src="/iligan-connect-logo.png"
              alt="Iligan Connect logo"
              width={46}
              height={46}
              priority
            />
            ILIGAN CONNECT
          </div>
          <h2>Sign in to your workspace</h2>
          <p>For authorized barangay personnel and participating offices.</p>
          {!configured ? (
            <div className="notice">
              <strong>Workspace is not connected</strong>
              <p>
                Ask the system administrator to complete the project
                configuration.
              </p>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const { error } = await db!.auth.signInWithPassword({
                    email: email.trim(),
                    password,
                  });
                  if (error) throw error;
                  setPassword("");
                } catch (e) {
                  setError(authErrorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Email address
                <input maxLength={254}
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="password-field">
                Password
                <span className="password-input-wrap">
                  <input maxLength={1024}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    disabled={busy}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </span>
              </label>
              <button disabled={busy}>
                {busy ? "Signing in…" : "Sign in"} <ArrowUpRight size={18} />
              </button>
            </form>
          )}
          {error && (
            <p role="status" className="notice">
              {error}
            </p>
          )}
          <p className="fine">
            Residents report and track concerns using the Iligan Connect mobile
            app. This platform is not an emergency dispatch service.
          </p>
        </section>
      </main>
    );
  if (session && !access.isPending && !access.error && !access.data?.authorized)
    return (
      <main className="access-state panel">
        <Image src="/iligan-connect-logo.png" alt="" aria-hidden="true" width={52} height={52} />
        <p className="eyebrow">ILIGAN CONNECT</p>
        <h1>
          {profile.data?.account_status === "disabled"
            ? "Account disabled"
            : profile.data?.role === "resident"
              ? "Staff access required"
              : "Awaiting access approval"}
        </h1>
        <p>
          Your administrator must approve your staff account and assign its
          organization or barangay before you can enter this workspace.
        </p>
        <button className="secondary" onClick={() => void access.refetch()}>
          Check access again
        </button>
        <button onClick={() => void db!.auth.signOut()}>Sign out</button>
      </main>
    );
  if (profile.isPending || (!profile.error && refs.isPending))
    return <p className="empty">Loading your workspace…</p>;
  if (profile.error || refs.error)
    return (
      <main className="workspace-error">
        <section className="panel" aria-labelledby="load-error-title">
          <span className="error-mark"><CircleAlert size={22} /></span>
          <h1 id="load-error-title">Couldn’t load your workspace</h1>
          <p className="muted" role="alert">We couldn’t retrieve the data needed to continue. Check your connection and try again.</p>
          <div className="inline-actions">
            <button onClick={() => void qc.invalidateQueries()}>Retry</button>
            <button className="secondary" onClick={() => void db!.auth.signOut()}>Sign out</button>
          </div>
        </section>
      </main>
    );
  if (!profile.data || profile.data.role === "resident")
    return (
      <main className="empty">
        <h1>Resident account</h1>
        <p>
          Use the resident app to submit reports. Staff access is assigned by
          your administrator.
        </p>
        <button onClick={() => void db!.auth.signOut()}>Sign out</button>
      </main>
    );
  const context = access.data!;
  const jurisdiction =
    profile.data.role === "barangay"
      ? refs.data?.barangays.find((b) => b.id === profile.data!.barangay_id)
          ?.name || "Assigned barangay"
      : profile.data.role === "admin"
        ? "Citywide administration"
        : context.organizations.map((o) => o.name).join(" · ") ||
          "Office workspace";
  const availableSection = (n: string) => canOpenSection(context, n);
  const visibleSection = availableSection(section) ? section : "Overview";
  const primarySections = (rolePrimarySections[profile.data.role] || rolePrimarySections.admin).filter(availableSection);
  const primaryNav = nav.filter(([name]) => primarySections.includes(name));
  const navGroups = [
    { title: "Community operations", items: nav.slice(0, 6) },
    { title: "Community", items: nav.slice(6, 9) },
    { title: "System", items: nav.slice(9, 10) },
    { title: "Account", items: nav.slice(10) },
  ];
  return (
    <AccessContext.Provider value={context}>
      <div className="shell" data-role={profile.data.role}>
        <a className="skip-link" href="#main">Skip to workspace</a>
        <aside
          id="workspace-navigation"
          ref={sidebar}
          className={drawer ? "sidebar open" : "sidebar"}
          aria-label="Workspace navigation"
        >
          <button
            className="drawer-close"
            aria-label="Close navigation"
            onClick={() => {
              restoreMenuFocus.current = true;
              setDrawer(false);
            }}
          >
            <X size={20} />
          </button>
          <a className="brand" href="#main">
            <Image src="/iligan-connect-logo.png" alt="" aria-hidden="true" width={34} height={34} /> <span>ILIGAN <b>CONNECT</b></span>
          </a>
          <div className="workspace-edition"><span /> LOCAL ACTION · STRONGER ILIGAN</div>
          <nav aria-label="Main navigation">
            {navGroups.map((group) => {
              const items = group.items.filter(([n]) => availableSection(n));
              return items.length ? <div className="nav-group" key={group.title}>
                <p className="nav-caption">{group.title}</p>
                {items.map(([n, Icon]) => <button key={n} title={n} aria-label={n} className={visibleSection === n ? "active" : ""}
                  aria-current={visibleSection === n ? "page" : undefined} onClick={() => navigate(n)}>
                  <Icon size={18} /><span data-compact-label={compactNavLabels[n]}>{n === "Issue Mapping & Heatmap" ? "Mapping & heatmap" : n}</span>
                </button>)}
              </div> : null;
            })}
          </nav>
          <div className="sidebar-footer">
            <span className="avatar">
              {profile.data.display_name.slice(0, 2).toUpperCase() || "IC"}
            </span>
            <div>
              <strong>{profile.data.display_name || "Staff member"}</strong>
              <small>{roleNames[profile.data.role]}</small>
            </div>
            <button
              aria-label="Sign out"
              onClick={() => void db!.auth.signOut()}
            >
              <LogOut size={18} />
            </button>
          </div>
          <small className="sidebar-version">v{appVersion}</small>
        </aside>
        {drawer && (
          <button
            className="scrim"
            aria-label="Close navigation"
            onClick={() => {
              restoreMenuFocus.current = true;
              setDrawer(false);
            }}
          />
        )}
        <div className="content" inert={drawer || undefined}>
          <header className="topbar">
            <button
              className="mobile-menu secondary"
              ref={menuButton}
              aria-controls="workspace-navigation"
              aria-label="Toggle navigation"
              aria-expanded={drawer}
              onClick={() => setDrawer(!drawer)}
            >
              <Menu />
            </button>
            <div className="workspace-identity">
              <Building2 size={19} />
              <div>
                <strong>{jurisdiction}</strong>
                <small>{roleNames[profile.data.role]} · Iligan City</small>
              </div>
            </div>
            <div className="topbar-actions">
              <button className="secondary workspace-search" onClick={() => navigate("Issue reports")} aria-label="Find a report">
                <Search size={17} /><span>Find a report</span>
              </button>
              <NotificationCenter navigate={navigate} />
              <details className="profile-menu">
                <summary>
                  <span className="avatar">
                    {profile.data.display_name.slice(0, 2).toUpperCase() ||
                      "IC"}
                  </span>
                  <span className="profile-name">
                    {profile.data.display_name || "Staff member"}
                  </span>
                  <ChevronDown size={15} />
                </summary>
                <div>
                  <button
                    className="text-button"
                    onClick={() => navigate("Settings")}
                  >
                    Account settings
                  </button>
                  <button
                    className="text-button"
                    onClick={() => void db!.auth.signOut()}
                  >
                    Sign out
                  </button>
                </div>
              </details>
            </div>
          </header>
          <main id="main" className={visibleSection === "Overview" || visibleSection === "Issue Mapping & Heatmap" ? "overview-main" : ["Issue reports", "Category reports"].includes(visibleSection) ? "reports-main" : undefined} tabIndex={-1}>
            <div className="page-heading">
              {visibleSection === "Overview" ? (
                <>
                  <div className="overview-heading-copy">
                    <h1 ref={pageTitle} tabIndex={-1} className="overview-heading-title">
                      {titleCaseHeading(profile.data.role === "barangay"
                        ? `${jurisdiction} dashboard`
                        : profile.data.role === "admin"
                          ? "Iligan City dashboard"
                          : `${context.organizations[0]?.name || "Office"} dashboard`)}
                    </h1>
                    <p className="overview-heading-subtitle">Local concerns, shared priorities. Your community at a glance.</p>
                  </div>
                </>
              ) : visibleSection === "Issue Mapping & Heatmap" ? <>
                <div className="overview-heading-copy">
                  <h1 ref={pageTitle} tabIndex={-1} className="overview-heading-title">Issue Mapping &amp; Heatmap</h1>
                  <p className="overview-heading-subtitle">Explore reported concerns and identify patterns in your authorized area.</p>
                </div>
              </> : <>
                <div>
                  <h1 ref={pageTitle} tabIndex={-1}>{titleCaseHeading(visibleSection)}</h1>
                  <p>{({
                    "Issue reports": "Review evidence, route responsibility and keep each case moving.",
                    "Category reports": "Read barangay-managed reports in your approved categories and coverage.",
                    "Residents": "View the resident directory for your assigned barangay.",
                    "Issue Mapping & Heatmap": "Explore issue concentrations and the reports behind them.",
                    "Geographic analytics": "Compare reporting patterns with evidence and context.",
                    "Consultations": "Bring community experience into the decisions that follow.",
                    "Meeting requests": "Coordinate people, decisions and accountable follow-up.",
                    "Announcements": "Keep communities informed with timely, official updates.",
                    "Administration": "Manage stakeholder accounts, organizations, permissions, and system activity.",
                    "Settings": "Manage your workspace details, preferences, and security.",
                  } as Record<string, string>)[visibleSection] || "Manage your workspace with clear permissions and accountability."}</p>
                </div>
              </>}
            </div>
            {visibleSection === "Overview" ? (
              <Overview onNavigate={navigate} refs={refs.data!} />
            ) : visibleSection === "Residents" ? (
              <BarangayResidents active={visibleSection === "Residents"} barangayName={jurisdiction} />
            ) : section === "Issue reports" ? (
              <Reports refs={refs.data!} initialRecordId={recordTarget.id} initialBarangay={scope} initialQueue={reportQueue}
                onOpenReport={(id, queue) => navigate("Issue reports", id, queue)} onCloseReport={closeReport} />
            ) : section === "Category reports" && profile.data.role === "office" ? (
              <OfficeCategoryReports refs={refs.data!} />
            ) : section === "Issue Mapping & Heatmap" ? (
              <IssueMap
                key={scope}
                refs={refs.data!}
                initialShowBoundary
                initialBarangay={
                  scope ||
                  (profile.data.role === "barangay"
                    ? profile.data.barangay_id || ""
                    : "")
                }
              />
            ) : section === "Geographic analytics" ? (
              <Analytics
                key={scope}
                refs={refs.data!}
                initialBarangay={
                  scope ||
                  (profile.data.role === "barangay"
                    ? profile.data.barangay_id || ""
                    : "")
                }
                onCoordinate={coordinate}
                onOpenReport={(reportId) => navigate("Issue reports", reportId)}
              />
            ) : availableSection(section) && section === "Administration" ? (
              <Administration
                key={section}
                refs={refs.data!}
                profile={profile.data}
              />
            ) : section === "Settings" ? (
              <SettingsPanel
                profile={profile.data}
                organizations={context.organizations}
                barangayName={refs.data?.barangays.find((item) => item.id === profile.data?.barangay_id)?.name}
              />
            ) : (
              <Community
                key={`${section}:${scope}:${recordTarget.revision}`}
                initialRecordId={recordTarget.id}
                section={section}
                refs={refs.data!}
                initialBarangay={
                  scope ||
                  (profile.data.role === "barangay"
                    ? profile.data.barangay_id || ""
                    : "")
                }
                profile={profile.data}
              />
            )}
          </main>
          <footer>
            <span className="workspace-footer-brand">ILIGAN CONNECT</span>
            <span>Human assessment informs every action.</span>
          </footer>
        </div>
        <nav className="staff-bottom-nav" aria-label="Primary staff navigation">
          {primaryNav.map(([name, Icon]) => {
            const label = name === "Overview" ? "Home" : name === "Issue reports" ? "Reports" : name === "Issue Mapping & Heatmap" ? "Map" : name === "Category reports" ? "Categories" : name === "Administration" ? "Admin" : name;
            return <button key={name} type="button" className={visibleSection === name ? "active" : ""}
              aria-current={visibleSection === name ? "page" : undefined} onClick={() => navigate(name)}>
              <Icon size={19} aria-hidden="true" /><span>{label}</span>
            </button>;
          })}
          <button ref={navMoreButton} type="button" className={!primarySections.includes(visibleSection) ? "active" : ""}
            aria-expanded={navSheetOpen} aria-controls="staff-more-sections" onClick={() => setNavSheetOpen(true)}>
            <MoreHorizontal size={20} aria-hidden="true" /><span>More</span>
          </button>
        </nav>
        <dialog ref={navSheet} id="staff-more-sections" className="staff-more-dialog"
          aria-labelledby="staff-more-title" onCancel={(event) => { event.preventDefault(); closeNavSheet(); }}
          onClose={() => {
            setNavSheetOpen(false);
            if (navSheetNavigating.current) {
              navSheetNavigating.current = false;
              requestAnimationFrame(() => pageTitle.current?.focus());
            } else if (window.matchMedia("(max-width: 767px)").matches) navMoreButton.current?.focus();
          }}
          onClick={(event) => { if (event.target === event.currentTarget) closeNavSheet(); }}>
          <div className="staff-more-header">
            <div><span>Workspace</span><h2 id="staff-more-title">More sections</h2></div>
            <button type="button" className="secondary" aria-label="Close more sections" onClick={() => closeNavSheet()}><X size={19} /></button>
          </div>
          <div className="staff-more-groups">
            {navGroups.map((group) => {
              const items = group.items.filter(([name]) => availableSection(name) && !primarySections.includes(name));
              return items.length ? <section key={group.title} aria-label={group.title}>
                <h3>{group.title}</h3>
                {items.map(([name, Icon]) => <button type="button" key={name} className={visibleSection === name ? "active" : ""}
                  aria-current={visibleSection === name ? "page" : undefined} onClick={() => navigate(name)}>
                  <Icon size={19} aria-hidden="true" /><span>{name === "Issue Mapping & Heatmap" ? "Mapping & heatmap" : name}</span><ChevronRight size={17} aria-hidden="true" />
                </button>)}
              </section> : null;
            })}
          </div>
        </dialog>
      </div>
    </AccessContext.Provider>
  );
}
function Overview({
  onNavigate,
  refs,
}: {
  onNavigate: (s: string, recordId?: string, queue?: string) => void;
  refs: References;
}) {
  const access = useAccess();
  const q = useQuery({
    queryKey: ["overview"],
    refetchInterval: 60000,
    queryFn: async () => {
      const [analytics, recent, taskResult, meetings, announcements] = await Promise.all([
        result<AnalyticsData>(db!.rpc("geographic_analytics")),
        result<Report[]>(
          db!.from("reports").select("*").order("created_at", { ascending: false }).limit(6),
        ),
        (async () => {
          const { data, count, error } = await db!.from("reports").select("*", { count: "exact" })
            .in("status", ["assigned", "scheduled", "in_progress"]).order("created_at").limit(5);
          if (error) throw new Error(error.message);
          return { rows: data as Report[], count: count ?? 0 };
        })(),
        result<{ id: string; title: string; barangay_id: string; status: string; created_at: string }[]>(
          db!.from("meeting_requests").select("id,title,barangay_id,status,created_at").order("created_at", { ascending: false }).limit(5),
        ),
        result<{ id: string; title: string; kind: string; publish_at: string; barangay_id: string | null; organization_id: string | null }[]>(
          db!.from("announcements").select("id,title,kind,publish_at,barangay_id,organization_id").eq("status", "published").lte("publish_at", new Date().toISOString()).order("publish_at", { ascending: false }).limit(5),
        ),
      ]);
      const tasks = taskResult.rows;
      const history = tasks.length
        ? await result<{ report_id: string; created_at: string }[]>(
            db!.from("report_status_history").select("report_id,created_at").in("report_id", tasks.map((report) => report.id)).eq("new_status", "assigned").order("created_at", { ascending: false }),
          )
        : [];
      const schedules = meetings.length
        ? await result<{ request_id: string; starts_at: string }[]>(db!.from("meetings").select("request_id,starts_at").in("request_id", meetings.map((meeting) => meeting.id))).catch(() => [])
        : [];
      const meetingStarts = Object.fromEntries(schedules.map((item) => [item.request_id, item.starts_at]));
      const assignedAt: Record<string, string> = {};
      for (const event of history) assignedAt[event.report_id] ??= event.created_at;
      return { analytics, recent, tasks, taskCount: taskResult.count, meetings, announcements, assignedAt, meetingStarts };
    },
  });

  const overviewPhotos = useReportListPhotos(q.data ? [...new Set([...q.data.recent, ...q.data.tasks].map((report) => report.id))] : []);
  if (q.isPending) return (
    <div className="overview-loading" role="status" aria-label="Loading your dashboard">
      <div className="metrics overview-metrics">{[1, 2, 3, 4, 5, 6].map((n) => <div key={n} className="skeleton metric" />)}</div>
      <div className="overview-lower-skeleton"><div className="skeleton overview-list-skeleton" /><div className="skeleton overview-list-skeleton" /></div>
      <div className="overview-lower-skeleton"><div className="skeleton overview-list-skeleton" /><div className="skeleton overview-list-skeleton" /></div>
    </div>
  );
  if (q.error) return (
    <div role="alert" className="error overview-error">
      <div><strong>Dashboard data couldn’t load</strong><p>Check your connection, then try again.</p></div>
      <button className="secondary" disabled={q.isFetching} onClick={() => void q.refetch()}>{q.isFetching ? "Retrying…" : "Retry dashboard"}</button>
    </div>
  );

  const data = q.data;
  const counts = data.analytics.counts;
  const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) =>
    new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "Asia/Manila" }).format(new Date(value));
  const metricCards = [
    { key: "total", title: "Received reports", note: "All submissions in your scope", Icon: FileText, tone: "blue" },
    { key: "review", title: "Awaiting review", note: "Submitted or under review", Icon: Clock3, tone: "amber" },
    { key: "verified", title: "Distinct verified", note: "Verified; rejected and duplicate excluded", Icon: BadgeCheck, tone: "teal" },
    { key: "progress", title: "In progress", note: "Currently marked in progress", Icon: Cog, tone: "indigo" },
    { key: "resolved", title: "Resolved", note: "Marked as resolved", Icon: CircleCheck, tone: "green" },
    { key: "unresolved", title: "Unresolved verified", note: "Verified and not yet resolved", Icon: TriangleAlert, tone: "red" },
  ] as const;
  return (
    <div className="overview">
      <div className="dashboard-brief overview-scope">
        <div className="overview-scope-copy"><span className="overview-scope-icon"><ShieldCheck size={17} /></span><span>Authorized records</span></div>
        <button className="text-button overview-updated" disabled={q.isFetching} onClick={() => void q.refetch()} aria-label={q.isFetching ? "Refreshing dashboard data" : `Refresh dashboard. Last updated ${formatDate(new Date(q.dataUpdatedAt).toISOString(), { dateStyle: "medium", timeStyle: "short" })}`}>
          <RefreshCw size={14} className={q.isFetching ? "refreshing" : ""} />
          {q.isFetching ? "Refreshing…" : `Last updated · ${formatDate(new Date(q.dataUpdatedAt).toISOString(), { dateStyle: "medium", timeStyle: "short" })}`}
        </button>
      </div>

      <div className="metrics overview-metrics" aria-label="Report summary">
        {metricCards.map(({ key, title, note, Icon, tone }) => (
          <article className={`metric overview-metric metric-${key}`} key={key}>
            <span className={`overview-metric-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span>
            <div className="overview-metric-copy"><span className="overview-metric-title">{title}</span><strong>{counts[key] ?? 0}</strong><small>{note}</small></div>
          </article>
        ))}
      </div>

      <div className="two-col overview-reporting">
        <section className="panel overview-panel">
          <div className="panel-heading overview-panel-heading"><div className="overview-panel-title"><span className="overview-section-icon blue"><FileText size={17} /></span><div><h2>Recent reports</h2><p className="overview-panel-subtitle">Latest submissions visible in your scope</p></div></div><button className="text-button" onClick={() => onNavigate("Issue reports")}>View all reports <ArrowUpRight size={15} /></button></div>
          {data.recent.length ? <><ul className="report-card-list overview-report-cards" aria-label="Most recent reports in your authorized scope">{data.recent.map((report) => {
            const category = refs.categories.find((item) => item.id === report.category_id)?.name || "Other";
            const barangay = refs.barangays.find((item) => item.id === report.barangay_id)?.name || "Iligan City";
            const photoCount = overviewPhotos.data?.counts.get(report.id) ?? 0;
            return <li key={report.id}><button type="button" className="report-card" onClick={() => onNavigate("Issue reports", report.id)} aria-label={`Open report: ${report.title}`}>
              <ReportThumb className="report-card-thumb" url={overviewPhotos.data?.urls.get(report.id)} categoryName={category} />
              <span className="report-card-body">
                <span className="report-card-chips"><ReportCategoryLabel name={category} compact /><span className={`badge ${report.status}`}>{reportStatusLabel(report.status)}</span></span>
                <strong className="report-card-title">{report.title}</strong>
                <span className="report-card-meta"><span><CalendarDays size={13} aria-hidden="true" />{formatDate(report.created_at)} · {barangay}</span>{photoCount > 0 && <span className="report-card-photos">{photoCount} {photoCount === 1 ? "photo" : "photos"}</span>}</span>
              </span>
            </button></li>;
          })}</ul><div className="table-scroll overview-table-wrap"><table className="overview-table overview-recent-table">
            <caption className="sr-only">Most recent reports in your authorized scope</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Title</th><th scope="col">Category</th><th scope="col">Date</th><th scope="col">Status</th></tr></thead>
            <tbody>{data.recent.map((report) => {
              const category = refs.categories.find((item) => item.id === report.category_id)?.name || "Other";
              const barangay = refs.barangays.find((item) => item.id === report.barangay_id)?.name || "Iligan City";
              return <tr key={report.id} className="report-row-clickable" onClick={(event) => openReportFromRow(event, () => onNavigate("Issue reports", report.id))}>
                <td data-label="#"><span className="overview-report-id">#{report.id.slice(0, 4).toUpperCase()}</span></td>
                <td data-label="Title"><div className="overview-report-title-cell"><ReportThumb className="overview-report-thumb" url={overviewPhotos.data?.urls.get(report.id)} categoryName={category} /><span className="overview-report-copy"><button className="overview-report-link" title={report.title} onClick={() => onNavigate("Issue reports", report.id)}>{report.title}</button><small>{barangay} · {formatDate(report.created_at)}</small></span></div></td>
                <td data-label="Category"><ReportCategoryLabel name={category} compact className="overview-category" /></td>
                <td data-label="Date" className="overview-date">{formatDate(report.created_at)}</td>
                <td data-label="Status"><span className={`badge ${report.status}`}>{label(report.status)}</span></td>
              </tr>;
            })}</tbody>
          </table></div></> : <div className="overview-empty"><FileText size={20} /><strong>No reports yet</strong><span>Resident submissions will appear here.</span></div>}
        </section>

        <div className="overview-reporting-aside">
        <section className="panel overview-panel overview-assigned">
          <div className="panel-heading overview-panel-heading"><div className="overview-panel-title"><span className="overview-section-icon blue"><Users size={17} /></span><div><h2>Assigned work</h2><p className="overview-panel-subtitle">Oldest reports needing follow-through</p></div></div><button className="text-button" onClick={() => onNavigate("Issue reports", "", "active")}>View all ({data.taskCount}) <ArrowUpRight size={15} /></button></div>
          {data.tasks.length ? <div className="overview-assigned-list" aria-label={`Oldest ${data.tasks.length} of ${data.taskCount} assigned, scheduled, and in-progress reports`}>{data.tasks.map((report) => {
            const barangay = refs.barangays.find((item) => item.id === report.barangay_id)?.name || "Iligan City";
            const organization = refs.organizations.find((org) => org.id === report.organization_id)?.name || "Assigned office";
            const assignedDate = data.assignedAt[report.id] ? formatDate(data.assignedAt[report.id]) : "Assignment date not recorded";
            return <button key={report.id} className="overview-assigned-item" onClick={() => onNavigate("Issue reports", report.id)} aria-label={`Open ${report.title}, assigned to ${organization}. ${label(report.status)}.`}>
              <ReportThumb className="overview-report-thumb" url={overviewPhotos.data?.urls.get(report.id)} categoryName={refs.categories.find((item) => item.id === report.category_id)?.name || "Other"} />
              <span className="overview-assigned-copy"><strong title={report.title}>{report.title}</strong><small>{barangay} · {organization} · {assignedDate}</small></span>
              <span className={`badge ${report.status}`}>{label(report.status)}</span><ChevronRight size={15} aria-hidden="true" />
            </button>;
          })}</div> : <div className="overview-empty compact"><ClipboardList size={19} /><strong>No assigned work</strong><span>No assigned, scheduled, or in-progress reports are available in your authorized scope.</span></div>}
        </section>
        </div>
      </div>

      <div className="two-col overview-community-panels">
        <section className="panel overview-panel">
          <div className="panel-heading overview-panel-heading"><div className="overview-panel-title"><span className="overview-section-icon violet"><CalendarDays size={17} /></span><div><h2>Meeting requests</h2><p className="overview-panel-subtitle">Community requests and their current status</p></div></div><button className="text-button" onClick={() => onNavigate("Meeting requests")}>View all <ArrowUpRight size={15} /></button></div>
          {data.meetings.length ? <div className="overview-community-list">{data.meetings.map((meeting) => (
            <button key={meeting.id} className="overview-community-row" onClick={() => onNavigate("Meeting requests", meeting.id)}>
              {data.meetingStarts[meeting.id]
                ? <span className="meeting-date-tile overview-meeting-date" aria-label={`Scheduled ${formatDate(data.meetingStarts[meeting.id])}`}><strong>{new Date(data.meetingStarts[meeting.id]).toLocaleDateString("en-PH", { day: "2-digit", timeZone: "Asia/Manila" })}</strong><small>{new Date(data.meetingStarts[meeting.id]).toLocaleDateString("en-PH", { month: "short", timeZone: "Asia/Manila" }).toUpperCase()}</small></span>
                : <span className="overview-community-icon"><CalendarDays size={17} aria-hidden="true" /></span>}<span className="overview-community-copy"><strong>{meeting.title}</strong><small>{refs.barangays.find((item) => item.id === meeting.barangay_id)?.name || "Iligan City"} · {formatDate(meeting.created_at)}</small></span><span className={`badge overview-community-status ${meeting.status}`}>{label(meeting.status)}</span><ArrowUpRight size={14} />
            </button>
          ))}</div> : <div className="overview-empty compact"><CalendarDays size={19} /><strong>No meeting requests yet</strong><span>New requests in your scope will appear here.</span></div>}
        </section>
        <section className="panel overview-panel">
          <div className="panel-heading overview-panel-heading"><div className="overview-panel-title"><span className="overview-section-icon blue"><Megaphone size={17} /></span><div><h2>Official announcements</h2><p className="overview-panel-subtitle">Published updates for your community</p></div></div><button className="text-button" onClick={() => onNavigate("Announcements")}>View all <ArrowUpRight size={15} /></button></div>
          {data.announcements.length ? <div className="overview-community-list">{data.announcements.map((announcement) => {
            const source = refs.organizations.find((item) => item.id === announcement.organization_id)?.name || refs.barangays.find((item) => item.id === announcement.barangay_id)?.name || announcement.kind;
            return <button key={announcement.id} className="overview-community-row" onClick={() => onNavigate("Announcements", announcement.id)}>
              <span className="overview-community-icon announcement"><Megaphone size={17} /></span><span className="overview-community-copy"><strong>{announcement.title}</strong><small>{source} · {formatDate(announcement.publish_at)}</small></span><ArrowUpRight size={14} />
            </button>;
          })}</div> : <div className="overview-empty compact"><Megaphone size={19} /><strong>No published announcements</strong><span>Official updates will appear here when published.</span></div>}
        </section>
      </div>
    </div>
  );
}
