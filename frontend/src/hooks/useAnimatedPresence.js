import { useEffect, useState } from "react";

export default function useAnimatedPresence(open, duration = 180) {
  const [rendered, setRendered] = useState(open);
  const [phase, setPhase] = useState(open ? "entered" : "exited");

  useEffect(() => {
    let frame;
    let timer;

    if (open) {
      setRendered(true);
      frame = window.requestAnimationFrame(() => setPhase("entered"));
    } else if (rendered) {
      setPhase("exiting");
      timer = window.setTimeout(() => {
        setRendered(false);
        setPhase("exited");
      }, duration);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open, duration, rendered]);

  return { shouldRender: rendered, phase };
}
