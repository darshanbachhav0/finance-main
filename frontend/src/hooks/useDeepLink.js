import { useSearchParams } from "react-router-dom";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Notification and task links open one record: /treasury?tab=confirm&record=<id>,
// /approvals?request=<id>, /batch-invoices?batch=<id>... `link` holds the valid id parameters
// (malformed ids are ignored) and is passed to the page's list endpoint as fixed parameters;
// `clear()` drops the link and returns the page to its full list.
export default function useDeepLink(keys = ["record", "request"]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const link = {};
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value && OBJECT_ID.test(value)) link[key] = value;
  }
  const active = Object.keys(link).length > 0;
  const tab = String(searchParams.get("tab") || "").toLowerCase();
  function clear() {
    const next = new URLSearchParams(searchParams);
    for (const key of [...keys, "tab"]) next.delete(key);
    setSearchParams(next, { replace: true });
  }
  return { link, active, tab, clear, linkKey: JSON.stringify(link) };
}
