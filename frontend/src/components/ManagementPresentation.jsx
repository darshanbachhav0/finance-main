import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import Drawer from "./Drawer.jsx";
import AnalyticsChart from "./AnalyticsChart.jsx";
import { BudgetBars, Freshness } from "./ExperienceIndicators.jsx";
import { formatCurrency } from "../utils/formatters.js";

export default function ManagementPresentation({ data, filters, loading }) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const surface = useRef(null);
  useEffect(() => { if (!open || !playing || reduced) return; const timer = setInterval(() => { if (!document.hidden) setSlide(value => (value + 1) % 4); }, 12000); return () => clearInterval(timer); }, [open, playing, reduced]);
  useEffect(() => { if (reduced) setPlaying(false); }, [reduced]);
  if (!["Admin", "Management"].includes(user.role)) return null;
  const titles = ["Budget execution", "Monthly spending trend", "Workflow distribution", "Workflow and SLA"];
  const rows = [[], data.byMonth, data.statusFunnel, data.approvalSla][slide] || [];
  function close() { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); setOpen(false); setPlaying(false); }
  return <><button className="secondary-button" type="button" disabled={loading} onClick={() => setOpen(true)}>{t("Presentation mode")}</button><Drawer open={open} onClose={close} title="Management presentation" size="large"><div ref={surface} className="management-presentation"><div className="experience-toolbar"><strong>UMA · {t(titles[slide])}</strong><Freshness at={data.lastUpdated} /></div><p>{t("Selected scope")}: {Object.entries(filters).filter(([, value]) => value).map(([key, value]) => `${t(key)}: ${value}`).join(" · ") || t("All periods")}</p><div key={slide} className="presentation-slide">{slide === 0 ? <BudgetBars totals={data.budget} /> : <AnalyticsChart title={titles[slide]} type={slide === 1 ? "area" : "bar"} data={rows.map(row => ({ ...row, name: t(row._id) }))} series={[{ key: slide === 1 ? "total" : "count", label: slide === 1 ? "PEN amount" : "Requests", color: "#e91951" }]} height={380} valueFormatter={slide === 1 ? value => formatCurrency(value, "PEN", language) : undefined} />}</div><div className="experience-toolbar"><button type="button" onClick={() => setSlide(value => (value + 3) % 4)}>{t("Previous")}</button><span>{slide + 1} / 4</span><button type="button" onClick={() => setSlide(value => (value + 1) % 4)}>{t("Next")}</button><button type="button" disabled={reduced} aria-pressed={playing} onClick={() => setPlaying(value => !value)}>{t(playing ? "Pause" : "Auto-play")}</button><button type="button" onClick={async () => { try { await surface.current.closest('[role="dialog"]').requestFullscreen(); setFullscreenError(""); } catch { setFullscreenError("Fullscreen is unavailable in this browser."); } }}>{t("Full screen")}</button><button type="button" onClick={close}>{t("Close")}</button></div>{fullscreenError && <p role="status">{t(fullscreenError)}</p>}</div></Drawer></>;
}
