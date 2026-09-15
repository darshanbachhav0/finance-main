// Only unsynchronized work is retained here. Confirmed drafts live on the server.
// Browser storage is encrypted with a non-extractable, per-account Web Crypto key.
const fileCache = new WeakMap();
let database;
async function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("uma-private-draft-outbox", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("keys"); request.result.createObjectStore("drafts", { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return database;
}
async function operation(store, mode, action) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
const keys = new Map();
async function accountKey(owner) {
  if (!keys.has(owner)) keys.set(owner, (async () => {
    let key = await operation("keys", "readonly", store => store.get(owner));
    if (!key) {
      const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      // add, not put: two tabs must never replace each other's encryption key.
      try { await operation("keys", "readwrite", store => store.add(generated, owner)); key = generated; }
      catch { key = await operation("keys", "readonly", store => store.get(owner)); }
    }
    return key;
  })());
  return keys.get(owner);
}
async function pack(value) {
  if (value instanceof File) {
    if (!fileCache.has(value)) fileCache.set(value, new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve({ __outboxFile: reader.result, name: value.name, type: value.type }); reader.onerror = () => reject(reader.error); reader.readAsDataURL(value);
    }));
    return fileCache.get(value);
  }
  if (Array.isArray(value)) return Promise.all(value.map(pack));
  if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).filter(([key]) => !/password|token|secret/i.test(key)).map(async ([key, child]) => [key, await pack(child)])));
  return value;
}
async function unpack(value) {
  if (value?.__outboxFile) {
    const bytes = Uint8Array.from(atob(value.__outboxFile.split(",")[1]), char => char.charCodeAt(0));
    return new File([bytes], value.name, { type: value.type });
  }
  if (Array.isArray(value)) return Promise.all(value.map(unpack));
  if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await unpack(child)])));
  return value;
}
export function cacheDraft(session) {
  session.cacheWrite = (session.cacheWrite || Promise.resolve()).catch(() => {}).then(async () => {
    if (session.closed || session.signature === session.savedSignature) return;
    const fingerprint = `${session.signature}:${session.revision}:${session.pending?.body?.mutationId || ""}`;
    if (session.cachedFingerprint === fingerprint) return;
    const snapshot = { id: session.id, revision: session.revision, value: session.value, pending: session.pending, savedSignature: session.savedSignature, updatedAt: session.updatedAt, sourceVersion: session.sourceVersion };
    const plain = new TextEncoder().encode(JSON.stringify(await pack(snapshot)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await accountKey(session.owner), plain);
    await operation("drafts", "readwrite", store => store.put({ id: `${session.owner}:${session.id}`, owner: session.owner, draftId: session.id, scope: session.scope, recordId: session.recordId, time: Date.now(), iv, encrypted }));
    session.cachedFingerprint = fingerprint;
  });
  return session.cacheWrite;
}
export async function readCachedDraft(owner, scope, recordId, id) {
  const rows = await operation("drafts", "readonly", store => store.getAll());
  const row = rows.filter(row => row.owner === owner && row.scope === scope && row.recordId === recordId && (!id || row.draftId === id)).sort((a, b) => b.time - a.time)[0];
  if (!row) return null;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv }, await accountKey(owner), row.encrypted);
  return unpack(JSON.parse(new TextDecoder().decode(plain)));
}
export async function removeCachedDraft(session) {
  await session.cacheWrite?.catch(() => {});
  if (!session.closed && session.signature !== session.savedSignature) return;
  await operation("drafts", "readwrite", store => store.delete(`${session.owner}:${session.id}`));
  session.cachedFingerprint = null;
}
