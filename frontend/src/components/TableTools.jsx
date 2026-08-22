import { BookmarkPlus, Download, Rows3, Rows4, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

function readViews(storageKey) {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export default function TableTools({ storageKey, query, onApplyView, density, onDensityChange, onExport }) {
  const { t } = useLanguage();
  const [savedViews, setSavedViews] = useState(() => readViews(storageKey));
  const [activeView, setActiveView] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(savedViews));
  }, [savedViews, storageKey]);

  const activeExists = useMemo(() => savedViews.some((view) => view.name === activeView), [activeView, savedViews]);

  function applyView(name) {
    setActiveView(name);
    const view = savedViews.find((item) => item.name === name);
    if (view) onApplyView(view.query);
  }

  function saveView(name) {
    const normalized = name.trim();
    if (!normalized) return;
    setSavedViews((current) => [...current.filter((view) => view.name.toLowerCase() !== normalized.toLowerCase()), { name: normalized, query }]);
    setActiveView(normalized);
    setSaveOpen(false);
  }

  function deleteView() {
    setSavedViews((current) => current.filter((view) => view.name !== activeView));
    setActiveView("");
  }

  return (
    <div className="table-preferences" aria-label={t("Table preferences")}>
      <label className="saved-view-select">
        <span className="sr-only">{t("Saved views")}</span>
        <select value={activeView} onChange={(event) => applyView(event.target.value)} aria-label={t("Saved views")}>
          <option value="">{t("Saved views")}</option>
          {savedViews.map((view) => <option key={view.name} value={view.name}>{view.name}</option>)}
        </select>
      </label>
      <button type="button" className="icon-button table-tool-button" onClick={() => setSaveOpen(true)} title={t("Save current view")} aria-label={t("Save current view")}>
        <BookmarkPlus size={16} />
      </button>
      {activeExists && (
        <button type="button" className="icon-button table-tool-button danger" onClick={deleteView} title={t("Delete saved view")} aria-label={t("Delete saved view")}>
          <Trash2 size={15} />
        </button>
      )}
      <div className="density-control" role="group" aria-label={t("Table density")}>
        <button type="button" className={density === "compact" ? "active" : ""} aria-pressed={density === "compact"} onClick={() => onDensityChange("compact")} title={t("Compact density")}>
          <Rows3 size={15} /><span>{t("Compact")}</span>
        </button>
        <button type="button" className={density === "comfortable" ? "active" : ""} aria-pressed={density === "comfortable"} onClick={() => onDensityChange("comfortable")} title={t("Comfortable density")}>
          <Rows4 size={15} /><span>{t("Comfortable")}</span>
        </button>
      </div>
      {onExport && (
        <button type="button" className="icon-button table-tool-button" onClick={onExport} title={t("Export current results")} aria-label={t("Export current results")}>
          <Download size={16} />
        </button>
      )}
      <ConfirmDialog
        open={saveOpen}
        title="Save table view"
        description="Store the current search, filters, sorting, density, and page size on this device."
        inputLabel="View name"
        inputType="text"
        inputRequired
        inputPlaceholder="Example: Pending USD requests"
        confirmLabel="Save view"
        onClose={() => setSaveOpen(false)}
        onConfirm={saveView}
      />
    </div>
  );
}
