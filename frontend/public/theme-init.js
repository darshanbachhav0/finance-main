// Apply the saved appearance before React and styles paint the page.
(() => {
  let preference = "system";
  try { preference = localStorage.getItem("uma_theme") || "system"; } catch { /* Storage may be disabled. */ }
  document.documentElement.dataset.theme = preference === "dark" || (preference !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
})();
