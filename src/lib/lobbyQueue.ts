import { getLisbonDay } from '../utils/time.ts';
import { getModeFromTime } from './lobbySchedule.ts';

interface QueueContext {
  ownerId: string | null;
  roomId: string | null;
  isQueueing: boolean;
  queueDay: string | null;
}

export function canJoinLobbyQueue(state: QueueContext, userId: string | undefined, accepted: boolean, now: Date) {
  const mode = getModeFromTime(now);
  return Boolean(userId && state.ownerId === userId && !state.roomId && accepted
    && (mode === 'QUEUE' || mode === 'ACTIVE'));
}

// Local intent only: matching and eligibility still require the server RPC.
export function hasLobbyQueueIntent(state: QueueContext, userId: string | undefined, now: Date) {
  const mode = getModeFromTime(now);
  return Boolean(userId && state.ownerId === userId && !state.roomId && state.isQueueing
    && state.queueDay === getLisbonDay(now) && (mode === 'QUEUE' || mode === 'ACTIVE'));
}

export function shouldEnterChat(state: QueueContext, userId: string | undefined, accepted: boolean, now: Date) {
  return accepted && getModeFromTime(now) === 'ACTIVE' && hasLobbyQueueIntent(state, userId, now);
}
