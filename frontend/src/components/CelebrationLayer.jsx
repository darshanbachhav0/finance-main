import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { CELEBRATE_EVENT } from "../utils/celebrate.js";

const PIECE_COLORS = ["var(--uma-primary)", "#f2b134", "#19a974", "#3d8bfd", "#9b5de5", "#ff8fab"];
const PIECES = 36;

// Deterministic per burst, so a re-render never reshuffles the pieces mid-flight.
function seeded(seed) {
  let value = seed % 2147483647;
  return () => (value = (value * 16807) % 2147483647) / 2147483647;
}

export default function CelebrationLayer() {
  const { t } = useLanguage();
  const [burst, setBurst] = useState(null);

  useEffect(() => {
    let timer;
    const show = (event) => {
      window.clearTimeout(timer);
      setBurst({ id: Date.now(), message: event.detail?.message || "" });
      timer = window.setTimeout(() => setBurst(null), 2600);
    };
    window.addEventListener(CELEBRATE_EVENT, show);
    return () => {
      window.removeEventListener(CELEBRATE_EVENT, show);
      window.clearTimeout(timer);
    };
  }, []);

  if (!burst) return null;
  const random = seeded(burst.id);
  return (
    <div className="celebration-layer" key={burst.id} aria-hidden="true">
      {Array.from({ length: PIECES }, (_, index) => (
        <span
          key={index}
          className={`confetti-piece${index % 3 === 0 ? " is-round" : ""}`}
          style={{
            left: `${Math.round(random() * 100)}%`,
            background: PIECE_COLORS[index % PIECE_COLORS.length],
            animationDelay: `${Math.round(random() * 350)}ms`,
            animationDuration: `${1500 + Math.round(random() * 900)}ms`,
            "--drift": `${Math.round(random() * 160 - 80)}px`,
            "--spin": `${Math.round(random() * 720 - 360)}deg`
          }}
        />
      ))}
      <div className="celebration-badge">
        <CheckCircle2 size={34} />
        {burst.message && <strong>{t(burst.message)}</strong>}
      </div>
    </div>
  );
}
