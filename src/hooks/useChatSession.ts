import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isRoomState, roomView } from '../lib/chatSession';
import type { RoomState } from '../lib/chatSession';
import { classifyChatError, sameChatContext } from '../lib/chatRecovery';
import type { ChatIssue } from '../lib/chatRecovery';
import { getModeFromTime } from '../lib/lobbySchedule';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';

export function useChatSession() {
  const userId = useAuthStore(s => s.user?.id);
  const roomId = useChatStore(s => s.roomId);
  const ownerId = useChatStore(s => s.ownerId);
  const contextVersion = useChatStore(s => s.contextVersion);
  const isQueueing = useChatStore(s => s.isQueueing);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<{
    userId?: string; roomId: string | null; room: RoomState | null;
    error: ChatIssue | null; offset: number; checkedAt: number; closedQueue: boolean;
  }>({ userId, roomId, room: null, error: null, offset: 0, checkedAt: 0, closedQueue: false });
  const [now, setNow] = useState(() => Date.now());
  const lifetime = useRef(0);
  const current = useCallback(() => sameChatContext({ ownerId, roomId, contextVersion }, useChatStore.getState(), useAuthStore.getState().user?.id), [ownerId, roomId, contextVersion]);
  const applyRoom = useCallback((data: RoomState) => {
    if (!current() || !isRoomState(data, roomId)) return;
    const timestamp = Date.parse(data.server_now);
    setState(previous => {
      if (previous.userId === userId && previous.roomId === roomId && previous.room
        && timestamp < Date.parse(previous.room.server_now)) return previous;
      return { userId, roomId, room: data, error: null, offset: timestamp - Date.now(), checkedAt: Date.now(), closedQueue: false };
    });
  }, [current, roomId, userId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const version = ++lifetime.current;
    const valid = () => lifetime.current === version && current() && (Boolean(roomId) || useChatStore.getState().isQueueing === isQueueing);
    let timer: ReturnType<typeof setTimeout>;
    if (!userId || ownerId !== userId || (!roomId && !isQueueing)) return;
    const fail = (error: unknown, status?: number) => {
      const issue = classifyChatError(error, status);
      setState(previous => ({ ...previous, userId, roomId, error: issue, checkedAt: 0 }));
      return issue.kind !== 'denied';
    };
    const poll = async () => {
      let again = true;
      try {
        const request = roomId ? supabase.rpc('get_room_state', { p_room: roomId }) : supabase.rpc('find_or_join_match');
        const { data, error: rpcError, status } = await request.abortSignal(AbortSignal.timeout(10000));
        if (!valid()) return;
        if (rpcError) {
          again = fail(rpcError, status);
        } else if (isRoomState(data, roomId)) {
          if (!roomId) {
            useChatStore.getState().setRoom(data.room_id, data.peer_id);
            useChatStore.getState().addPastPartner(data.peer_id);
          } else applyRoom(data);
        } else if (!roomId && data?.status === 'closed') {
          setState({ userId, roomId, room: null, error: null, checkedAt: 0, offset: 0, closedQueue: true });
          useChatStore.getState().setQueueing(false);
          return;
        } else if (!roomId && data?.status === 'waiting') {
          setState(previous => ({ ...previous, userId, roomId, error: null, closedQueue: false }));
        } else {
          again = fail({ code: 'UNCONFIRMED_RESPONSE' });
        }
      } catch (error) {
        if (valid()) again = fail(error);
      }
      if (valid() && again) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { lifetime.current += 1; clearTimeout(timer); };
  }, [userId, ownerId, roomId, isQueueing, applyRoom, current, retryKey]);

  const same = state.userId === userId && state.roomId === roomId && ownerId === userId;
  const room = same ? state.room : null;
  const error = same ? state.error : null;
  const fresh = same && Boolean(room) && !error && state.checkedAt > 0 && now - state.checkedAt < 10000;
  const confirmedRoomTime = () => same && current() && room && !error && state.checkedAt > 0
    && Date.now() - state.checkedAt >= 0 && Date.now() - state.checkedAt < 10000 ? new Date(Date.now() + state.offset) : null;
  const canFindNext = () => { const time = confirmedRoomTime(); return Boolean(time && getModeFromTime(time) === 'ACTIVE'); };
  const status = state.closedQueue && same ? 'Já não são permitidas novas conversas hoje.'
    : isQueueing ? 'A aguardar pelo próximo colega...' : roomId ? 'A confirmar a conversa...' : 'Não há conversa em curso.';
  return { room, status, error, applyRoom, retry: () => setRetryKey(key => key + 1), canFindNext, confirmedRoomTime,
    newPairsAvailable: fresh && getModeFromTime(new Date(now + state.offset)) === 'ACTIVE',
    ...roomView(room, now + (same ? state.offset : 0)), fresh };
}
