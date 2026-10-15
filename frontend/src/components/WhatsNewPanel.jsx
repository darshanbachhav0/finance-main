import { Sparkles } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatDate } from "../utils/formatters.js";
import { RELEASES } from "../utils/whatsNew.js";
import { startTour } from "../utils/tour.js";
import Drawer from "./Drawer.jsx";

export default function WhatsNewPanel({ open, onClose }) {
  const { t, language } = useLanguage();
  return (
    <Drawer open={open} title="What's new" description="Recent improvements to the platform." onClose={onClose} footer={<button type="button" className="secondary-button" onClick={() => { onClose(); startTour(); }}>{t("Take the tour")}</button>}>
      <div className="whats-new">
        {RELEASES.map((release) => (
          <article key={release.id} className="whats-new-release">
            <header><Sparkles size={18} aria-hidden="true" /><div><h3>{t(release.title)}</h3><small>{formatDate(`${release.date}T12:00:00Z`, language)}</small></div></header>
            <ul>{release.items.map((item) => <li key={item}>{t(item)}</li>)}</ul>
          </article>
        ))}
      </div>
    </Drawer>
  );
}
