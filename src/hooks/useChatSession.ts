import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { roomView } from '../lib/chatSession';
import type { RoomState } from '../lib/chatSession';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';

export function useChatSession() {
  const userId = useAuthStore(s => s.user?.id);
  const roomId = useChatStore(s => s.roomId);
  const isQueueing = useChatStore(s => s.isQueueing);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [status, setStatus] = useState('A aguardar pelo próximo colega...');
  const [error, setError] = useState('');
  const [clock, setClock] = useState({ offset: 0, checkedAt: 0 });
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(0);
  const applyRoom = useCallback((data: RoomState) => {
    const timestamp = Date.parse(data.server_now);
    if (timestamp < latest.current) return;
    latest.current = timestamp;
    setRoom(data);
    setClock({ offset: Date.parse(data.server_now) - Date.now(), checkedAt: Date.now() });
    setError('');
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    latest.current = 0;
    setRoom(null);
    setError('');
    setClock({ offset: 0, checkedAt: 0 });
    if (isQueueing) setStatus('A aguardar pelo próximo colega...');
    if (!userId || (!roomId && !isQueueing)) return;
    const poll = async () => {
      try {
        const { data, error: rpcError } = roomId
          ? await supabase.rpc('get_room_state', { p_room: roomId })
          : await supabase.rpc('find_or_join_match');
        if (cancelled) return;
        if (rpcError) {
          setError('Não foi possível confirmar a conversa. Verifica a ligação e a tua conta.');
          setClock(c => ({ ...c, checkedAt: 0 }));
        } else if (data?.status === 'matched') {
          if (!roomId) {
            useChatStore.getState().setRoom(data.room_id, data.peer_id);
            useChatStore.getState().addPastPartner(data.peer_id);
          } else applyRoom(data);
        } else if (data?.status === 'closed') {
          setStatus('Já não são permitidas novas conversas hoje.');
          useChatStore.getState().setQueueing(false);
          return;
        }
      } catch {
        if (!cancelled) {
          setError('Ligação interrompida. A tentar novamente...');
          setClock(c => ({ ...c, checkedAt: 0 }));
        }
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId, roomId, isQueueing, applyRoom]);

  return { room, status, error, applyRoom, ...roomView(room, now + clock.offset),
    fresh: now - clock.checkedAt < 10000 };
}
