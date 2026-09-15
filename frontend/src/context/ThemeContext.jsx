import { createContext, useContext, useEffect, useState } from "react";
const ThemeContext = createContext(null);
const normalize = value => ["light", "dark", "system"].includes(value) ? value : "system";
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return normalize(localStorage.getItem("uma_theme")); } catch { return "system"; }
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? media.matches ? "dark" : "light" : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#14131b" : "#c91545");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const sync = event => { if (event.key === "uma_theme") setTheme(normalize(event.newValue)); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function changeTheme(value) {
    const next = normalize(value);
    setTheme(next);
    try { localStorage.setItem("uma_theme", next); } catch { /* The setting still works for this session. */ }
  }
  return <ThemeContext.Provider value={{ theme, setTheme: changeTheme }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
