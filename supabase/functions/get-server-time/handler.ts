import { authenticate, json, validUuid, HttpError } from '../_shared/chat.ts';
import type { Dependencies } from '../_shared/chat.ts';
// Presentation only: no matching RPC, SQL mutation, Redis or broadcast.
export async function getServerTime(req: Request, deps: Dependencies) {
  const userId = await authenticate(req, deps);
  if (!validUuid(userId)) throw new HttpError(401, 'Unauthorized');
  const response = json({ server_now: new Date().toISOString() });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
