import { useLanguage } from "../context/LanguageContext.jsx";

// Ids shared by a tab and the panel it shows (tab ids such as "SUNAT exceptions" are slugged).
const slug = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, "-");
export const tabId = (idPrefix, id) => `${idPrefix}-tab-${slug(id)}`;
export const tabPanelId = (idPrefix, id) => `${idPrefix}-panel-${slug(id)}`;

// Props for the element that shows a tab's content.
export function tabPanelProps(idPrefix, id) {
  return { role: "tabpanel", id: tabPanelId(idPrefix, id), "aria-labelledby": tabId(idPrefix, id) };
}

// One tab bar for every page: ARIA tabs with arrow-key, Home and End navigation (the selected
// tab is the only one in the Tab order) and an optional count on each tab.
// tabs: [{ id, label, count?, icon? }]. Pass `panels` when each tab has an element using
// tabPanelProps(idPrefix, id), so the tabs point at their panels.
export default function Tabs({ tabs, value, onChange, label, idPrefix, panels = false, className = "", children }) {
  const { t } = useLanguage();

  function select(index) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (tab.id !== value) onChange(tab.id);
    window.requestAnimationFrame(() => document.getElementById(tabId(idPrefix, tab.id))?.focus());
  }

  function handleKeyDown(event) {
    const current = tabs.findIndex((tab) => tab.id === value);
    const moves = { ArrowRight: current + 1, ArrowDown: current + 1, ArrowLeft: current - 1, ArrowUp: current - 1, Home: 0, End: tabs.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select(moves[event.key]);
  }

  return (
    <div className={`focus-tabs tab-bar ${className}`.trim()}>
      <div className="tab-list" role="tablist" aria-label={t(label)} onKeyDown={handleKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === value;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              id={tabId(idPrefix, tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panels ? tabPanelId(idPrefix, tab.id) : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => { if (!selected) onChange(tab.id); }}
            >
              {Icon && <Icon size={15} aria-hidden="true" />}
              <span>{t(tab.label)}</span>
              {Number(tab.count) > 0 && <span className="tab-count">{tab.count > 99 ? "99+" : tab.count}</span>}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
