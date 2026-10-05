import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';
import { CLOCK_MAX_RTT_MS, CLOCK_POLL_MS, CLOCK_RETRY_MS, requestClock } from '../lib/serverClock';

export function useTimeSync() {
  const userId = useAuthStore(state => state.user?.id);
  const revision = useAuthStore(state => state.sessionRevision ?? 0);
  useEffect(() => {
    const store = useAppStore.getState();
    store.resetClock(userId, revision);
    if (!userId) return;
    let active = true, busy = false, lastAttempt = -Infinity;
    const controller = new AbortController();
    const current = () => active && useAuthStore.getState().user?.id === userId
      && (useAuthStore.getState().sessionRevision ?? 0) === revision;
    const sync = async () => {
      store.updateTime();
      if (!current() || busy || performance.now() - lastAttempt < CLOCK_RETRY_MS) return;
      busy = true; lastAttempt = performance.now();
      await requestClock({ userId, revision, current, elapsed: () => performance.now(),
        request: () => supabase.functions.invoke('get-server-time', { body: {},
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CLOCK_MAX_RTT_MS)]) }),
        confirmed: store.confirmClock, failed: store.failClock });
      busy = false;
    };
    void sync();
    const tick = setInterval(store.updateTime, 1000);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void sync(); }, CLOCK_POLL_MS);
    const focus = () => { void sync(); };
    const visible = () => { if (document.visibilityState === 'visible') void sync(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; controller.abort(); clearInterval(tick); clearInterval(poll);
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible); };
  }, [userId, revision]);
}
