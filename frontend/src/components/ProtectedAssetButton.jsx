import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

export default function ProtectedAssetButton({
  resourcePath,
  fileName,
  preview = false,
  className = "asset-button-link",
  title,
  children
}) {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [loading, setLoading] = useState(false);

  async function openAsset() {
    if (!resourcePath || loading) return;
    const popup = preview ? window.open("about:blank", "_blank") : null;
    if (popup) popup.opener = null;
    setLoading(true);
    try {
      const response = await api.get("/files/download", {
        params: { path: resourcePath, name: fileName, disposition: preview ? "inline" : "attachment" },
        responseType: "blob"
      });
      const objectUrl = URL.createObjectURL(response.data);
      if (popup) {
        popup.location.replace(objectUrl);
      } else {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = fileName || "download";
        if (preview) link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      popup?.close();
      notify(error.message || t("File download failed."), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={openAsset}
      disabled={loading || !resourcePath}
      aria-busy={loading}
      title={title ? t(title) : undefined}
    >
      {loading ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : children}
    </button>
  );
}
