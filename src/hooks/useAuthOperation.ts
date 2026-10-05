import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { authErrorMessage, runAuthOperation } from '../lib/authOperations';

export function useAuthOperation() {
  const contextVersion = useAuthStore(state => state.contextVersion);
  const lifetime = useRef({ active: true, generation: 0, busy: false, controller: new AbortController() });
  const [state, setState] = useState({ contextVersion, loading: false, error: '' });
  const invalidate = () => {
    const life = lifetime.current;
    life.generation++; life.busy = false; life.controller.abort();
  };
  useEffect(() => {
    const life = lifetime.current;
    life.active = true;
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.contextVersion !== previous.contextVersion) invalidate();
    });
    return () => { life.active = false; invalidate(); unsubscribe(); };
  }, []);
  const clear = () => { invalidate(); setState({ contextVersion, loading: false, error: '' }); };
  const run = async <T,>(operation: Parameters<typeof authErrorMessage>[1],
    request: (current: () => boolean, signal: AbortSignal) => PromiseLike<T>, confirmed: (result: T) => void) => {
    const life = lifetime.current;
    if (life.busy) return;
    life.busy = true;
    life.controller = new AbortController();
    const generation = ++life.generation;
    const current = () => life.active && generation === life.generation && contextVersion === useAuthStore.getState().contextVersion;
    setState({ contextVersion, loading: true, error: '' });
    await runAuthOperation({
      current, request: () => request(current, life.controller.signal), confirmed,
      failed: error => setState({ contextVersion, loading: true, error: authErrorMessage(error, operation) }),
      settled: () => { life.busy = false; setState(state => ({ ...state, loading: false })); },
    });
  };
  return { loading: state.contextVersion === contextVersion && state.loading,
    error: state.contextVersion === contextVersion ? state.error : '', run, clear };
}
