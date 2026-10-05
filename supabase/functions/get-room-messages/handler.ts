import { authenticate, authorize, HttpError, json, validUuid, withRoomLock } from '../_shared/chat.ts';
import type { Dependencies } from '../_shared/chat.ts';

// Only the ephemeral lock is created/released by withRoomLock. This script
// atomically fences the snapshot and never mutates buffer/dedup data or TTLs.
export const readScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {'expired'} end
if redis.call('LLEN', KEYS[2]) > 200 then return {'invalid'} end
return {'ok', redis.call('LRANGE', KEYS[2], 0, 199)}`;

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export async function getRoomMessages(req: Request, deps: Dependencies) {
  const userId = await authenticate(req, deps);
  if (!validUuid(userId)) throw new HttpError(401, 'Unauthorized');
  const { roomId: requestedRoom } = (await req.json()) ?? {};
  if (!validUuid(requestedRoom)) throw new HttpError(400, 'Invalid room');
  const roomId = requestedRoom.toLowerCase();
  const messages = await withRoomLock(deps, roomId, async (lock, token) => {
    // 'report' would freeze the conversation. Reading uses the active-message
    // authorization and rechecks it before returning data after the Redis read.
    const room = await authorize(deps, roomId, userId, 'message');
    if (room.room_id !== roomId || !validUuid(room.peer_id) || room.peer_id === userId) throw new HttpError(503, 'Invalid room state');
    const result: unknown = await deps.redis(['EVAL', readScript, 2, lock, `room:${roomId}:messages`, token]);
    if (!Array.isArray(result)) throw new HttpError(503, 'Invalid buffer');
    if (result[0] === 'expired') throw new HttpError(409, 'Room busy; retry');
    if (result.length !== 2 || result[0] !== 'ok' || !Array.isArray(result[1]) || result[1].length > 200) throw new HttpError(503, 'Invalid buffer');
    const seen = new Map<string, string>();
    const snapshot = result[1].map((value: unknown) => {
      let parsed: unknown;
      try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
      catch { throw new HttpError(503, 'Invalid buffer'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(503, 'Invalid buffer');
      const m = parsed as Record<string, unknown>;
      if (!validUuid(m.id) || (m.sender_id !== userId && m.sender_id !== room.peer_id)
        || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 2000 || !validTimestamp(m.timestamp)) {
        throw new HttpError(503, 'Invalid buffer');
      }
      const message = { id: m.id.toLowerCase(), sender_id: m.sender_id as string, text: m.text, timestamp: m.timestamp };
      const serialized = JSON.stringify(message);
      if (seen.has(message.id) && seen.get(message.id) !== serialized) throw new HttpError(503, 'Invalid buffer');
      seen.set(message.id, serialized);
      return message;
    });
    const confirmedRoom = await authorize(deps, roomId, userId, 'message');
    if (confirmedRoom.room_id !== roomId || confirmedRoom.peer_id !== room.peer_id) throw new HttpError(403, 'Room unavailable');
    return snapshot;
  });
  return json({ success: true, roomId, messages, partial: true });
}
