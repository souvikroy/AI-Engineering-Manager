/**
 * Auth session store.
 * Access token: in memory only.
 * Refresh token: persisted to IndexedDB, encrypted with WebCrypto AES-GCM.
 */

const DB_NAME = "reviewer";
const STORE = "session";
const KEY = "session";

const KEY_NAME = "reviewer-session-key";
const SALT_NAME = "reviewer-session-salt";
const REFRESH_FALLBACK_KEY = "reviewer-refresh-token";

let memo: { access: string | null; refresh: string | null } = { access: null, refresh: null };
const subscribers = new Set<() => void>();

function notify() { subscribers.forEach((fn) => fn()); }

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deriveKey(): Promise<CryptoKey> {
  // Derive a key from a stable, browser-bound string. This is *not* a hardened secret —
  // it raises the bar against passive disk reads of IndexedDB. Combined with the auth
  // server's refresh-token rotation + reuse detection, that's the right tradeoff.
  let salt = localStorage.getItem(SALT_NAME);
  if (!salt) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    salt = btoa(String.fromCharCode(...buf));
    localStorage.setItem(SALT_NAME, salt);
  }
  const seedSource = localStorage.getItem(KEY_NAME);
  let seed = seedSource;
  if (!seed) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    seed = btoa(String.fromCharCode(...buf));
    localStorage.setItem(KEY_NAME, seed);
  }
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(seed!), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt!), iterations: 250_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(plain: string): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  const out = new Uint8Array(iv.byteLength + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.byteLength);
  return btoa(String.fromCharCode(...out));
}

async function decrypt(b64: string): Promise<string> {
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv = buf.slice(0, 12);
  const data = buf.slice(12);
  const key = await deriveKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(pt);
}

async function readRefresh(): Promise<string | null> {
  // Primary: encrypted refresh token in IndexedDB.
  try {
    const db = await openDB();
    const v = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (v) {
      try {
        return await decrypt(v);
      } catch {
        // fall through to plaintext fallback
      }
    }
  } catch {
    // fall through to plaintext fallback
  }

  // Fallback: plaintext in localStorage (some environments block IDB/WebCrypto).
  try {
    return localStorage.getItem(REFRESH_FALLBACK_KEY);
  } catch {
    return null;
  }
}

async function writeRefresh(token: string | null): Promise<void> {
  // Primary: encrypted refresh token in IndexedDB.
  // Encrypt BEFORE opening the IDB transaction — IDB auto-commits across awaits.
  try {
    const enc = token ? await encrypt(token) : null;
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      try {
        if (enc !== null) store.put(enc, KEY);
        else store.delete(KEY);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    // Keep fallback in sync (best-effort).
    try {
      if (token) localStorage.setItem(REFRESH_FALLBACK_KEY, token);
      else localStorage.removeItem(REFRESH_FALLBACK_KEY);
    } catch {}
    return;
  } catch {
    // fall through to plaintext fallback
  }

  // Fallback: plaintext in localStorage.
  try {
    if (token) localStorage.setItem(REFRESH_FALLBACK_KEY, token);
    else localStorage.removeItem(REFRESH_FALLBACK_KEY);
  } catch {
    // ignore persistence errors; session can still work in-memory
  }
}

export const authStore = {
  get access() { return memo.access; },
  get refresh() { return memo.refresh; },

  subscribe(fn: () => void) { subscribers.add(fn); return () => subscribers.delete(fn); },

  async hydrate(): Promise<boolean> {
    if (memo.access) return true;
    const refresh = await readRefresh();
    if (!refresh) return false;
    memo.refresh = refresh;
    return await this.tryRefresh();
  },

  async setSession(opts: { access: string; refresh: string }) {
    memo.access = opts.access;
    memo.refresh = opts.refresh;
    try {
      await writeRefresh(opts.refresh);
    } catch {
      // persistence failure shouldn't block login
    }
    notify();
  },

  async clear() {
    memo.access = null;
    memo.refresh = null;
    try {
      await writeRefresh(null);
    } catch {
      // ignore
    }
    notify();
  },

  async tryRefresh(): Promise<boolean> {
    if (!memo.refresh) return false;
    const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:8000";
    try {
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: memo.refresh }),
      });
      if (!res.ok) {
        await this.clear();
        return false;
      }
      const data = await res.json();
      await this.setSession({ access: data.access_token, refresh: data.refresh_token });
      return true;
    } catch {
      return false;
    }
  },
};
