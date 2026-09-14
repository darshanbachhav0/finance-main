import { useLanguage } from "../context/LanguageContext.jsx";

export default function WorkspaceSkeleton({ label = "Loading records..." }) {
  const { t } = useLanguage();
  return <div className="workspace-loading" role="status">
    <span className="loading-caption">{t(label)}</span>
    <div aria-hidden="true">
      <span className="skeleton skeleton-line loading-title" />
      <div className="workspace-panel loading-panel"><span className="skeleton skeleton-line" /><span className="skeleton skeleton-value" /><span className="skeleton skeleton-block" /></div>
    </div>
  </div>;
}
