export interface RoomState {
  status: 'matched';
  room_id: string;
  peer_id: string;
  expires_at: string;
  hard_close_at: string;
  decision_until: string;
  ended_at: string | null;
  end_reason: string | null;
  extended_once: boolean;
  extended: boolean;
  peer_extended: boolean;
  server_now: string;
}
export function isRoomState(data: unknown, roomId?: string | null): data is RoomState {
  if (!data || typeof data !== 'object') return false;
  const value = data as Record<string, unknown>;
  return value.status === 'matched' && typeof value.room_id === 'string' && value.room_id.length > 0
    && (!roomId || value.room_id === roomId) && typeof value.peer_id === 'string'
    && ['expires_at', 'hard_close_at', 'decision_until', 'server_now'].every(key => typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key] as string)))
    && (value.ended_at === null || typeof value.ended_at === 'string' && Number.isFinite(Date.parse(value.ended_at)))
    && (value.end_reason === null || typeof value.end_reason === 'string')
    && ['extended_once', 'extended', 'peer_extended'].every(key => typeof value[key] === 'boolean');
}
export function roomView(room: RoomState | null, now: number) {
  if (!room) return { timeLeft: 0, phase: 'loading' as const };
  const expires = Date.parse(room.expires_at);
  const closed = room.ended_at !== null || now >= Date.parse(room.hard_close_at)
    || now >= Date.parse(room.decision_until);
  return {
    timeLeft: Math.max(0, Math.ceil((expires - now) / 1000)),
    phase: closed ? 'closed' as const : now >= expires ? 'decision' as const : 'active' as const,
  };
}
