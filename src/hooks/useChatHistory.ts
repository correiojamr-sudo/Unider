import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useChatStore } from '../store/chatStore';
import { createChatHistoryRecovery } from '../lib/chatHistory';
import type { HistoryState } from '../lib/chatHistory';

export function useChatHistory(roomId: string | null, userId: string | undefined, peerId: string | null, current: () => boolean) {
  const machine = useRef<ReturnType<typeof createChatHistoryRecovery> | null>(null);
  const [state, setState] = useState<HistoryState>({ status: 'idle', text: '' });
  useEffect(() => {
    if (!roomId || !userId || !peerId) return;
    const recovery = createChatHistoryRecovery({
      roomId, userId, peerId, current, state: setState,
      request: signal => supabase.functions.invoke('get-room-messages', { body: { roomId }, signal, timeout: 10000 }),
      merge: messages => useChatStore.getState().mergeMessages(messages),
    });
    machine.current = recovery;
    return () => { recovery.stop(); if (machine.current === recovery) machine.current = null; };
  }, [roomId, userId, peerId, current]);
  const onStatus = useCallback((status: string) => { void machine.current?.status(status === 'SUBSCRIBED'); }, []);
  const retry = useCallback(() => { void machine.current?.retry(); }, []);
  return { ...state, onStatus, retry };
}
