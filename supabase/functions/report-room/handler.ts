import { authenticate, authorize, HttpError, json, validUuid, withRoomLock } from '../_shared/chat.ts';
import type { Dependencies } from '../_shared/chat.ts';

export async function reportRoom(req: Request, deps: Dependencies) {
  const userId = await authenticate(req, deps);
  const { roomId: requestedRoom } = (await req.json()) ?? {};
  if (!validUuid(requestedRoom)) throw new HttpError(400, 'Invalid room');
  const roomId = requestedRoom.toLowerCase();
  await withRoomLock(deps, roomId, async () => {
    // Same lock as send: freeze before snapshot, without losing an in-flight append.
    const room = await authorize(deps, roomId, userId, 'report');
    const raw = await deps.redis(['LRANGE', `room:${roomId}:messages`, 0, -1]) ?? [];
    const transcript = raw.map((value: unknown) => {
      const message = typeof value === 'string' ? JSON.parse(value) : value;
      if (!message || typeof message !== 'object') throw new HttpError(503, 'Invalid buffer');
      const m = message as Record<string, unknown>;
      if (m.sender_id !== userId && m.sender_id !== room.peer_id) throw new HttpError(503, 'Invalid buffer');
      return { id: m.id, text: m.text, timestamp: m.timestamp, sender: m.sender_id === userId ? 'reporter' : 'reported' };
    });
    const { error } = await deps.db.rpc('persist_room_report', {
      p_room: roomId, p_user: userId, p_transcript: transcript,
    });
    if (error) throw new HttpError(503, 'Report not saved; please retry');
    // No DEL: retain the buffer until its TTL for retries and the other reporter.
  });
  return json({ success: true });
}
