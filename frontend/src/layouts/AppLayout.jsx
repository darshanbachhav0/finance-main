import { Suspense } from "react";
import MotionSurface from "../components/MotionSurface.jsx";
import WorkspaceSkeleton from "../components/WorkspaceSkeleton.jsx";
import { Bell, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, LogOut, Menu, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import useNotificationBell from "../hooks/useNotificationBell.js";
import { notificationMessage, notificationTitle } from "../utils/notificationText.js";
import CommandPalette from "../components/CommandPalette.jsx";
import MyLeavePanel from "../components/MyLeavePanel.jsx";
import UmaBrand from "../components/UmaBrand.jsx";
import ThemeControl from "../components/ThemeControl.jsx";
import LanguageToggle from "../components/LanguageToggle.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { SIDEBAR_DRAWER_QUERY } from "../utils/breakpoints.js";
import { toneOf } from "../utils/tones.js";
import { formatDate } from "../utils/formatters.js";
import MobileBottomNav from "../components/MobileBottomNav.jsx";
import { bottomNavigationForUser, counterBadgeText, groupNavigation, navigationCount, navigationForUser, pageLabel, pageTrail, settingsPagesFor } from "../utils/navigationAccess.js";
import { navigationIcon } from "../utils/navigationIcons.js";

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { t, language } = useLanguage();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("erp_sidebar_collapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobile = useMediaQuery(SIDEBAR_DRAWER_QUERY);
  const managementViewer = user.role === "ManagementViewer";
  const { tasks, notifications, error: notificationError, refresh: loadTasks, markRead: markNotificationRead, markAllRead, dismiss: dismissNotification } = useNotificationBell(user._id, !managementViewer);
  const [taskOpen, setTaskOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const menusRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const sidebarRef = useRef(null);
  const mobileBackdrop = useAnimatedPresence(mobileOpen, 180);

  const pendingApprovals = Number(tasks.counters?.approval) || 0;
  // Grouped into fixed sections (Overview, My work, Payables, Treasury, Accounting, Planning and
  // reports, Master Data) so every role reads the menu the same way.
  const visibleGroups = useMemo(() => groupNavigation(navigationForUser(user, { pendingApprovals }).map(([label, path]) => ({ label, path, icon: navigationIcon(path) }))), [user, pendingApprovals > 0]);
  // The palette also finds every Settings page the person can open, not only the menu entries.
  const commandPages = useMemo(() => {
    const pages = visibleGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
    const settings = settingsPagesFor(user).filter((path) => !pages.some((item) => item.path === path)).map((path) => ({ label: pageLabel(path, user.role), path, icon: navigationIcon(path), group: "Settings" }));
    return [...pages, ...settings];
  }, [visibleGroups, user]);
  const bottomItems = useMemo(() => bottomNavigationForUser(user, { pendingApprovals }).map((item) => ({ ...item, icon: navigationIcon(item.path) })), [user, pendingApprovals > 0]);
  // "3 pendientes": the badge's spoken form, also added to the link's name (the collapsed
  // sidebar hides the text label, so the badge must not be the only place the count lives).
  const pendingLabel = (count) => t(count === 1 ? "{count} pending item" : "{count} pending items").replace("{count}", count > 99 ? "99+" : count);
  const openCommandPalette = () => { setTaskOpen(false); setUserOpen(false); setMobileOpen(false); setCommandOpen(true); };

  const trail = useMemo(() => pageTrail(location.pathname, user), [location.pathname, user]);
  const pageTitle = trail[trail.length - 1].label;
  // The menu entry for this page: the page itself, else its nearest ancestor in the trail
  // (a request opens under Requests, a settings page under Settings).
  const menuPaths = visibleGroups.flatMap((group) => group.items.map((item) => item.path));
  const activePath = [location.pathname, ...trail.map((item) => item.path).filter(Boolean).reverse()].find((path) => menuPaths.includes(path));

  useEffect(() => {
    setMobileOpen(false);
    setTaskOpen(false);
    setUserOpen(false);
    loadTasks();
  }, [location.pathname, location.search, loadTasks]);

  useEffect(() => { document.title = `${t(pageTitle)} · UMA`; }, [pageTitle, t]);

  useEffect(() => {
    const closeMenus = (event) => !menusRef.current?.contains(event.target) && (setTaskOpen(false), setUserOpen(false));
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    const openCommand = (event) => {
      const target = event.target;
      const isEditing = target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setTaskOpen(false);
        setUserOpen(false);
        setCommandOpen(true);
      } else if (event.key === "/" && !isEditing) {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", openCommand);
    return () => window.removeEventListener("keydown", openCommand);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sidebar = sidebarRef.current;
    const focusable = () => [...(sidebar?.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])].filter((item) => item.offsetParent !== null);
    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus({ preventScroll: true }));
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        window.requestAnimationFrame(() => mobileMenuRef.current?.focus({ preventScroll: true }));
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      localStorage.setItem("erp_sidebar_collapsed", String(!current));
      return !current;
    });
  }

  return (
    <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " mobile-nav-open" : ""}`}>
      <a className="skip-link" href="#main-content">{t("Skip to main content")}</a>
      {mobileBackdrop.shouldRender && <button type="button" className={`mobile-nav-backdrop motion-${mobileBackdrop.phase}`} onClick={() => { setMobileOpen(false); window.requestAnimationFrame(() => mobileMenuRef.current?.focus({ preventScroll: true })); }} aria-label={t("Close navigation")} />}
      <aside ref={sidebarRef} className="sidebar" aria-label={t("Primary navigation")} inert={mobile && !mobileOpen ? "" : undefined}>
        <div className="brand">
          <Link to="/" aria-label={t("UMA home")}><UmaBrand /></Link>
          <button type="button" className="icon-button sidebar-mobile-close" onClick={() => { setMobileOpen(false); window.requestAnimationFrame(() => mobileMenuRef.current?.focus({ preventScroll: true })); }} aria-label={t("Close navigation")}><X size={19} /></button>
        </div>

        <nav className="nav-groups" aria-label={t("Main navigation")}>
          {visibleGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{t(group.label)}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                const count = navigationCount(item.path, tasks.counters);
                const name = count > 0 ? `${t(item.label)} (${pendingLabel(count)})` : t(item.label);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`nav-item${item.path === activePath ? " active" : ""}`}
                    aria-current={item.path === activePath ? "page" : undefined}
                    data-tooltip={name}
                    aria-label={name}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-label">{t(item.label)}</span>
                    {count > 0 && <span className="nav-counter" aria-hidden="true">{counterBadgeText(count)}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <button type="button" className="sidebar-collapse" onClick={toggleCollapsed} aria-label={t(collapsed ? "Expand sidebar" : "Collapse sidebar")}>
          {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          <span>{t("Collapse sidebar")}</span>
        </button>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button ref={mobileMenuRef} type="button" className="icon-button mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label={t("Open navigation")}><Menu size={20} /></button>
            {/* The page's own header carries its title; the bar shows where the page sits. */}
            <nav className="breadcrumbs" aria-label={t("Breadcrumbs")}>
              <ol>
                {trail.map((item, index) => {
                  // On phones the bar keeps a back link to the parent page (not to the dashboard).
                  const parent = index > 0 && index === trail.length - 2;
                  return (
                    <li key={`${index}-${item.label}`} className={item.path ? `breadcrumb-link${parent ? " breadcrumb-parent" : ""}` : "breadcrumb-current"}>
                      {item.path ? <Link to={item.path}>{t(item.label)}</Link> : <span aria-current="page">{t(item.label)}</span>}
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>

          <div className="topbar-actions" ref={menusRef}>
            {!managementViewer && <button type="button" className="command-trigger" onClick={() => setCommandOpen(true)} aria-label={t("Search the system")} aria-keyshortcuts="Control+K Meta+K">
              <Search size={16} /><span>{t("Search")}</span><kbd>Ctrl K</kbd>
            </button>}
            <LanguageToggle />
            {!managementViewer && <div className="topbar-menu">
              <button type="button" className="icon-button notification-button" onClick={() => { if (!taskOpen) loadTasks(); setTaskOpen((current) => !current); setUserOpen(false); }} aria-label={t("Open task notifications")} aria-expanded={taskOpen}>
                <Bell size={19} />
                {notifications.unreadCount > 0 ? <span className="notification-dot" aria-live="polite" aria-label={t(notifications.unreadCount === 1 ? "{count} unread notification" : "{count} unread notifications").replace("{count}", notifications.unreadCount)}>{notifications.unreadCount > 99 ? "99+" : notifications.unreadCount}</span> : tasks.total > 0 && <span className="notification-dot" aria-label={t("Pending tasks")}>•</span>}
              </button>
              {taskOpen && (
                <div className="topbar-popover task-popover">
                  <div className="popover-heading">
                    <strong>{t("Tasks and alerts")}</strong>
                    <span>{t(notifications.unreadCount === 1 ? "{count} unread notification" : "{count} unread notifications").replace("{count}", notifications.unreadCount)}</span>
                  </div>
                  {notificationError && <p className="popover-empty" role="status">{t(notificationError)} <button type="button" className="text-button" onClick={loadTasks}>{t("Retry")}</button></p>}
                  <div className="task-list">
                    <div className="notification-list-heading"><strong>{t("Notifications")}</strong>{notifications.unreadCount > 0 && <button type="button" className="text-button" onClick={markAllRead}>{t("Mark all read")}</button>}</div>
                    {notifications.data.map((item) => (
                      <div key={item._id} className="notification-row">
                      <Link to={item.path || "/"} className={`task-item notification-item${item.readAt ? " is-read" : ""}`} onClick={() => { setTaskOpen(false); markNotificationRead(item); }}>
                        <span className={`task-indicator tone-${item.type === "SLA_ESCALATION" || item.type === "SLA_OVERDUE" ? "danger" : item.type === "SLA_DUE_SOON" ? "warning" : item.readAt ? "neutral" : "accent"}`} />
                        <span><strong>{notificationTitle(t, item)}</strong><small>{notificationMessage(t, item)}</small></span>
                      </Link>
                      <span className="notification-row-actions">
                        {!item.readAt && <button type="button" className="icon-button quiet" title={t("Mark read")} aria-label={t("Mark read")} onClick={() => markNotificationRead(item)}><Check size={15} /></button>}
                        <button type="button" className="icon-button quiet" title={t("Mark done")} aria-label={t("Mark done")} onClick={() => dismissNotification(item)}><X size={15} /></button>
                      </span>
                      </div>
                    ))}
                    {!notifications.data.length && !notificationError && <p className="popover-empty">{t("No notifications yet.")}</p>}
                    <div className="notification-list-heading"><strong>{t("Pending tasks")}</strong></div>
                    {tasks.items.filter((item) => item.count > 0).map((item) => (
                      <Link key={item.key} to={item.path} className="task-item">
                        <span className={`task-indicator tone-${toneOf(item.tone)}`} />
                        <span>{t(item.label)}</span>
                        <strong>{item.count}</strong>
                      </Link>
                    ))}
                    {!tasks.items.some((item) => item.count > 0) && <p className="popover-empty">{t("No pending tasks.")}</p>}
                  </div>
                </div>
              )}
            </div>}

            <div className="topbar-menu">
              <button type="button" className="user-menu-button" aria-label={t("Account menu")} onClick={() => { setUserOpen((current) => !current); setTaskOpen(false); }} aria-expanded={userOpen}>
                <span className="user-avatar">{user.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
                <span className="user-summary" title={`${user.name} · ${t(user.role)} · ${user.area || ""}`}><strong>{user.name}</strong><small>{t(user.role)} · {user.area}</small></span>
                <ChevronDown size={15} />
              </button>
              {userOpen && (
                <div className="topbar-popover user-popover">
                  <div className="user-popover-info">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    <small>{t(user.role)} · {user.area}</small>
                  </div>
                  {!managementViewer && <button type="button" onClick={() => { setUserOpen(false); setLeaveOpen(true); }}><CalendarClock size={16} /><span>{t(user.onLeave ? "My leave (on leave)" : "My leave")}</span></button>}
                  <button type="button" onClick={logout}><LogOut size={16} /><span>{t("Log out")}</span></button>
                  <ThemeControl />
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          <div className="uma-print-header"><UmaBrand /><span>{t(pageTitle)}</span></div>
          {user.onLeave && <div className="inline-alert alert-info leave-banner" role="status"><CalendarClock size={18} aria-hidden="true" /><div><strong>{user.leaveUntil ? t("You are on leave until {date}").replace("{date}", formatDate(`${String(user.leaveUntil).slice(0, 10)}T12:00:00Z`, language)) : t("You are on leave")}</strong><span>{t("Your approvals go to your substitute (or your jefe) until you are back.")}</span></div><button type="button" className="secondary-button" onClick={() => setLeaveOpen(true)}>{t("Manage leave")}</button></div>}
          <Suspense fallback={<WorkspaceSkeleton />}><MotionSurface changeKey={location.pathname}><Outlet /></MotionSurface></Suspense>
        </main>
      </div>
      <MobileBottomNav
        items={bottomItems.map((item) => ({ ...item, count: navigationCount(item.path, tasks.counters) }))}
        onSearch={managementViewer ? undefined : openCommandPalette}
        suppressed={mobileOpen || commandOpen}
        pendingLabel={pendingLabel}
      />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} pages={commandPages} />
      <MyLeavePanel open={leaveOpen} onClose={() => setLeaveOpen(false)} />
    </div>
  );
}
