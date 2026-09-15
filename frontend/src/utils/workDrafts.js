import api from "../api/client.js";
import { cacheDraft, removeCachedDraft } from "./draftOutbox.js";

const sessions = new Map();
const fileIds = new WeakMap();
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const draftFingerprint = value => JSON.stringify(value, (_key, child) => {
  if (child instanceof File) {
    if (!fileIds.has(child)) fileIds.set(child, uuid());
    return { file: fileIds.get(child) };
  }
  return child;
});
export function draftSignal(session, status, error = "") {
  session.status = status; session.error = error;
  session.listeners.forEach(listener => listener());
}
async function encode(value, session) {
  if (value instanceof File) {
    if (!session.files.has(value)) {
      const data = new FormData(); data.append("supporting", value);
      const response = await api.post(`/work-drafts/${session.id}/files`, data, { timeout: 120000 });
      session.files.set(value, response.data.data);
    }
    return session.files.get(value);
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => encode(item, session)));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      // User administration uses the same editor; passwords must always be re-entered.
      if (/password|token|secret/i.test(key)) continue;
      result[key] = await encode(child, session);
    }
    return result;
  }
  return value;
}
export async function decodeDraft(value, session) {
  if (value?.__draftFile) {
    const response = await api.get(`/work-drafts/${session.id}/files/${value.__draftFile}`, { responseType: "blob", timeout: 120000 });
    const file = new File([response.data], value.name, { type: value.type });
    session.files.set(file, value);
    return file;
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => decodeDraft(item, session)));
  if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await decodeDraft(child, session)])));
  return value;
}
export function draftSession(key, metadata) {
  if (!sessions.has(key) || sessions.get(key).closed) sessions.set(key, { ...metadata, id: uuid(), revision: 0, listeners: new Set(), files: new WeakMap(), status: "loading", loaded: false, closed: false });
  return sessions.get(key);
}
async function put(session, value, signature) {
  if (!session.pending) session.pending = { body: { scope: session.scope, recordId: session.recordId, route: session.route, title: session.title, sourceVersion: session.sourceVersion, revision: session.revision, mutationId: uuid(), value }, signature };
  const response = await api.put(`/work-drafts/${session.id}`, session.pending.body, { timeout: 15000 });
  session.revision = response.data.data.revision;
  session.savedSignature = session.pending.signature;
  session.pending = null;
  session.updatedAt = response.data.data.updatedAt;
  window.dispatchEvent(new Event("uma:drafts-changed"));
}
export function flushDraft(session) {
  clearTimeout(session.timer);
  if (session.inflight) return session.inflight;
  if (!session.loaded || session.closed || session.status === "conflict" || session.status === "load-error") return Promise.resolve(false);
  if (!session.pending && session.signature === session.savedSignature) return Promise.resolve(true);
  session.inflight = Promise.resolve().then(async () => {
    try {
      while (!session.closed && (session.pending || session.signature !== session.savedSignature)) {
        draftSignal(session, "saving");
        if (session.pending) { await put(session); continue; }
        const value = session.value;
        const signature = session.signature;
        // Establish ownership before uploading any private attachments.
        if (session.revision === 0) await put(session, null, "__empty");
        const encoded = await encode(value, session);
        await put(session, encoded, signature);
      }
      draftSignal(session, "saved");
      void removeCachedDraft(session).catch(() => {});
      if (session.copySource) { void removeCachedDraft(session.copySource).catch(() => {}); session.copySource = null; }
      return true;
    } catch (error) {
      void cacheDraft(session).catch(() => { session.backupFailed = true; });
      draftSignal(session, error.status === 409 ? "conflict" : "error", error.message);
      return false;
    } finally { session.inflight = null; }
  });
  return session.inflight;
}
export async function flushAllDrafts() {
  return (await Promise.all([...sessions.values()].filter(s => !s.closed && s.loaded).map(flushDraft))).every(Boolean);
}
export function clearDraftSessions() { for (const session of sessions.values()) { session.closed = true; clearTimeout(session.timer); } sessions.clear(); }
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void flushAllDrafts(); });
  window.addEventListener("beforeunload", event => {
    if ([...sessions.values()].some(s => !s.closed && s.loaded && s.signature !== s.savedSignature)) {
      void flushAllDrafts(); event.preventDefault(); event.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flushAllDrafts(); });
  setInterval(() => { for (const session of sessions.values()) if (session.status === "error") void flushDraft(session); }, 15000);
}
