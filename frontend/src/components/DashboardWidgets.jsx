import { Children, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

const names = ["Recent work", "Workflow distribution", "Financial overview"];
export default function DashboardWidgets({ children }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const key = `uma:widgets:${user._id}:${user.role}`;
  const [settings, setSettings] = useState(() => { try { const saved = JSON.parse(localStorage.getItem(key)); return saved && saved.order?.length === 3 && new Set(saved.order).size === 3 && saved.order.every(i => [0, 1, 2].includes(i)) ? saved : { order: [0, 1, 2], hidden: [] }; } catch { return { order: [0, 1, 2], hidden: [] }; } });
  const [customizing, setCustomizing] = useState(false);
  const panels = Children.toArray(children);
  function save(next) { setSettings(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Session settings remain available. */ } }
  function hide(index) { const previous = settings; save({ ...settings, hidden: [...(settings.hidden || []), index] }); notify("Widget hidden.", "info", { action: { label: "Undo", onClick: () => save(previous) } }); }
  return <><div className="experience-toolbar"><button type="button" className="text-button" aria-expanded={customizing} onClick={() => setCustomizing(value => !value)}>{t("Customize dashboard")}</button>{customizing && <button type="button" className="text-button" onClick={() => save({ order: [0, 1, 2], hidden: [] })}>{t("Restore default layout")}</button>}</div><div className="dashboard-grid">{settings.order.map((index, position) => settings.hidden?.includes(index) && !customizing ? null : <div className={`dashboard-widget${settings.hidden?.includes(index) ? " widget-hidden" : ""}`} key={index}>{customizing && <div className="widget-tools"><strong>{t(names[index])}</strong><button type="button" disabled={!position} aria-label={`${t("Move up")}: ${t(names[index])}`} onClick={() => { const order = [...settings.order]; [order[position - 1], order[position]] = [order[position], order[position - 1]]; save({ ...settings, order }); }}>↑</button><button type="button" disabled={position === 2} aria-label={`${t("Move down")}: ${t(names[index])}`} onClick={() => { const order = [...settings.order]; [order[position], order[position + 1]] = [order[position + 1], order[position]]; save({ ...settings, order }); }}>↓</button><button type="button" onClick={() => settings.hidden?.includes(index) ? save({ ...settings, hidden: settings.hidden.filter(i => i !== index) }) : hide(index)}>{t(settings.hidden?.includes(index) ? "Show" : "Hide")}</button></div>}{!settings.hidden?.includes(index) && panels[index]}</div>)}</div>{panels.slice(3)}</>;
}
