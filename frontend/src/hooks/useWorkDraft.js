import { useEffect, useReducer, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { decodeDraft, draftFingerprint, draftSession, draftSignal, flushDraft } from "../utils/workDrafts.js";
import { cacheDraft, readCachedDraft, removeCachedDraft } from "../utils/draftOutbox.js";

export async function resumeDraftRecord(endpoint, id, identify, open, onError) {
  try {
    for (let page = 1; page <= 1000; page += 1) {
      const response = await api.get(endpoint, { params: { page, pageSize: 100 } });
      const row = response.data.data?.find(item => String(identify(item)) === id);
      if (row) { open(row); return; }
      if (!response.data.pagination || page >= response.data.pagination.totalPages) break;
    }
    onError("This record is no longer in the active queue. Its saved draft remains in Continue your work.");
  } catch (err) { onError(err.message); }
}

export function useDraftResume(scope, open) {
  const location = useLocation();
  const seen = useRef("");
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("workDraft");
    if (params.get("workScope") === scope && id && seen.current !== id) {
      seen.current = id;
      open(params.get("workRecord") || "new");
    }
  }, [location.search, scope, open]);
}

export default function useWorkDraft({ scope, recordId = "new", title, value, restore, enabled = true, route, sourceVersion }) {
  const { user } = useAuth();
  const location = useLocation();
  const [, render] = useReducer(x => x + 1, 0);
  const [generation, setGeneration] = useState(0);
  const [restoration, setRestoration] = useState(0);
  const copiedFrom = useRef(null);
  const params = new URLSearchParams(location.search);
  const requestedId = params.get("workScope") === scope ? params.get("workDraft") : null;
  const key = `${user?._id}:${scope}:${recordId}:${requestedId || "latest"}:${generation}`;
  const session = draftSession(key, { owner: user?._id, scope, recordId: String(recordId), title, route: route || location.pathname, sourceVersion });
  if (generation && copiedFrom.current) session.copySource = copiedFrom.current;
  const current = useRef({ value, restore }); current.current = { value, restore };
  const [hydratedKey, setHydratedKey] = useState("");
  const ready = enabled && hydratedKey === key && session.loaded && !["loading", "load-error"].includes(session.status);
  useEffect(() => { session.listeners.add(render); return () => session.listeners.delete(render); }, [session]);

  async function load(force = false, isActive = () => true) {
    draftSignal(session, "loading");
    let cached;
    try {
      if (!session.loaded || force) {
        if (!force && !generation) cached = await readCachedDraft(user._id, scope, String(recordId), requestedId).catch(() => null);
        let row;
        if ((requestedId || cached?.revision) && !generation) row = (await api.get(`/work-drafts/${requestedId || cached.id}`)).data.data;
        else if (!generation) {
          const list = (await api.get("/work-drafts", { params: { scope, recordId } })).data.data;
          if (list[0]) row = (await api.get(`/work-drafts/${list[0]._id}`)).data.data;
        }
        if (row && (row.scope !== scope || row.recordId !== String(recordId))) throw new Error("This draft belongs to a different form.");
        session.initial = current.current.value;
        session.sourceVersion = sourceVersion;
        if (row) {
          session.id = row._id; session.revision = row.revision; session.updatedAt = row.updatedAt;
          session.value = row.value === null ? current.current.value : await decodeDraft(row.value, session);
          session.signature = session.savedSignature = draftFingerprint(session.value);
          session.sourceChanged = sourceVersion && row.sourceVersion && sourceVersion !== row.sourceVersion;
          session.restored = true;
        } else { session.value = current.current.value; session.signature = draftFingerprint(session.value); session.savedSignature = generation ? "__new_copy" : session.signature; }
        session.pending = null; session.loaded = true;
        if (cached) {
          Object.assign(session, cached);
          session.signature = draftFingerprint(session.value);
          session.offlineRestored = true;
        }
      }
      if (!isActive()) return;
      current.current.restore(session.value);
      setHydratedKey(key);
      setRestoration(n => n + 1);
      draftSignal(session, session.offlineRestored ? "waiting" : session.sourceChanged ? "source-changed" : session.restored ? "restored" : "ready");
    } catch (error) {
      if (cached && ![401, 403].includes(error.status) && isActive()) {
        Object.assign(session, cached); session.loaded = true; session.signature = draftFingerprint(cached.value);
        current.current.restore(cached.value); setHydratedKey(key);
        draftSignal(session, error.status === 404 ? "conflict" : "error", error.status === 404 ? "The saved draft was removed in another session. Keep your recovered changes as a separate draft." : "Recovered unsynchronized work from this browser. Reconnect to save it to your account.");
      } else draftSignal(session, "load-error", error.message);
    }
  }
  useEffect(() => {
    if (!enabled || !user) { setHydratedKey(""); return undefined; }
    let active = true;
    // Restore is performed before edits are enabled by DraftPanel's fieldset.
    void load(false, () => active);
    return () => { active = false; void flushDraft(session); };
  }, [key, enabled, session]);

  const signature = draftFingerprint(value);
  useEffect(() => {
    if (!ready || session.closed) return;
    session.value = value; session.signature = signature;
    if (signature !== session.savedSignature && !["conflict", "load-error"].includes(session.status)) {
      void cacheDraft(session).catch(() => { session.backupFailed = true; });
      draftSignal(session, "waiting");
      clearTimeout(session.timer);
      session.timer = setTimeout(() => { void flushDraft(session); }, 700);
    } else if (!session.pending && signature === session.savedSignature && session.status === "waiting") {
      draftSignal(session, session.revision ? "saved" : "ready");
    }
  }, [signature, ready, session]);

  async function complete() {
    clearTimeout(session.timer);
    if (session.inflight) await session.inflight;
    session.closed = true;
    try {
      if (session.revision) await api.delete(`/work-drafts/${session.id}`, { params: { revision: session.revision } });
      await removeCachedDraft(session);
      window.dispatchEvent(new Event("uma:drafts-changed"));
    } catch (error) {
      // The business operation already succeeded; never encourage resubmission.
      window.dispatchEvent(new CustomEvent("uma:draft-cleanup-warning", { detail: error.message }));
    } finally { draftSignal(session, "completed"); }
  }
  async function discard() {
    if (session.inflight) await session.inflight;
    if (session.revision) await api.delete(`/work-drafts/${session.id}`, { params: { revision: session.revision } });
    session.closed = true;
    await removeCachedDraft(session);
    draftSignal(session, "discarded");
    window.dispatchEvent(new Event("uma:drafts-changed"));
    return true;
  }
  function separateCopy() {
    copiedFrom.current = session;
    session.closed = true; // Only detach this client; keep the original saved draft.
    setGeneration(n => n + 1);
  }
  async function startAnother() {
    if (!await flushDraft(session)) return;
    current.current.restore(session.initial);
    copiedFrom.current = null;
    session.closed = true;
    setGeneration(n => n + 1);
  }
  return { ready, restoration, status: session.status, error: session.error, updatedAt: session.updatedAt, flush: () => flushDraft(session), retry: () => session.status === "load-error" ? load(true) : flushDraft(session), reload: () => load(true), complete, discard, separateCopy, startAnother: recordId === "new" ? startAnother : null, session };
}
