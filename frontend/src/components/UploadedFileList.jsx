import { Eye, RotateCcw, Trash2 } from "lucide-react";
import ProtectedAssetButton from "./ProtectedAssetButton.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

// A file chosen in the form but not yet saved is opened from the browser's own copy.
export function openLocalFile(file) {
  if (!(file instanceof Blob)) return;
  const objectUrl = URL.createObjectURL(file);
  const popup = window.open(objectUrl, "_blank");
  if (popup) popup.opener = null;
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

// The files on one document card: already on the request (view, or mark for removal until the
// form is saved), marked for removal (keep it after all), and chosen now (view, or drop it).
// It sits inside the card's <label>, so a click on it must not reopen the file picker.
export default function UploadedFileList({ stored = [], removed = [], chosen = [], onRemoveStored, onRestoreStored, onRemoveChosen }) {
  const { t } = useLanguage();
  if (!stored.length && !removed.length && !chosen.length) return null;
  const label = (action, name) => `${t(action)}: ${name}`;
  return (
    <ul className="file-list" onClick={(event) => event.preventDefault()}>
      {stored.map((file) => (
        <li key={file._id}>
          <span title={file.originalName}>{file.originalName} - {t("Already uploaded")}</span>
          <ProtectedAssetButton className="icon-button quiet" resourcePath={file.url} fileName={file.originalName} preview title="View document" ariaLabel={label("View document", file.originalName)}><Eye size={15} aria-hidden="true" /></ProtectedAssetButton>
          <button type="button" className="icon-button quiet danger" onClick={() => onRemoveStored(file)} title={t("Remove document")} aria-label={label("Remove document", file.originalName)}><Trash2 size={15} aria-hidden="true" /></button>
        </li>
      ))}
      {removed.map((file) => (
        <li key={file._id} className="is-removed">
          <span title={file.originalName}><s>{file.originalName}</s> - {t("Removed when you save")}</span>
          <button type="button" className="icon-button quiet" onClick={() => onRestoreStored(file)} title={t("Keep document")} aria-label={label("Keep document", file.originalName)}><RotateCcw size={15} aria-hidden="true" /></button>
        </li>
      ))}
      {chosen.map((file, index) => (
        <li key={`${file.name}-${file.size}-${index}`}>
          <span title={file.name}>{file.name} - {(file.size / 1024).toFixed(0)} KB</span>
          <button type="button" className="icon-button quiet" onClick={() => openLocalFile(file)} title={t("View document")} aria-label={label("View document", file.name)}><Eye size={15} aria-hidden="true" /></button>
          <button type="button" className="icon-button quiet danger" onClick={() => onRemoveChosen(index)} title={t("Remove document")} aria-label={label("Remove document", file.name)}><Trash2 size={15} aria-hidden="true" /></button>
        </li>
      ))}
    </ul>
  );
}
