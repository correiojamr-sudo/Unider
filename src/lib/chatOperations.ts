// This guard also checks instance lifetime, supplied by the caller. Equal IDs
// alone cannot make a response from an unmounted conversation current again.
export async function runChatOperation<T>(options: {
  request: () => PromiseLike<T>;
  current: () => boolean;
  confirmed: (result: T) => void;
  failed: (error: unknown) => void;
  settled: () => void;
}) {
  try {
    const result = await options.request();
    if (options.current()) options.confirmed(result);
  } catch (error) {
    if (options.current()) options.failed(error);
  } finally {
    if (options.current()) options.settled();
  }
}
