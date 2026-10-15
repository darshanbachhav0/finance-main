import { useEffect, useRef, useState } from "react";

// Animate only for someone looking: not with reduced motion, and not in a tab that is in the
// background (it would sit on the starting number until the person comes back).
const animates = () => typeof window !== "undefined"
  && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  && document.visibilityState !== "hidden";

// A number that counts up to its value when it first appears (or changes). `format` renders the
// in-between values too, so a currency counts up as a currency. Screen readers get the final value.
export default function CountUp({ value = 0, format = (number) => String(Math.round(number)), duration = 700 }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(() => (animates() ? 0 : target));
  const from = useRef(0);

  useEffect(() => {
    if (!animates()) { setShown(target); from.current = target; return undefined; }
    const start = performance.now();
    const origin = from.current;
    let frame;
    const step = (time) => {
      const progress = Math.min(1, (time - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(origin + (target - origin) * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    // Leaving the tab mid-animation still ends on the right number.
    const finish = () => { if (document.visibilityState === "hidden") { cancelAnimationFrame(frame); setShown(target); from.current = target; } };
    document.addEventListener("visibilitychange", finish);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", finish); };
  }, [target, duration]);

  return <span className="count-up"><span aria-hidden="true">{format(shown)}</span><span className="sr-only">{format(target)}</span></span>;
}
