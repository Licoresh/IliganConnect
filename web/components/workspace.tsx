"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import {
  Activity,
  Search,
  RefreshCw,
  ArrowRight,
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
  MessageCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { db, result, configured } from "../lib/client";
import { Profile, Report, Lookup, label } from "@community/shared";
import dynamic from "next/dynamic";
import { Community } from "./community";
import { Analytics, Charts, AnalyticsData } from "./analytics";
import { Administration } from "./administration";
import { SettingsPanel } from "./settings";
import { Reports } from "./reports";
import { AccessContext, useAccess } from "./access-context";
import {
  StaffContext,
  roleNames,
  canPrioritize,
  canOpenSection,
  permissionFingerprint,
} from "../lib/access";
import { NotificationCenter } from "./notification-center";
import { readWorkspaceLocation, shouldResetWorkspace, workspaceLocationUrl, type WorkspaceLocation } from "../lib/workspace-location";
import { barangayAreaKm2, barangayMapKey, iliganBarangayBoundaries } from "../../app/lib/barangay-map";
import { pointInPolygon } from "../lib/map-geometry";
import { reportCategoryPresentation, ReportCategoryLabel } from "./report-category";
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
  ["Issue Mapping & Heatmap", MapPinned],
  ["Geographic analytics", ChartNoAxesCombined],
  ["Consultations", MessageSquare],
  ["Meeting requests", Users],
  ["Announcements", Megaphone],
  ["Administration", Settings],
  ["Settings", Settings],
] as const;
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
  const identity = useRef<string | null>(null),
    permissionStamp = useRef("");
  const menuButton = useRef<HTMLButtonElement>(null),
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
    const desktop = window.matchMedia("(min-width: 1024px)");
    const resize = () => {
      if (desktop.matches) setDrawer(false);
    };
    desktop.addEventListener("change", resize);
    document.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", keys);
      desktop.removeEventListener("change", resize);
    };
  }, [drawer]);
  const refs = useQuery({
    queryKey: ["refs", session],
    enabled: !!access.data?.authorized,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [categories, barangays, organizations, settings] = await Promise.all([
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
      ]);
      return { categories, barangays, organizations, includeSamples: settings.include_samples };
    },
  });
  const coordinate = (next: string, id: string) => {
    setRecordTarget((target) => ({ id: "", revision: target.revision + 1 }));
    setScope(id);
    setSection(next);
    recordEntry.current = false;
    focusPageTitle.current = true;
    writeWorkspaceLocation({ section: next, scope: id, recordId: "", queue: "all" });
  };
  const navigate = (next: string, recordId = "", queue = "all") => {
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
          <p className="eyebrow">COMMUNITY OPERATIONS</p>
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
          <span className="eyebrow">WELCOME BACK</span>
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
  return (
    <AccessContext.Provider value={context}>
      <div className="shell">
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
            <Image src="/iligan-connect-logo.png" alt="" aria-hidden="true" width={34} height={34} /> ILIGAN <b>CONNECT</b>
          </a>
          <div className="workspace-edition"><span /> LOCAL ACTION · STRONGER ILIGAN</div>
          <nav aria-label="Main navigation">
            {[
              { title: "Community operations", items: nav.slice(0, 4) },
              { title: "Community", items: [...nav.slice(4, 6), nav[6]] },
              { title: "System", items: nav.slice(7, 8) },
              { title: "Account", items: nav.slice(8) },
            ].map((group) => {
              const items = group.items.filter(([n]) => availableSection(n));
              return items.length ? <div className="nav-group" key={group.title}>
                <p className="nav-caption">{group.title}</p>
                {items.map(([n, Icon]) => <button key={n} className={visibleSection === n ? "active" : ""}
                  aria-current={visibleSection === n ? "page" : undefined} onClick={() => navigate(n)}>
                  <Icon size={18} /><span>{n === "Issue Mapping & Heatmap" ? "Mapping & heatmap" : n}</span>
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
          <main id="main" className={visibleSection === "Overview" || visibleSection === "Issue Mapping & Heatmap" ? "overview-main" : visibleSection === "Issue reports" ? "reports-main" : undefined} tabIndex={-1}>
            <div className="page-heading">
              {visibleSection === "Overview" ? (
                <>
                  <div className="overview-heading-copy">
                    <p className="eyebrow">REPORTING &amp; COORDINATION</p>
                    <h1 ref={pageTitle} tabIndex={-1} className="overview-heading-title">
                      {profile.data.role === "barangay"
                        ? `${jurisdiction} dashboard`
                        : profile.data.role === "admin"
                          ? "Iligan City dashboard"
                          : `${context.organizations[0]?.name || "Office"} dashboard`}
                    </h1>
                    <p className="overview-heading-subtitle">Local concerns, shared priorities. Your community at a glance.</p>
                  </div>
                </>
              ) : visibleSection === "Issue Mapping & Heatmap" ? <>
                <div className="overview-heading-copy">
                  <p className="eyebrow">REPORTING &amp; COORDINATION</p>
                  <h1 ref={pageTitle} tabIndex={-1} className="overview-heading-title">Issue mapping &amp; heatmap</h1>
                  <p className="overview-heading-subtitle">Explore reported concerns and identify patterns in your authorized area.</p>
                </div>
              </> : <>
                <div>
                  <p className="eyebrow">{visibleSection === "Settings" ? "ACCOUNT" : visibleSection === "Consultations" ? "COMMUNITY ENGAGEMENT" : "REPORTING & COORDINATION"}</p>
                  <h1 ref={pageTitle} tabIndex={-1}>{visibleSection}</h1>
                  <p>{({
                    "Issue reports": "Review evidence, route responsibility and keep each case moving.",
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
            ) : section === "Issue reports" ? (
              <Reports refs={refs.data!} initialRecordId={recordTarget.id} initialBarangay={scope} initialQueue={reportQueue}
                onOpenReport={(id, queue) => navigate("Issue reports", id, queue)} onCloseReport={closeReport} />
            ) : section === "Issue Mapping & Heatmap" ? (
              <IssueMap
                key={scope}
                refs={refs.data!}
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
            ILIGAN CONNECT <span>Human assessment informs every action.</span>
          </footer>
        </div>
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
      const densityQuery = access.profile.role === "barangay" && access.profile.barangay_id
        ? result<Pick<Report, "latitude" | "longitude" | "status" | "verified_at">[]>(
            db!.from("reports")
              .select("latitude,longitude,status,verified_at")
              .eq("barangay_id", access.profile.barangay_id)
              .order("created_at", { ascending: false }),
          ).catch(() => null)
        : Promise.resolve(null);
      const [analytics, recent, taskResult, meetings, announcements, densityReports] = await Promise.all([
        result<AnalyticsData>(db!.rpc("geographic_analytics")),
        result<Report[]>(
          db!.from("reports").select("*").order("created_at", { ascending: false }).limit(10),
        ),
        (async () => {
          const { data, count, error } = await db!.from("reports").select("*", { count: "exact" })
            .in("status", ["assigned", "in_progress"]).order("created_at").limit(5);
          if (error) throw new Error(error.message);
          return { rows: data as Report[], count: count ?? 0 };
        })(),
        result<{ id: string; title: string; barangay_id: string; status: string; created_at: string }[]>(
          db!.from("meeting_requests").select("id,title,barangay_id,status,created_at").order("created_at", { ascending: false }).limit(5),
        ),
        result<{ id: string; title: string; kind: string; publish_at: string; barangay_id: string | null; organization_id: string | null }[]>(
          db!.from("announcements").select("id,title,kind,publish_at,barangay_id,organization_id").eq("status", "published").lte("publish_at", new Date().toISOString()).order("publish_at", { ascending: false }).limit(5),
        ),
        densityQuery,
      ]);
      const tasks = taskResult.rows;
      const history = tasks.length
        ? await result<{ report_id: string; created_at: string }[]>(
            db!.from("report_status_history").select("report_id,created_at").in("report_id", tasks.map((report) => report.id)).eq("new_status", "assigned").order("created_at", { ascending: false }),
          )
        : [];
      const assignedAt: Record<string, string> = {};
      for (const event of history) assignedAt[event.report_id] ??= event.created_at;
      return { analytics, recent, tasks, taskCount: taskResult.count, meetings, announcements, assignedAt, densityReports };
    },
  });

  if (q.isPending) return (
    <div className="overview-loading" role="status" aria-label="Loading your dashboard">
      <div className="metrics overview-metrics">{[1, 2, 3, 4, 5, 6].map((n) => <div key={n} className="skeleton metric" />)}</div>
      <div className="overview-geography-skeleton"><div className="skeleton overview-map-skeleton" /><div className="skeleton overview-steps-skeleton" /></div>
      <div className="overview-lower-skeleton"><div className="skeleton overview-list-skeleton" /><div className="skeleton overview-list-skeleton" /></div>
      <div className="skeleton overview-wide-skeleton" />
      <div className="overview-lower-skeleton"><div className="skeleton overview-chart-skeleton" /><div className="skeleton overview-chart-skeleton" /></div>
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
  const barangayName = refs.barangays.find((b) => b.id === access.profile.barangay_id)?.name;
  const barangayBoundary = access.profile.role === "barangay" && barangayName
    ? iliganBarangayBoundaries.find((feature) => barangayMapKey(feature.properties.adm4_en) === barangayMapKey(barangayName)) ?? null
    : null;
  const barangayArea = barangayBoundary ? barangayAreaKm2(barangayBoundary) : 0;
  const activeDensityReports = data.densityReports?.filter((report) => report.status !== "rejected" && report.status !== "duplicate") ?? [];
  const mappedDensityReports = barangayBoundary
    ? activeDensityReports.filter((report) => pointInPolygon([report.longitude, report.latitude], barangayBoundary.geometry))
    : [];
  const densityOutsideCount = Math.max(0, activeDensityReports.length - mappedDensityReports.length);
  const unresolvedDensityCount = mappedDensityReports.filter((report) => report.verified_at && !["resolved", "rejected", "duplicate"].includes(report.status)).length;
  const reportDensity = barangayArea > 0 ? activeDensityReports.length / barangayArea : null;
  const scopeName = access.profile.role === "barangay"
    ? barangayName || "Assigned barangay"
    : access.profile.role === "admin"
      ? "Citywide administration"
      : access.organizations.map((o) => o.name).join(" · ") || "Authorized office coverage";
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
  const topBarangays = [...data.analytics.barangays].filter((item) => item.unresolved > 0)
    .sort((a, b) => b.unresolved - a.unresolved).slice(0, 10);
  const attentionMax = Math.max(1, ...topBarangays.map((item) => item.unresolved));
  const focusCategories = data.analytics.categories.filter((item) => item.received > 0).sort((a, b) => b.received - a.received);
  const focusCategoryMax = Math.max(1, ...focusCategories.map((item) => item.received));

  return (
    <div className="overview">
      <div className="dashboard-brief overview-scope">
        <div className="overview-scope-copy"><span className="overview-scope-icon"><ShieldCheck size={17} /></span><span><b>{scopeName}</b> · Authorized records</span></div>
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

      <div className="dashboard-geography overview-geography">
        <section className="panel dashboard-map overview-map-panel">
          <div className="panel-heading overview-panel-heading">
            <div><p className="eyebrow">YOUR GEOGRAPHIC WORKSPACE</p><h2>Issue mapping &amp; heatmap</h2><p className="overview-panel-subtitle">Explore reported concerns and identify patterns in your authorized area.</p></div>
            <button className="secondary" onClick={() => onNavigate("Issue Mapping & Heatmap")}>Open full workspace <ArrowUpRight size={16} /></button>
          </div>
          <IssueMap refs={refs} compact overview initialMode="heat" initialBarangay={access.profile.role === "barangay" ? access.profile.barangay_id || "" : ""} />
        </section>

        <aside className="panel attention-panel overview-steps">
          <div className="overview-steps-heading"><span className="overview-section-icon mint"><ChartNoAxesCombined size={17} /></span><div><p className="eyebrow">NEXT STEPS</p><h2>Where to focus</h2></div></div><p className="muted">A practical starting point for your team.</p>
          <button className="overview-step" onClick={() => onNavigate("Issue reports", "", "review")}>
            <span className="overview-step-icon amber"><Clock3 size={18} /></span><span><strong>Review incoming reports</strong><small>Check new submissions and confirm the concern</small></span><b>{counts.review ?? 0}</b><ArrowRight size={15} />
          </button>
          <button className="overview-step" onClick={() => onNavigate("Issue reports", "", "active")}>
            <span className="overview-step-icon blue"><ClipboardList size={18} /></span><span><strong>Follow up assigned work</strong><small>Move open cases toward resolution</small></span><ArrowRight size={15} />
          </button>
          <button className="overview-step" onClick={() => onNavigate("Geographic analytics")}>
            <span className="overview-step-icon teal"><Activity size={18} /></span><span><strong>Assess recurring concerns</strong><small>Candidates for human review</small></span><b>{counts.recurring ?? 0}</b><ArrowRight size={15} />
          </button>
          <button className="overview-step" onClick={() => onNavigate("Consultations")}>
            <span className="overview-step-icon mint"><MessageCircle size={18} /></span><span><strong>Plan community engagement</strong><small>Coordinate consultations and meetings</small></span><ArrowRight size={15} />
          </button>
          <button className="overview-step" onClick={() => onNavigate("Geographic analytics")}>
            <span className="overview-step-icon violet"><MapPinned size={18} /></span><span><strong>{canPrioritize(access) ? "Review barangay priorities" : "Review geographic patterns"}</strong><small>{canPrioritize(access) ? "Compare report counts and advisory scores" : "Explore patterns in your permitted area"}</small></span><ArrowRight size={15} />
          </button>
          <section className="overview-category-focus" aria-label="Reports by category">
            <div className="overview-category-focus-heading"><div><p className="eyebrow">ISSUE MIX</p><h3>Reports by category</h3></div><span>{focusCategories.reduce((total, item) => total + item.received, 0)} total</span></div>
            {focusCategories.length ? <ul className="overview-category-focus-list">{focusCategories.map((item) => (
              <li className="overview-category-focus-row" key={item.name}>
                <div className="overview-category-focus-copy"><ReportCategoryLabel name={item.name} compact /><strong>{item.received}</strong><small>{item.verified} verified</small></div>
                <div className="overview-category-focus-track" aria-hidden="true"><span style={{ width: `${(item.received / focusCategoryMax) * 100}%`, backgroundColor: reportCategoryPresentation(item.name).foreground }} /></div>
              </li>
            ))}</ul> : <p className="overview-category-focus-empty">No report categories are available for this area.</p>}
            <button className="text-button overview-category-focus-link" onClick={() => onNavigate("Geographic analytics")}>View geographic analytics <ArrowUpRight size={14} /></button>
          </section>
          <div className="assessment-note"><Activity size={17} /><p>Report frequency reflects participation, not confirmed problem prevalence. Human review informs every priority.</p></div>
        </aside>
      </div>

      <div className="two-col overview-reporting">
        <section className="panel overview-panel">
          <div className="panel-heading overview-panel-heading"><div className="overview-panel-title"><span className="overview-section-icon blue"><FileText size={17} /></span><div><h2>Recent reports</h2><p className="overview-panel-subtitle">Latest submissions visible in your scope</p></div></div><button className="text-button" onClick={() => onNavigate("Issue reports")}>View all reports <ArrowUpRight size={15} /></button></div>
          {data.recent.length ? <div className="table-scroll overview-table-wrap"><table className="overview-table overview-recent-table">
            <caption className="sr-only">Most recent reports in your authorized scope</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Title</th><th scope="col">Category</th><th scope="col">Date</th><th scope="col">Status</th></tr></thead>
            <tbody>{data.recent.map((report) => {
              const category = refs.categories.find((item) => item.id === report.category_id)?.name || "Other";
              const barangay = refs.barangays.find((item) => item.id === report.barangay_id)?.name || "Iligan City";
              return <tr key={report.id}>
                <td data-label="#"><span className="overview-report-id">#{report.id.slice(0, 4).toUpperCase()}</span></td>
                <td data-label="Title"><div className="overview-report-title-cell"><span className="overview-report-file"><FileText size={15} aria-hidden="true" /></span><span className="overview-report-copy"><button className="overview-report-link" title={report.title} onClick={() => onNavigate("Issue reports", report.id)}>{report.title}</button><small>{barangay} · {formatDate(report.created_at)}</small></span></div></td>
                <td data-label="Category"><ReportCategoryLabel name={category} compact className="overview-category" /></td>
                <td data-label="Date" className="overview-date">{formatDate(report.created_at)}</td>
                <td data-label="Status"><span className={`badge ${report.status}`}>{label(report.status)}</span></td>
              </tr>;
            })}</tbody>
          </table></div> : <div className="overview-empty"><FileText size={20} /><strong>No reports yet</strong><span>Resident submissions will appear here.</span></div>}
        </section>

        <div className="overview-reporting-aside">
        {access.profile.role === "barangay" ? <section className="panel overview-panel overview-density">
          <div className="panel-heading overview-panel-heading"><div className="overview-panel-title"><span className="overview-section-icon mint"><MapPinned size={17} /></span><div><h2>Local report density</h2><p className="overview-panel-subtitle">Reports assigned to {barangayName || "your barangay"}</p></div></div></div>
          {!access.profile.barangay_id ? <div className="overview-density-unavailable" role="status"><CircleAlert size={18} /><span>This staff account has no assigned barangay, so report density is unavailable.</span></div>
            : data.densityReports === null ? <div className="overview-density-unavailable" role="status"><CircleAlert size={18} /><span>Report locations couldn’t load. Refresh the dashboard to try again.</span></div>
            : !barangayBoundary || reportDensity === null ? <div className="overview-density-unavailable" role="status"><MapPinned size={18} /><span>A mapped boundary isn’t available for this barangay, so density can’t be calculated.</span></div>
              : <>
                <div className="overview-density-primary"><div><span className="overview-density-label">ASSIGNED REPORTS PER SQUARE KILOMETER</span><strong>{reportDensity.toFixed(1)}</strong><span className="overview-density-unit">reports / km²</span></div><div className="overview-density-area"><span>Mapped area</span><strong>{barangayArea.toFixed(2)} km²</strong></div></div>
                <div className="overview-density-stats" aria-label="Report totals for this barangay">
                  <div><span>Assigned reports</span><strong>{activeDensityReports.length.toLocaleString("en-PH")}</strong></div>
                  <div><span>Inside boundary</span><strong>{mappedDensityReports.length.toLocaleString("en-PH")}</strong></div>
                  <div><span>Verified unresolved</span><strong>{unresolvedDensityCount.toLocaleString("en-PH")}</strong></div>
                </div>
                {densityOutsideCount > 0 ? <div className="overview-density-warning" role="status"><CircleAlert size={17} /><p><strong>{densityOutsideCount} assigned {densityOutsideCount === 1 ? "report is" : "reports are"} outside the mapped boundary.</strong><span>They remain in this barangay’s assigned total but won’t appear on the map until their locations are corrected.</span></p><button className="secondary" onClick={() => onNavigate("Issue reports")}>Review locations <ArrowRight size={14} /></button></div>
                  : <p className="overview-density-ok"><BadgeCheck size={15} />All mapped report locations are inside {barangayName || "your barangay"}.</p>}
                <p className="overview-fine">Rejected and duplicate reports are excluded. This assigned-area ratio shows report volume, not issue severity.</p>
                {activeDensityReports.length >= 1000 && <p className="overview-density-limit">The report list reached its 1,000-row limit; density may be understated.</p>}
              </>}
          <button className="secondary overview-attention-action" onClick={() => onNavigate("Issue reports")}>Open barangay reports <ArrowUpRight size={15} /></button>
        </section> : <section className="panel overview-panel overview-attention">
          <div className="panel-heading overview-panel-heading"><div className="overview-panel-title"><span className="overview-section-icon mint"><ChartNoAxesCombined size={17} /></span><div><h2>Barangay attention</h2><p className="overview-panel-subtitle">Verified, unresolved issues</p></div></div></div>
          {topBarangays.length ? <div className="overview-attention-list">{topBarangays.map((barangay) => (
            <div className="overview-attention-row" key={barangay.id}>
              <div><span>{barangay.name}</span><strong>{barangay.unresolved}</strong></div>
              <div className="overview-attention-track" role="img" aria-label={`${barangay.unresolved} verified unresolved reports`}><span style={{ width: `${(barangay.unresolved / attentionMax) * 100}%` }} /></div>
            </div>
          ))}</div> : <div className="overview-empty compact"><BadgeCheck size={19} /><strong>No verified issues to review</strong><span>There are no unresolved verified reports in your scope.</span></div>}
          <p className="overview-fine">{counts.recurring ?? 0} recurrence candidates need human review. Report counts do not establish severity.</p>
          <button className="secondary overview-attention-action" onClick={() => onNavigate("Geographic analytics")}>Review assessment factors <ArrowUpRight size={15} /></button>
        </section>}
        </div>
      </div>

        <section className="panel overview-panel overview-assigned">
          <div className="panel-heading overview-panel-heading"><div className="overview-panel-title"><span className="overview-section-icon blue"><Users size={17} /></span><div><h2>Assigned work</h2><p className="overview-panel-subtitle">Oldest reports needing follow-through</p></div></div><button className="text-button" onClick={() => onNavigate("Issue reports", "", "active")}>View all ({data.taskCount}) <ArrowUpRight size={15} /></button></div>
          {data.tasks.length ? <div className="overview-assigned-list" aria-label={`Oldest ${data.tasks.length} of ${data.taskCount} assigned and in-progress reports`}>{data.tasks.map((report) => {
            const barangay = refs.barangays.find((item) => item.id === report.barangay_id)?.name || "Iligan City";
            const organization = refs.organizations.find((org) => org.id === report.organization_id)?.name || "Assigned office";
            const assignedDate = data.assignedAt[report.id] ? formatDate(data.assignedAt[report.id]) : "Assignment date not recorded";
            return <button key={report.id} className="overview-assigned-item" onClick={() => onNavigate("Issue reports", report.id)} aria-label={`Open ${report.title}, assigned to ${organization}. ${label(report.status)}.`}>
              <span className="overview-report-file"><FileText size={15} aria-hidden="true" /></span>
              <span className="overview-assigned-copy"><strong title={report.title}>{report.title}</strong><small>{barangay} · {organization} · {assignedDate}</small></span>
              <span className={`badge ${report.status}`}>{label(report.status)}</span><ChevronRight size={15} aria-hidden="true" />
            </button>;
          })}</div> : <div className="overview-empty compact"><ClipboardList size={19} /><strong>No assigned work</strong><span>No assigned or in-progress reports are available in your authorized scope.</span></div>}
        </section>

      <Charts data={data.analytics} />

      <div className="two-col overview-community-panels">
        <section className="panel overview-panel">
          <div className="panel-heading overview-panel-heading"><div className="overview-panel-title"><span className="overview-section-icon violet"><CalendarDays size={17} /></span><div><h2>Meeting requests</h2><p className="overview-panel-subtitle">Community requests and their current status</p></div></div><button className="text-button" onClick={() => onNavigate("Meeting requests")}>View all <ArrowUpRight size={15} /></button></div>
          {data.meetings.length ? <div className="overview-community-list">{data.meetings.map((meeting) => (
            <button key={meeting.id} className="overview-community-row" onClick={() => onNavigate("Meeting requests", meeting.id)}>
              <span className="overview-community-icon"><CalendarDays size={17} /></span><span className="overview-community-copy"><strong>{meeting.title}</strong><small>{refs.barangays.find((item) => item.id === meeting.barangay_id)?.name || "Iligan City"} · {formatDate(meeting.created_at)}</small></span><span className={`badge overview-community-status ${meeting.status}`}>{label(meeting.status)}</span><ArrowUpRight size={14} />
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
