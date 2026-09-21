import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { validateFiles } from "../utils/experience.js";

export default function FileUploadInput({ onChange, accept, multiple, disabled, ...props }) {
  const { t } = useLanguage();
  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState([]);
  useEffect(() => { const next = files.filter(file => /^image\/(png|jpeg|webp)$/.test(file.type)).map(file => ({ name: file.name, url: URL.createObjectURL(file) })); setPreviews(next); return () => next.forEach(item => URL.revokeObjectURL(item.url)); }, [files]);
  function change(event) {
    const next = Array.from(event.target.files || []);
    const issue = validateFiles(next, accept, multiple);
    setError(issue);
    if (issue) { event.target.value = ""; setFiles([]); onChange?.({ target: { files: [], name: props.name } }); return; }
    setFiles(next); onChange?.(event);
  }
  return <span className={`file-drop-input${dragging ? " dragging" : ""}`} onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (disabled) return; const next = event.dataTransfer.files; const issue = validateFiles(Array.from(next), accept, multiple); setError(issue); if (issue) return; input.current.files = next; change({ target: input.current }); }}>
    <input {...props} ref={input} type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={change} />
    <small>{t("Drop files here or choose files")}{accept ? ` · ${accept}` : ""}</small>
    {error && <span className="field-error-text" role="alert">{t(error)}</span>}
    {files.length > 0 && <span className="upload-selection">{files.map(file => <small key={`${file.name}-${file.size}`}>{file.name} · {Math.ceil(file.size / 1024)} KB</small>)}<small>{t("Selected locally. Upload completes when you save.")}</small></span>}
    {!!previews.length && <span className="file-previews">{previews.map(item => <img key={item.url} src={item.url} alt={item.name} />)}</span>}
  </span>;
}
