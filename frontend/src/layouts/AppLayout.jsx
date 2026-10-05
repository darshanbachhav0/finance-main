import { Suspense } from "react";
import MotionSurface from "../components/MotionSurface.jsx";
import WorkspaceSkeleton from "../components/WorkspaceSkeleton.jsx";
import {
  BarChart3,
  Bell,
  BookOpenCheck,
  Building2,
  CalendarRange,
  Check,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileSpreadsheet,
  FileArchive,
  FilePlus2,
  History,
  Landmark,
  LogOut,
  Menu,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  WalletCards,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import useNotificationBell from "../hooks/useNotificationBell.js";
import { notificationMessage, notificationTitle } from "../utils/notificationText.js";
import CommandPalette from "../components/CommandPalette.jsx";
import UmaBrand from "../components/UmaBrand.jsx";
import ThemeControl from "../components/ThemeControl.jsx";
import LanguageToggle from "../components/LanguageToggle.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import MobileBottomNav from "../components/MobileBottomNav.jsx";
import { bottomNavigationForUser, canAccessNavigation, counterBadgeText, groupNavigation, navigationCount, navigationForUser } from "../utils/navigationAccess.js";

const groups = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", path: "/", icon: BarChart3 }]
  },
  {
    label: "Operations",
    items: [
      { label: "Requests", path: "/requests", icon: ReceiptText },
      { label: "Approval Inbox", path: "/approvals", icon: ClipboardCheck },
      { label: "A2 Batch Invoices", path: "/batch-invoices", icon: FileArchive }
    ]
  },
  {
    label: "Finance",
    items: [
      { label: "Accounting Entries", path: "/accounting", icon: FileSpreadsheet },
      { label: "Reimbursement Banking", path: "/reimbursement-bank", icon: CircleDollarSign },
      { label: "Accounts Payable", path: "/accounting/payables", icon: BookOpenCheck },
      { label: "Invoice Observations", path: "/accounting/invoice-observations", icon: TriangleAlert },
      { label: "Treasury", path: "/treasury", icon: Landmark },
    ]
  },
  {
    label: "Planning and reports",
    items: [
      { label: "Budget Control", path: "/budget", icon: WalletCards },
      { label: "Accounting Periods", path: "/accounting/periods", icon: CalendarRange },
      { label: "SIRE Export", path: "/accounting/sire", icon: FileSpreadsheet },
      { label: "Management Reports", path: "/reports", icon: ChartNoAxesCombined },
      { label: "Management Portal", path: "/management-view", icon: ChartNoAxesCombined }
    ]
  },
  {
    label: "Master Data",
    items: [
      { label: "Suppliers", path: "/suppliers", icon: Building2 },
      { label: "Cost Centers", path: "/cost-centers", icon: CircleDollarSign },
      { label: "Accounting Accounts", path: "/expense-types", icon: Settings2 },
      { label: "Exchange Rates", path: "/exchange-rates", icon: CircleDollarSign },
      { label: "Configuration", path: "/configuration/approval-rules", icon: SlidersHorizontal },
      { label: "Budget Rules", path: "/configuration/budget-rules", icon: SlidersHorizontal },
      { label: "Finance Configurations", path: "/configuration/finance-configurations", icon: SlidersHorizontal },
      { label: "Accounting Mappings", path: "/configuration/accounting-mappings", icon: BookOpenCheck },
      { label: "Bank Formats", path: "/configuration/bank-formats", icon: Landmark }
    ]
  },
  {
    label: "Administration",
    items: [
      { label: "Users", path: "/users", icon: Users }
    ]
  }
];

// Icons for role destinations that are not part of the groups above.
const routeIcons = {
  "/requests/new": FilePlus2,
  "/administration": ShieldCheck,
  "/treasury/history": History,
  "/accounting/invoices": ReceiptText,
  "/my-team": Users
};
const navigationIcon = (path) => groups.flatMap((group) => group.items).find((item) => item.path === path)?.icon || routeIcons[path] || Settings2;

const routeTitles = [
  [/^\/management-view/, "Management Portal"],
  [/^\/administration/, "Administration"],
  [/^\/treasury\/history/, "Payment History"],
  [/^\/accounting\/invoices/, "Invoices"],
  [/^\/$/, "Dashboard"],
  [/^\/requests\/new$/, "New request"],
  [/^\/requests\/[^/]+\/edit$/, "Edit request"],
  [/^\/requests\/[^/]+$/, "Request details"],
  [/^\/requests/, "Requests"],
  [/^\/approvals/, "Approval Inbox"],
  [/^\/batch-invoices/, "A2 Batch Invoice Ingestion"],
  [/^\/treasury/, "Treasury Payment Queue"],
  [/^\/reimbursement-bank/, "Employee Reimbursement Banking"],
  [/^\/budget/, "Budget Control"],
  [/^\/reports/, "Management Reports"],
  [/^\/accounting\/periods/, "Accounting Periods"],
  [/^\/accounting\/payables/, "Accounts Payable"],
  [/^\/accounting\/invoice-observations/, "Invoice Observation Inbox"],
  [/^\/accounting\/sire/, "SIRE RCE Export"],
  [/^\/accounting/, "Accounting Entries"],
  [/^\/suppliers/, "Suppliers"],
  [/^\/cost-centers/, "Cost Centers"],
  [/^\/expense-types/, "Accounting Accounts"],
  [/^\/exchange-rates/, "Exchange Rates"],
  [/^\/users/, "Users"],
  [/^\/configuration/, "Configuration"]
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("erp_sidebar_collapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobile = useMediaQuery("(max-width: 1080px)");
  const managementViewer = user.role === "ManagementViewer";
  const { tasks, notifications, error: notificationError, refresh: loadTasks, markRead: markNotificationRead, markAllRead, dismiss: dismissNotification } = useNotificationBell(user._id, !managementViewer);
  const [taskOpen, setTaskOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const menusRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const sidebarRef = useRef(null);
  const mobileBackdrop = useAnimatedPresence(mobileOpen, 180);

  const pendingApprovals = Number(tasks.counters?.approval) || 0;
  // Grouped into fixed sections (Overview, Requests, Finance, Planning and reports, Master Data,
  // Administration) so every role reads the menu the same way.
  const visibleGroups = useMemo(() => groupNavigation(navigationForUser(user, { pendingApprovals }).map(([label, path]) => ({ ...(groups.flatMap(group => group.items).find(item => item.path === path) || {}), icon: navigationIcon(path), label, path })).filter(item => canAccessNavigation(user.role, item.path, user))), [user.role, user.hasTeam, user.hasPendingApprovals, pendingApprovals > 0]);
  const commandPages = useMemo(() => visibleGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label }))), [visibleGroups]);
  const bottomItems = useMemo(() => bottomNavigationForUser(user, { pendingApprovals }).map((item) => ({ ...item, icon: navigationIcon(item.path) })), [user.role, user.hasTeam, user.hasPendingApprovals, pendingApprovals > 0]);
  // "3 pendientes": the badge's spoken form, also added to the link's name (the collapsed
  // sidebar hides the text label, so the badge must not be the only place the count lives).
  const pendingLabel = (count) => t(count === 1 ? "{count} pending item" : "{count} pending items").replace("{count}", count > 99 ? "99+" : count);
  const openCommandPalette = () => { setTaskOpen(false); setUserOpen(false); setMobileOpen(false); setCommandOpen(true); };

  const pageTitle = routeTitles.find(([pattern]) => pattern.test(location.pathname))?.[1] || "Financial Control";
  const breadcrumb = location.pathname === "/" ? [] : [{ label: "Dashboard", path: "/" }, { label: pageTitle }];

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
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/" || item.path === "/accounting" || item.path === "/requests" || item.path === "/treasury"}
                    className="nav-item"
                    data-tooltip={name}
                    aria-label={name}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-label">{t(item.label)}</span>
                    {count > 0 && <span className="nav-counter" aria-hidden="true">{counterBadgeText(count)}</span>}
                  </NavLink>
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
            <div>
              {breadcrumb.length > 0 && (
                <nav className="breadcrumbs" aria-label={t("Breadcrumbs")}>
                  {breadcrumb.map((item, index) => item.path ? <Link key={item.label} to={item.path}>{t(item.label)}</Link> : <span key={item.label} aria-current="page">{t(item.label)}</span>).reduce((items, item, index) => index ? [...items, <span className="breadcrumb-separator" key={`separator-${index}`}>/</span>, item] : [item], [])}
                </nav>
              )}
              <strong className="topbar-page-title">{t(pageTitle)}</strong>
            </div>
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
                        <span className={`task-indicator tone-${item.type === "SLA_ESCALATION" || item.type === "SLA_OVERDUE" ? "red" : item.type === "SLA_DUE_SOON" ? "amber" : item.readAt ? "neutral" : "teal"}`} />
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
                        <span className={`task-indicator tone-${item.tone}`} />
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
                  <button type="button" onClick={logout}><LogOut size={16} /><span>{t("Log out")}</span></button>
                  <ThemeControl />
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          <div className="uma-print-header"><UmaBrand /><span>{t(pageTitle)}</span></div>
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
    </div>
  );
}
