import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import RequestQuickView from "./RequestQuickView.jsx";

export default function ResizablePreview({ requestId, onClose }) {
  const { t } = useLanguage();
  const wide = useMediaQuery("(min-width: 1440px)");
  const [width, setWidth] = useState(380);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!requestId || !wide) return;
    const escape = event => { if (event.key === "Escape" && !document.querySelector('[role="dialog"]')) close.current(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [requestId, wide]);
  if (!requestId) return null;
  if (!wide) return <RequestQuickView requestId={requestId} onClose={onClose} />;
  return <aside className="resizable-preview workspace-panel" style={{ width }} aria-label={t("Request quick view")}><div className="experience-toolbar"><label>{t("Panel width")}<input type="range" min="320" max="480" step="20" value={width} onChange={event => setWidth(Number(event.target.value))} /></label><button type="button" onClick={onClose}>{t("Close")}</button></div><RequestQuickView requestId={requestId} onClose={onClose} inline /></aside>;
}
