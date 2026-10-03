import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Send } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import type { ChatMessage } from '../store/chatStore';
import { useChatSession } from '../hooks/useChatSession';
import { supabase } from '../lib/supabase';
import { formatTimeCountdown } from '../utils/time';

export default function Chat() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const { roomId, peerId, messages, isQueueing } = useChatStore();
  const { room, status, error: sessionError, timeLeft, phase, fresh, applyRoom } = useChatSession();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [icebreaker, setIcebreaker] = useState('Qual foi a cadeira mais difícil que já tiveste?');
  const pending = useRef<{ id: string; text: string; roomId: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { setInput(''); setError(''); setBusy(false); pending.current = null; }, [roomId]);
  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  useEffect(() => {
    setConnected(false);
    if (!roomId || !user || !peerId) return;
    let cancelled = false;
    const channel = supabase.channel(`room:${roomId}`, { config: { private: true } })
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        if (cancelled || useChatStore.getState().roomId !== roomId) return;
        // Only service-role can publish. Still reject malformed/stale payloads.
        if (typeof payload?.id !== 'string' || typeof payload?.text !== 'string'
          || typeof payload?.timestamp !== 'string'
          || ![user.id, peerId].includes(payload.sender_id)) return;
        useChatStore.getState().addMessage(payload as ChatMessage);
      });
    void supabase.realtime.setAuth().then(() => {
      if (!cancelled) channel.subscribe(result => {
        if (!cancelled) setConnected(result === 'SUBSCRIBED');
      });
    }).catch(() => { if (!cancelled) setError('Não foi possível ligar ao canal privado.'); });
    void supabase.from('icebreaker_suggestions').select('suggestion').eq('is_approved', true).limit(100)
      .then(({ data }) => {
        if (!cancelled && data?.length) setIcebreaker(data[Math.floor(Math.random() * data.length)].suggestion);
      });
    return () => { cancelled = true; void supabase.removeChannel(channel); };
  }, [roomId, peerId, user]);

  const leave = async (next: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { error: rpcError } = roomId
        ? await supabase.rpc('leave_room', { p_room: roomId })
        : await supabase.rpc('leave_matchmaking');
      if (rpcError) throw rpcError;
      useChatStore.getState().resetChat();
      if (next) useChatStore.getState().setQueueing(true);
      else navigate('/lobby');
    } catch { setError('Não foi possível terminar a conversa. Tenta novamente.'); }
    finally { setBusy(false); }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!roomId || !text || busy || phase !== 'active' || !fresh || !connected) return;
    if (!pending.current || pending.current.text !== text || pending.current.roomId !== roomId) {
      pending.current = { id: crypto.randomUUID(), text, roomId };
    }
    const message = pending.current;
    setBusy(true); setError('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('send-message', {
        body: { roomId, message: { id: message.id, text } },
      });
      if (useChatStore.getState().roomId !== roomId) return;
      if (invokeError || !data?.success || !data.message) throw invokeError || new Error('No confirmation');
      useChatStore.getState().addMessage(data.message as ChatMessage);
      setInput(''); pending.current = null;
    } catch {
      if (useChatStore.getState().roomId === roomId) setError('Envio não confirmado. Tenta novamente; a mensagem não será duplicada.');
    } finally { if (useChatStore.getState().roomId === roomId) setBusy(false); }
  };

  const extend = async () => {
    if (!roomId || busy || !fresh) return;
    setBusy(true); setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('extend_room', { p_room: roomId });
      if (rpcError) throw rpcError;
      if (useChatStore.getState().roomId === roomId) applyRoom(data);
    } catch { setError('Não foi possível prolongar a conversa.'); }
    finally { setBusy(false); }
  };

  const report = async () => {
    if (!roomId || busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('report-room', { body: { roomId } });
      if (invokeError || !data?.success) throw invokeError || new Error('No confirmation');
      // Stay here on failure, preserving the room and the ability to retry.
      useChatStore.getState().resetChat();
      navigate('/lobby');
    } catch { setError('Denúncia não guardada. A conversa foi suspensa; tenta novamente.'); }
    finally { setBusy(false); }
  };

  if (!roomId) return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
      {isQueueing && <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />}
      <p className="text-slate-400">{status}</p>
      {(error || sessionError) && <p role="alert" className="text-red-300">{error || sessionError}</p>}
      <button disabled={busy} onClick={() => void leave(false)} className="bg-slate-700 rounded-xl p-3">Voltar ao Lobby</button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-[100dvh]">
      <header className="bg-slate-800 border-b border-slate-700 p-4 space-y-3">
        <div className="flex justify-between items-center">
          <div className={`font-mono text-xl font-bold ${timeLeft <= 60 ? 'text-red-400' : 'text-blue-400'}`}>
            {formatTimeCountdown(timeLeft)}
          </div>
          <button onClick={() => void report()} disabled={busy} className="flex items-center gap-2 text-sm text-red-400">
            <ShieldAlert className="w-4 h-4" />{busy ? 'A processar...' : 'Denunciar'}
          </button>
        </div>
        <p className="bg-slate-700/50 p-3 rounded-lg text-sm text-center italic">{icebreaker}</p>
      </header>
      <main className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col bg-slate-900">
        {messages.map(message => {
          const mine = message.sender_id === user?.id;
          return (
            <div key={message.id} className={`flex flex-col max-w-[80%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
              <span className="text-[10px] text-slate-500 mb-1">{mine ? 'Tu' : 'Colega'}</span>
              <div className={`px-4 py-2 rounded-2xl break-words ${mine ? 'bg-blue-600' : 'bg-slate-800'}`}>{message.text}</div>
            </div>
          );
        })}
        <div ref={endRef} />
      </main>
      <footer className="p-4 bg-slate-800 border-t border-slate-700 pb-safe space-y-3">
        {(error || sessionError) && <p role="alert" className="text-sm text-red-300">{error || sessionError}</p>}
        {phase === 'decision' ? (
          <div className="space-y-3">
            <p className="text-center text-sm text-slate-300">O tempo terminou. Tens 30 segundos para decidir.</p>
            <div className="flex gap-3">
              <button disabled={busy} onClick={() => void leave(true)} className="flex-1 bg-slate-700 p-3 rounded-xl">Passar</button>
              <button disabled={busy || !fresh || room?.extended} onClick={() => void extend()} className="flex-1 bg-blue-600 disabled:opacity-50 p-3 rounded-xl">
                {room?.extended ? 'A aguardar colega...' : 'Continuar (+3 min)'}
              </button>
            </div>
          </div>
        ) : phase === 'closed' ? (
          <div className="space-y-3">
            <p className="text-center text-sm">{room?.end_reason === 'disconnect' ? 'O colega desconectou-se.' : 'A conversa terminou.'}</p>
            <div className="flex gap-3">
              <button disabled={busy} onClick={() => void leave(false)} className="flex-1 bg-slate-700 p-3 rounded-xl">Sair para o Lobby</button>
              <button disabled={busy} onClick={() => void leave(true)} className="flex-1 bg-blue-600 p-3 rounded-xl">Novo Chat</button>
            </div>
          </div>
        ) : (
          <>
            {(!connected || !fresh) && <p className="text-sm text-slate-400">A confirmar a ligação...</p>}
            <form onSubmit={event => void send(event)} className="flex gap-2">
              <input value={input} onChange={event => setInput(event.target.value)} maxLength={2000}
                disabled={busy || phase !== 'active' || !fresh || !connected} placeholder="Escreve uma mensagem..."
                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm disabled:opacity-50" />
              <button type="submit" disabled={busy || !input.trim() || phase !== 'active' || !fresh || !connected}
                className="bg-blue-600 disabled:opacity-50 rounded-xl px-4"><Send className="w-5 h-5" /></button>
            </form>
          </>
        )}
      </footer>
    </div>
  );
}
