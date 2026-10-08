export async function saveLobbySuggestion(send: () => PromiseLike<{ error: unknown }>): Promise<boolean> {
  try {
    const result = await send();
    return result.error === null;
  } catch {
    return false;
  }
}
