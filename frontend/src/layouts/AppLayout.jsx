import { Suspense } from "react";
import MotionSurface from "../components/MotionSurface.jsx";
import WorkspaceSkeleton from "../components/WorkspaceSkeleton.jsx";
import {
  BarChart3,
  Bell,
  BookOpenCheck,
  Building2,
  CalendarRange,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileSpreadsheet,
  FileArchive,
  Landmark,
  LogOut,
  Menu,
  ReceiptText,
  Search,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  WalletCards,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import useNotificationBell from "../hooks/useNotificationBell.js";
import CommandPalette from "../components/CommandPalette.jsx";
import UmaBrand from "../components/UmaBrand.jsx";
import ThemeControl from "../components/ThemeControl.jsx";
import LanguageToggle from "../components/LanguageToggle.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import useAnimatedPresence from "../hooks/useAnimatedPresence.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { canAccessNavigation, navigationForUser } from "../utils/navigationAccess.js";

const groups = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", path: "/", icon: BarChart3 }]
  },
  {
    label: "Operations",
    items: [
      { label: "Requests", path: "/requests", icon: ReceiptText },
      { label: "Approval Inbox", path: "/approvals", icon: ClipboardCheck, counter: "approval" },
      { label: "A2 Batch Invoices", path: "/batch-invoices", icon: FileArchive }
    ]
  },
  {
    label: "Finance",
    items: [
      { label: "Accounting Entries", path: "/accounting", icon: FileSpreadsheet, counter: "accounting" },
      { label: "Reimbursement Banking", path: "/reimbursement-bank", icon: CircleDollarSign },
      { label: "Accounts Payable", path: "/accounting/payables", icon: BookOpenCheck },
      { label: "Invoice Observations", path: "/accounting/invoice-observations", icon: TriangleAlert },
      { label: "Treasury", path: "/treasury", icon: Landmark, counter: "payable" },
    ]
  },
  {
    label: "Planning and reports",
    items: [
      { label: "Budget Control", path: "/budget", icon: WalletCards, counter: "budgetExceptions" },
      { label: "Accounting Periods", path: "/accounting/periods", icon: CalendarRange },
      { label: "SIRE Export", path: "/accounting/sire", icon: FileSpreadsheet },
      { label: "Management Reports", path: "/reports", icon: ChartNoAxesCombined },
      { label: "Management Portal", path: "/management-view", icon: ChartNoAxesCombined }
    ]
  },
  {
    label: "Master Data",
    items: [
      { label: "Suppliers", path: "/suppliers", icon: Building2, counter: "suppliers" },
      { label: "Cost Centers", path: "/cost-centers", icon: CircleDollarSign },
      { label: "Expense Types", path: "/expense-types", icon: Settings2 },
      { label: "Exchange Rates", path: "/exchange-rates", icon: CircleDollarSign },
      { label: "Configuration", path: "/configuration/projects", icon: SlidersHorizontal }
    ]
  },
  {
    label: "Administration",
    items: [
      { label: "Users", path: "/users", icon: Users },
      { label: "Audit Viewer", path: "/audit", icon: ScrollText }
    ]
  }
];

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
  [/^\/expense-types/, "Expense Types"],
  [/^\/exchange-rates/, "Exchange Rates"],
  [/^\/users/, "Users"],
  [/^\/configuration/, "Configuration"],
  [/^\/audit/, "Audit Viewer"]
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("erp_sidebar_collapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobile = useMediaQuery("(max-width: 1080px)");
  const managementViewer = user.role === "ManagementViewer";
  const { tasks, notifications, error: notificationError, refresh: loadTasks, markRead: markNotificationRead, markAllRead } = useNotificationBell(user._id, !managementViewer);
  const [taskOpen, setTaskOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const menusRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const sidebarRef = useRef(null);
  const mobileBackdrop = useAnimatedPresence(mobileOpen, 180);

  const visibleGroups = useMemo(() => [{ label: "Your workspace", items: navigationForUser(user).map(([label, path]) => ({ ...(groups.flatMap(group => group.items).find(item => item.path === path) || { icon: Settings2 }), label, path })).filter(item => canAccessNavigation(user.role, item.path, user)) }], [user.role, user.hasTeam]);
  const commandPages = useMemo(() => visibleGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label }))), [visibleGroups]);

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
                const count = item.counter ? tasks.counters?.[item.counter] : 0;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/" || item.path === "/accounting" || item.path === "/requests" || item.path === "/treasury"}
                    className="nav-item"
                    data-tooltip={t(item.label)}
                    aria-label={t(item.label)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-label">{t(item.label)}</span>
                    {count > 0 && <span className="nav-counter" aria-label={t("{count} pending tasks").replace("{count}", count)}>{count > 99 ? "99+" : count}</span>}
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
                {notifications.unreadCount > 0 ? <span className="notification-dot" aria-live="polite" aria-label={t("{count} unread notifications").replace("{count}", notifications.unreadCount)}>{notifications.unreadCount > 99 ? "99+" : notifications.unreadCount}</span> : tasks.total > 0 && <span className="notification-dot" aria-label={t("Pending tasks")}>•</span>}
              </button>
              {taskOpen && (
                <div className="topbar-popover task-popover">
                  <div className="popover-heading">
                    <strong>{t("Tasks and alerts")}</strong>
                    <span>{t("{count} unread notifications").replace("{count}", notifications.unreadCount)}</span>
                  </div>
                  {notificationError && <p className="popover-empty" role="status">{t(notificationError)} <button type="button" className="text-button" onClick={loadTasks}>{t("Retry")}</button></p>}
                  <div className="task-list">
                    <div className="notification-list-heading"><strong>{t("Notifications")}</strong>{notifications.unreadCount > 0 && <button type="button" className="text-button" onClick={markAllRead}>{t("Mark all read")}</button>}</div>
                    {notifications.data.map((item) => (
                      <Link key={item._id} to={item.path || "/"} className={`task-item notification-item${item.readAt ? " is-read" : ""}`} onClick={() => { setTaskOpen(false); markNotificationRead(item); }}>
                        <span className={`task-indicator tone-${item.type === "SLA_ESCALATION" || item.type === "SLA_OVERDUE" ? "red" : item.type === "SLA_DUE_SOON" ? "amber" : item.readAt ? "neutral" : "teal"}`} />
                        <span><strong>{t(item.title)}</strong><small>{t(item.message)}</small></span>
                      </Link>
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
                <span className="user-summary"><strong>{user.name}</strong><small>{t(user.role)} · {user.area}</small></span>
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
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} pages={commandPages} />
    </div>
  );
}
