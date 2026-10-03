import { authenticate, authorize, HttpError, json, validUuid, withRoomLock } from '../_shared/chat.ts';
import type { Dependencies } from '../_shared/chat.ts';

// Atomic buffer append, deduplication and fencing of the room lock.
export const appendScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {'expired'} end
local old = redis.call('HGET', KEYS[2], ARGV[2])
if old then return {'ok', old} end
if redis.call('HLEN', KEYS[2]) >= 200 then return {'quota'} end
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
redis.call('RPUSH', KEYS[3], ARGV[4])
redis.call('EXPIRE', KEYS[2], 600)
redis.call('EXPIRE', KEYS[3], 300)
return {'ok', ARGV[3]}`;

export async function sendMessage(req: Request, deps: Dependencies) {
  const userId = await authenticate(req, deps);
  const { roomId: requestedRoom, message } = (await req.json()) ?? {};
  if (!validUuid(requestedRoom) || !validUuid(message?.id) || typeof message?.text !== 'string'
    || !message.text.trim() || message.text.length > 2000
    || (message.sender_id !== undefined && message.sender_id !== userId)) throw new HttpError(400, 'Invalid message');
  const roomId = requestedRoom.toLowerCase();
  const messageId = message.id.toLowerCase();
  const result = await withRoomLock(deps, roomId, async (lock, token) => {
    await authorize(deps, roomId, userId, 'message');
    const candidate = { id: messageId, sender_id: userId, text: message.text.trim(), timestamp: new Date().toISOString() };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(candidate.text));
    const textHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const metadata = { id: messageId, sender_id: userId, timestamp: candidate.timestamp, text_hash: textHash };
    const [status, cached] = await deps.redis(['EVAL', appendScript, 3, lock,
      `room:${roomId}:dedup`, `room:${roomId}:messages`, token, `${userId}:${messageId}`, JSON.stringify(metadata), JSON.stringify(candidate)]);
    if (status !== 'ok') throw new HttpError(status === 'quota' ? 429 : 409, 'Message unavailable; retry');
    const saved = typeof cached === 'string' ? JSON.parse(cached) : cached;
    if (saved.text_hash !== textHash || saved.sender_id !== userId) throw new HttpError(409, 'Message ID already used');
    const confirmed = { id: saved.id, sender_id: userId, text: candidate.text, timestamp: saved.timestamp };
    await deps.broadcast(roomId, confirmed);
    return confirmed;
  });
  return json({ success: true, message: result });
}
