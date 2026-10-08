import { AUTH_TIMEOUT_MS } from './authOperations';

// Bound the UI wait as well as the SDK transport. A transport may still settle
// after abort; attaching both handlers prevents late rejection from escaping.
export function lobbyRequest<T>(controller: AbortController, send: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)]);
  let onAbort: () => void;
  const pending = new Promise<T>((resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return send(signal);
    }).then(resolve, reject);
  });
  return pending.finally(() => signal.removeEventListener('abort', onAbort));
}
