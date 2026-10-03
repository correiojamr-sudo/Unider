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
