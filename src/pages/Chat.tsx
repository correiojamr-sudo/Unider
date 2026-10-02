import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useAppStore } from '../store/appStore';
import { useChatStore } from "../store/chatStore";
import type { ChatMessage } from '../store/chatStore';
import { supabase } from '../lib/supabase';
import { getSecondsUntil, formatTimeCountdown } from '../utils/time';
import { ShieldAlert, Send } from 'lucide-react';
import { RealtimeChannel } from '@supabase/supabase-js';

export default function Chat() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentMode } = useAppStore();
  const { roomId, peerId, messages, extended, peerExtended, setRoom, addMessage, addPastPartner, setExtended, setPeerExtended, resetChat } = useChatStore();

  const [input, setInput] = useState('');
  const [timeLeft, setTimeLeft] = useState(120);
  const [statusText, setStatusText] = useState('A conectar à fila...');
  const [icebreaker, setIcebreaker] = useState('Qual foi a cadeira mais difícil que já tiveste?');
  const [reporting, setReporting] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [pollInterval, setPollInterval] = useState<number | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const activeRoomsChannelRef = useRef<RealtimeChannel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Matchmaking & Ephemeral Resilience
  useEffect(() => {
    if (currentMode !== 'ACTIVE' || !user) {
      navigate('/lobby');
      return;
    }

    const storeState = useChatStore.getState();

    // If no active room AND not currently actively queueing via Lobby, boot to lobby.
    if (!storeState.roomId && !storeState.isQueueing) {
        navigate('/lobby');
        return;
    }

    const initMatchmaking = async () => {
      // If already in a room, re-subscribe to room channel
      if (storeState.roomId) {
        setupRoomChannel(storeState.roomId);
        return;
      }

      setStatusText('A aguardar pelo próximo colega...');

      // Prevent new matches after 22:48
      if (getSecondsUntil('22:48:00') === 0 && getSecondsUntil('22:50:00') > 0) {
          setStatusText('Já não são permitidas novas conversas hoje.');
          return;
      }

      // Call the RPC to find or join a match
      const { data: newRoomId, error } = await supabase.rpc('find_or_join_match');

      if (error) {
        setStatusText('Erro ao procurar par.');
        return;
      }

      if (newRoomId) {
        // We got matched immediately (RPC returned a UUID)
        await prepareRoom(newRoomId);
      } else {
        // We are in the queue, waiting for someone else to match with us.
        // Subscribe to active_rooms inserts where user_a or user_b is us.
        const channel = supabase.channel('active_rooms_listen')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'active_rooms'
            },
            async (payload) => {
              const row = payload.new;
              if (row.user_a === user.id || row.user_b === user.id) {
                // Matched!
                if (activeRoomsChannelRef.current) supabase.removeChannel(activeRoomsChannelRef.current);
                await prepareRoom(row.id);
              }
            }
          )
          .subscribe();

        activeRoomsChannelRef.current = channel;

        // Fallback polling just in case the realtime event is missed
        const interval = window.setInterval(async () => {
            const { data: pollRoomId } = await supabase.rpc('find_or_join_match');
            if (pollRoomId) {
                window.clearInterval(interval);
                if (activeRoomsChannelRef.current) supabase.removeChannel(activeRoomsChannelRef.current);
                await prepareRoom(pollRoomId);
            }
        }, 3000);
        setPollInterval(interval);
      }
    };

    initMatchmaking();

    return () => {
      if (activeRoomsChannelRef.current) supabase.removeChannel(activeRoomsChannelRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (pollInterval) window.clearInterval(pollInterval);
    };
  }, [currentMode, user, roomId]);

  const prepareRoom = async (roomUuid: string) => {
    // Fetch room details to find peerId
    const { data: roomData } = await supabase
        .from('active_rooms')
        .select('user_a, user_b')
        .eq('id', roomUuid)
        .single();

    if (roomData && user) {
        const newPeerId = roomData.user_a === user.id ? roomData.user_b : roomData.user_a;
        setRoom(roomUuid, newPeerId);
        addPastPartner(newPeerId);
        setupRoomChannel(roomUuid);
        setTimeLeft(120);
        setReadOnly(false);

        // Fetch random icebreaker
        supabase.from('icebreaker_suggestions')
          .select('suggestion')
          .eq('is_approved', true)
          .limit(100)
          .then(({ data }) => {
            if (data && data.length > 0) {
                const randomIndex = Math.floor(Math.random() * data.length);
                setIcebreaker(data[randomIndex].suggestion);
            }
          });
    }
  };

  const setupRoomChannel = (currentRoomId: string) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const roomChannel = supabase.channel(currentRoomId);

    roomChannel.on('broadcast', { event: 'message' }, ({ payload }) => {
      addMessage(payload as ChatMessage);
    });

    roomChannel.on('broadcast', { event: 'action' }, ({ payload }) => {
      if (payload.type === 'EXTEND') {
        setPeerExtended(true);
      } else if (payload.type === 'LEAVE') {
        handlePeerLeft();
      }
    });

    roomChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            setStatusText('');
        }
    });
    channelRef.current = roomChannel;
  };

  // Timer logic
  useEffect(() => {
    if (!roomId) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [roomId]);

  // Extension logic
  useEffect(() => {
    if (extended && peerExtended && timeLeft === 0) {
      setTimeLeft(180); // +3 mins
      setExtended(false);
      setPeerExtended(false);
    }
  }, [extended, peerExtended, timeLeft]);

  // Global close logic at 22:50
  useEffect(() => {
    const secondsToClose = getSecondsUntil('22:50:00');
    if (secondsToClose === 0 && !readOnly) {
       handleLeaveAction();
    }
  }, [useAppStore(state => state.currentTime), readOnly]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !input.trim() || !user || !roomId) return;

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sender_id: user.id,
      text: input.trim(),
      timestamp: new Date().toISOString()
    };

    setInput('');
    addMessage(msg);

    // Send via Edge Function for buffer persistence
    await supabase.functions.invoke('send-message', {
        body: { roomId, message: msg }
    });
  };

  const handleExtend = async () => {
    setExtended(true);
    if (channelRef.current) {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'action',
        payload: { type: 'EXTEND' }
      });
    }
  };

  const handleLeaveAction = async () => {
    if (channelRef.current) {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'action',
        payload: { type: 'LEAVE' }
      });
    }
    setReadOnly(true);
    setStatusText('Saíste da conversa.');
  };

  const handleForceClose = () => {
    resetChat();
    navigate('/lobby');
  };

  const handlePeerLeft = () => {
    setReadOnly(true);
    setStatusText('O colega saiu da conversa.');
  };

  const handleReport = async () => {
    if (!roomId || !peerId || !user) return;
    setReporting(true);

    const { error } = await supabase.functions.invoke('report-room', {
      body: { roomId, reportedUserId: peerId, reason: 'Denúncia via app' }
    });

    if (error) {
       console.error("Failed to report room:", error);
    }
    setReporting(false);
    handleLeaveAction();
  };

  if (!roomId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
         <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4 mx-auto"></div>
         <p className="text-slate-400">{statusText}</p>
      </div>
    );
  }

  const isTimeUp = timeLeft === 0;
  const isCloseToEndingGlobal = getSecondsUntil('22:50:00') <= 60;
  const showWarning = (timeLeft <= 60 && timeLeft > 0) || isCloseToEndingGlobal;

  return (
    <div className="flex-1 flex flex-col h-[100dvh]">
      <header className="bg-slate-800 border-b border-slate-700 p-4 flex flex-col gap-3 relative z-10">
        <div className="flex justify-between items-center">
          <div className={`font-mono text-xl font-bold ${showWarning && !readOnly ? 'text-red-400 animate-pulse' : 'text-blue-400'}`}>
            {readOnly ? '00:00' : formatTimeCountdown(timeLeft)}
          </div>
          <button
            onClick={handleReport}
            disabled={reporting}
            className="flex items-center gap-2 text-xs font-medium text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 px-3 py-1.5 rounded-full transition-colors"
          >
            <ShieldAlert className="w-4 h-4" />
            Denunciar
          </button>
        </div>

        <div className="bg-slate-700/50 p-3 rounded-lg text-sm text-center italic text-slate-300">
          "{icebreaker}"
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col bg-slate-900">
        {messages.map((msg) => {
          const isMe = msg.sender_id === user?.id;
          return (
            <div key={msg.id} className={`flex flex-col max-w-[80%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}>
              <span className="text-[10px] text-slate-500 mb-1 px-1">{isMe ? 'Tu' : 'Colega'}</span>
              <div className={`px-4 py-2 rounded-2xl ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-slate-800 text-slate-200 rounded-tl-sm'}`}>
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <footer className="p-4 bg-slate-800 border-t border-slate-700 pb-safe">
        {readOnly ? (
            <div className="flex gap-3">
               <button
                onClick={handleForceClose}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-medium transition-colors"
               >
                 {getSecondsUntil('22:48:00') === 0 ? 'Sair para o Lobby' : 'Novo Chat'}
               </button>
            </div>
        ) : isTimeUp ? (
          <div className="flex gap-3">
            <button
              onClick={handleLeaveAction}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-medium transition-colors"
            >
              Passar
            </button>
            <button
              onClick={handleExtend}
              disabled={extended}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-300 text-white py-3 rounded-xl font-medium transition-colors"
            >
              {extended ? (peerExtended ? 'A prolongar...' : 'A aguardar colega...') : 'Continuar (+3 min)'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escreve uma mensagem..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl px-4 flex items-center justify-center transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        )}
      </footer>
    </div>
  );
}
