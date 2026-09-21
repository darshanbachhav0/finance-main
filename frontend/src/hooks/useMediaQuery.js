import { useEffect, useState } from "react";

export default function useMediaQuery(query) {
  const matchesQuery = () => window.matchMedia(query).matches || query === "(prefers-reduced-motion: reduce)" && document.documentElement.dataset.reduceMotion === "true";
  const [matches, setMatches] = useState(matchesQuery);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(matchesQuery());
    update();
    media.addEventListener("change", update);
    window.addEventListener("uma:accessibility", update);
    return () => { media.removeEventListener("change", update); window.removeEventListener("uma:accessibility", update); };
  }, [query]);
  return matches;
}
