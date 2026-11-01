"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell, CalendarDays, Check, Clock, FileText, MoreHorizontal, Newspaper,
  SlidersHorizontal,
} from "lucide-react";
import { db, result } from "../lib/client";
import { useAccess } from "./access-context";
import { Dialog } from "./dialog";

type Notice = {
  id: string;
  title: string;
  read_at: string | null;
  created_at: string;
  report_id: string | null;
  consultation_id: string | null;
  meeting_request_id: string | null;
  announcement_id: string | null;
};
type NoticeTab = "all" | "unread" | "announcements" | "meetings" | "system";

const tabLabels: { id: NoticeTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "announcements", label: "Announcements" },
  { id: "meetings", label: "Meetings" },
  { id: "system", label: "System" },
];

function noticeKind(notice: Notice): "announcement" | "meeting" | "system" {
  if (notice.announcement_id) return "announcement";
  if (notice.consultation_id || notice.meeting_request_id) return "meeting";
  return "system";
}
function noticeDescription(notice: Notice) {
  if (notice.announcement_id) return "An official announcement has been published for your area.";
  if (notice.consultation_id) return "A community discussion has new activity.";
  if (notice.meeting_request_id) return "A meeting request you’re connected to has an update.";
  if (notice.report_id) return "A report you follow has new activity.";
  return "There’s a new update in your workspace.";
}
function noticeDestination(notice: Notice) {
  if (notice.report_id) return ["Issue reports", notice.report_id] as const;
  if (notice.consultation_id) return ["Consultations", notice.consultation_id] as const;
  if (notice.announcement_id) return ["Announcements", notice.announcement_id] as const;
  if (notice.meeting_request_id) return ["Meeting requests", notice.meeting_request_id] as const;
  return null;
}
function formatNoticeDate(value: string) {
  return new Date(value).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function NotificationCenter({
  navigate,
}: {
  navigate: (section: string, recordId: string) => void;
}) {
  const access = useAccess(), qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [tab, setTab] = useState<NoticeTab>("all");
  const [page, setPage] = useState(0);
  const [menuId, setMenuId] = useState<string | null>(null);
  const userId = access.profile.id;

  const unreadQuery = useQuery({
    queryKey: ["staff-notifications", userId, "unread-count"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { count, error } = await db!.from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).is("read_at", null);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  const countsQuery = useQuery({
    queryKey: ["staff-notifications", userId, "category-counts"],
    enabled: open,
    refetchInterval: 30000,
    queryFn: async () => {
      const base = () => db!.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId);
      const [all, unread, announcements, meetings, system] = await Promise.all([
        base(),
        base().is("read_at", null),
        base().not("announcement_id", "is", null),
        base().or("meeting_request_id.not.is.null,consultation_id.not.is.null"),
        base().is("announcement_id", null).is("meeting_request_id", null).is("consultation_id", null),
      ]);
      const failure = [all, unread, announcements, meetings, system].find((item) => item.error);
      if (failure?.error) throw new Error(failure.error.message);
      return {
        all: all.count ?? 0,
        unread: unread.count ?? 0,
        announcements: announcements.count ?? 0,
        meetings: meetings.count ?? 0,
        system: system.count ?? 0,
      };
    },
  });
  const q = useQuery({
    queryKey: ["staff-notifications", userId, "list", unreadOnly, tab, page],
    enabled: open,
    refetchInterval: 30000,
    queryFn: async () => {
      let query = db!.from("notifications")
        .select("id,title,read_at,created_at,report_id,consultation_id,meeting_request_id,announcement_id", { count: "exact" })
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (unreadOnly || tab === "unread") query = query.is("read_at", null);
      if (tab === "announcements") query = query.not("announcement_id", "is", null);
      if (tab === "meetings") query = query.or("meeting_request_id.not.is.null,consultation_id.not.is.null");
      if (tab === "system") query = query.is("announcement_id", null).is("meeting_request_id", null).is("consultation_id", null);
      const { data, count, error } = await query.range(page * 30, page * 30 + 29);
      if (error) throw new Error(error.message);
      return { rows: data as Notice[], count: count ?? 0 };
    },
  });
  const unread = unreadQuery.data ?? 0;
  const counts = countsQuery.data;

  useEffect(() => {
    if (q.data) setPage((current) => Math.min(current, Math.max(0, Math.ceil(q.data.count / 30) - 1)));
  }, [q.data]);
  useEffect(() => {
    if (!menuId) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuId(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuId]);

  async function updateRead(notice?: Notice, read = true) {
    setBusy(true);
    setError("");
    try {
      let query = db!.from("notifications").update({ read_at: read ? new Date().toISOString() : null }).eq("user_id", userId);
      if (notice) query = query.eq("id", notice.id);
      else query = query.is("read_at", null);
      await result(query);
      await qc.invalidateQueries({ queryKey: ["staff-notifications", userId] });
      setMenuId(null);
      const destination = notice && read ? noticeDestination(notice) : null;
      if (destination) {
        navigate(destination[0], destination[1]);
        setOpen(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="secondary icon-button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        onClick={() => { setError(""); setOpen(true); }}
      >
        <Bell size={19} />
        {unread > 0 && <span className="notification-dot">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <Dialog
          title="Notification center"
          description="Stay updated with announcements, meeting updates, and important activities."
          icon={<Bell size={24} />}
          className="notification-center-dialog"
          close={() => { setOpen(false); setMenuId(null); }}
        >
          <div className="notification-center-body">
            <div className="notification-controls">
              <div className="notification-tabs" role="tablist" aria-label="Notification categories">
                {tabLabels.map((item) => (
                  <button
                    type="button" role="tab" aria-selected={tab === item.id} key={item.id}
                    className={`notification-tab${tab === item.id ? " active" : ""}`}
                    onClick={() => { setTab(item.id); setPage(0); setMenuId(null); }}
                  >
                    {item.label}<span>{counts ? counts[item.id] : "—"}</span>
                  </button>
                ))}
              </div>
              <div className="notification-actions">
                <button type="button" className="secondary notification-mark-read" disabled={busy || !unread || unreadQuery.isError} onClick={() => void updateRead()}>
                  <Check size={17} />{busy ? "Updating…" : "Mark all as read"}
                </button>
                <label className="notification-unread-toggle">
                  <input type="checkbox" checked={unreadOnly} disabled={busy} onChange={(event) => { setUnreadOnly(event.target.checked); setPage(0); }} />
                  <span>Unread only</span>
                </label>
              </div>
            </div>

            {(q.error || unreadQuery.error || countsQuery.error || error) && (
              <div className="notification-error" role="alert">
                <p>{q.error?.message || countsQuery.error?.message || unreadQuery.error?.message || error}</p>
                <button type="button" className="secondary" disabled={busy} onClick={() => { setError(""); void q.refetch(); void unreadQuery.refetch(); void countsQuery.refetch(); }}>Retry</button>
              </div>
            )}
            <div className="notification-list" aria-live="polite">
              {q.isPending ? (
                <div className="notification-loading" role="status"><span /><span /><span /></div>
              ) : q.error ? null : !q.data?.rows.length ? (
                <div className="notification-empty">
                  <span className="notification-empty-icon"><SlidersHorizontal size={22} /></span>
                  <strong>{unreadOnly || tab === "unread" ? "You’re all caught up" : "No notifications here yet"}</strong>
                  <span>{unreadOnly || tab === "unread" ? "New updates will appear here when they arrive." : "Report, meeting, and announcement updates will appear here."}</span>
                </div>
              ) : q.data.rows.map((notice) => {
                const kind = noticeKind(notice);
                const Icon = kind === "announcement" ? Newspaper : kind === "meeting" ? CalendarDays : FileText;
                return (
                  <article className={`notification-item ${kind}${notice.read_at ? " read" : " unread"}`} key={notice.id}>
                    <button type="button" className="notification-item-main" disabled={busy} onClick={() => void updateRead(notice)}>
                      <span className="notification-item-icon"><Icon size={23} /></span>
                      <span className="notification-item-copy">
                        <strong>{notice.title}</strong>
                        <span>{noticeDescription(notice)}</span>
                        <small><Clock size={14} />{formatNoticeDate(notice.created_at)}</small>
                      </span>
                    </button>
                    <div className="notification-item-end">
                      {!notice.read_at && <><span className="notification-unread-dot" aria-label="Unread" /><span className="notification-new">New</span></>}
                      <div className="notification-more-wrap">
                        <button type="button" className="notification-more" aria-label={`More actions for ${notice.title}`} aria-expanded={menuId === notice.id} disabled={busy} onClick={() => setMenuId(menuId === notice.id ? null : notice.id)}>
                          <MoreHorizontal size={20} />
                        </button>
                        {menuId === notice.id && (
                          <div className="notification-more-menu" role="menu">
                            <button type="button" role="menuitem" disabled={busy} onClick={() => void updateRead(notice, !notice.read_at)}>
                              <Check size={15} />Mark as {notice.read_at ? "unread" : "read"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="notification-pagination">
              <span>Page {page + 1}{q.data ? ` of ${Math.max(1, Math.ceil(q.data.count / 30))}` : ""}</span>
              <div>
                <button type="button" className="secondary" disabled={busy || q.isFetching || !page} onClick={() => setPage(page - 1)}>Previous</button>
                <button type="button" className="secondary" disabled={busy || q.isFetching || !q.data || (page + 1) * 30 >= q.data.count} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
