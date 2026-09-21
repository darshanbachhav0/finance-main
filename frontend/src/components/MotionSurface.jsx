import { useLayoutEffect, useRef } from "react";
export default function MotionSurface({ changeKey, directional = false, children, className = "" }) {
  const ref = useRef(null), previous = useRef(changeKey);
  useLayoutEffect(() => {
    const node = ref.current;
    const backwards = directional && Number(changeKey) < Number(previous.current);
    previous.current = changeKey;
    if (!node || (matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "true")) return;
    const animation = node.animate([{ opacity: 0, transform: directional ? `translateX(${backwards ? -10 : 10}px)` : "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "cubic-bezier(.2,.7,.2,1)" });
    return () => animation.cancel();
  }, [changeKey, directional]);
  return <div ref={ref} className={`motion-surface ${className}`}>{children}</div>;
}
