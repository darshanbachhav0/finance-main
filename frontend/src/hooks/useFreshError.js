import { useRef } from "react";

// A panel or dialog shows only errors raised while it is open: an error the page already had
// when it opened (from an earlier action) stays out of it until the error changes or clears.
export default function useFreshError(open, error) {
  const wasOpen = useRef(false);
  const stale = useRef(null);
  if (open && !wasOpen.current) stale.current = error || null;
  if (!error || error !== stale.current) stale.current = null;
  wasOpen.current = open;
  return open && error && error !== stale.current ? error : "";
}
