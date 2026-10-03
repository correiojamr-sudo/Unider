import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
export function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export async function boundedFetch(input: RequestInfo | URL, init?: RequestInit) {
  return await fetch(input, { ...init, signal: AbortSignal.timeout(5000) });
}
export function dependencies() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch },
  });
  return {
    db,
    redis: async (command: unknown[]) => {
      const response = await boundedFetch(Deno.env.get('UPSTASH_REDIS_REST_URL')!, {
        method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('UPSTASH_REDIS_REST_TOKEN')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      if (!response.ok) throw new HttpError(503, 'Buffer unavailable');
      const data = await response.json();
      if (data.error) throw new HttpError(503, 'Buffer unavailable');
      return data.result;
    },
    broadcast: async (roomId: string, message: unknown) => {
      const response = await boundedFetch(`${url}/realtime/v1/api/broadcast`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ topic: `room:${roomId}`, event: 'message', payload: message, private: true }] }),
      });
      if (!response.ok) throw new HttpError(503, 'Delivery failed; retry the same message');
    },
  };
}
export type Dependencies = ReturnType<typeof dependencies>;
export async function authenticate(req: Request, deps: Dependencies) {
  const match = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new HttpError(401, 'Unauthorized');
  const { data, error } = await deps.db.auth.getUser(match[1]);
  if (error || !data.user) throw new HttpError(401, 'Unauthorized');
  return data.user.id;
}
export async function authorize(deps: Dependencies, roomId: string, userId: string, operation: string) {
  const { data, error } = await deps.db.rpc('authorize_room', { p_room: roomId, p_user: userId, p_operation: operation });
  if (error || !data?.peer_id) throw new HttpError(403, 'Room unavailable');
  return data;
}
export async function withRoomLock<T>(deps: Dependencies, roomId: string, action: (key: string, token: string) => Promise<T>) {
  const key = `room:${roomId}:lock`;
  const token = crypto.randomUUID();
  if (await deps.redis(['SET', key, token, 'NX', 'EX', 60]) !== 'OK') throw new HttpError(409, 'Room busy; retry');
  try { return await action(key, token); }
  finally {
    await deps.redis(['EVAL', "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, key, token]).catch(() => {});
  }
}
export function handler(action: (req: Request, deps: Dependencies) => Promise<Response>, deps = dependencies()) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    try { return await action(req, deps); }
    catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof SyntaxError) return json({ error: 'Invalid JSON' }, 400);
      console.error('Chat request failed', error instanceof Error ? error.name : 'UnknownError');
      return json({ error: 'Service unavailable; please retry' }, 503);
    }
  };
}
