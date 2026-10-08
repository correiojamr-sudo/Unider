import { AuthClient } from '@supabase/supabase-js';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AUTH_TIMEOUT_MS } from './authOperations';
import { getPublicConfig } from './publicConfig';

// The subscription wins over an older initial read, including its rejection.
export function observeAuthSession(options: {
  subscribe: (callback: (event: AuthChangeEvent, session: Session | null) => void) => () => void;
  getSession: () => PromiseLike<{ data: { session: Session | null }; error?: unknown }>;
  revision: () => number;
  apply: (session: Session | null, event?: AuthChangeEvent) => void;
  failed: () => void;
}) {
  let active = true;
  let receivedEvent = false;
  const revision = options.revision();
  const unsubscribe = options.subscribe((event, session) => {
    if (!active) return;
    receivedEvent = true;
    options.apply(session, event);
  });
  const current = () => active && !receivedEvent && revision === options.revision();
  const timer = setTimeout(() => { if (current()) options.failed(); }, AUTH_TIMEOUT_MS);
  Promise.resolve().then(options.getSession).then(result => {
    if (current()) {
      if (result.error) options.failed();
      else options.apply(result.data.session);
    }
  }).catch(() => { if (current()) options.failed(); }).finally(() => clearTimeout(timer));
  return () => { active = false; clearTimeout(timer); unsubscribe(); };
}

export const AUTH_STORAGE_CHANNEL = 'unider-auth-storage-changes';

// Scoped SDK events never reach the primary SDK's BroadcastChannel. Other tabs
// receive only a change notice and reread current storage, never an old session.
// Stage SDK storage mutations and commit only a successful, current operation.
export async function withScopedAuth<T>(current: () => boolean, signal: AbortSignal,
  request: (auth: InstanceType<typeof AuthClient>) => Promise<T>) {
  const { url, key } = getPublicConfig();
  const primaryKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const originalSession = localStorage.getItem(primaryKey);
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)]);
  const check = () => {
    if (!current() || boundedSignal.aborted || localStorage.getItem(primaryKey) !== originalSession) {
      throw new DOMException('Obsolete operation', 'AbortError');
    }
  };
  const operationKey = `unider-auth-operation-${crypto.randomUUID()}`;
  const primaryName = (name: string) => name.replace(operationKey, primaryKey);
  const staged = new Map<string, string | null>();
  const auth = new AuthClient({
    url: `${url.replace(/\/$/, '')}/auth/v1`, headers: { apikey: key, Authorization: `Bearer ${key}` },
    autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true,
    storageKey: operationKey,
    storage: {
      getItem: name => { check(); const target = primaryName(name); return staged.has(target) ? staged.get(target)! : localStorage.getItem(target); },
      setItem: (name, value) => { check(); staged.set(primaryName(name), value); },
      removeItem: name => { check(); staged.set(primaryName(name), null); },
    },
    fetch: async (input, init) => {
      check();
      const response = await fetch(input, { ...init, signal: boundedSignal });
      check();
      return response;
    },
  });
  try {
    const result = await request(auth);
    check();
    if (!(result as { error?: unknown } | null)?.error) {
      for (const [name, value] of staged) {
        if (value === null) localStorage.removeItem(name);
        else localStorage.setItem(name, value);
      }
      if (staged.size && typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(AUTH_STORAGE_CHANNEL);
        channel.postMessage('changed'); channel.close();
      }
    }
    return result;
  } finally { await auth.dispose(); }
}
