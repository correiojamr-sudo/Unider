import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Send } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import type { ChatMessage } from '../store/chatStore';
import { useChatSession } from '../hooks/useChatSession';
import { supabase } from '../lib/supabase';
import { formatTimeCountdown } from '../utils/time';
import { classifyChatError, reportIssueText, sameChatContext, sessionIssueText } from '../lib/chatRecovery';
import { runChatOperation } from '../lib/chatOperations';
import { useChatHistory } from '../hooks/useChatHistory';
import { chatMessageKey, validHistoryMessage } from '../lib/chatHistory';
import { matchIntentArgs } from '../lib/matchIntent';

export default function Chat() {
  const userId = useAuthStore(state => state.user?.id);
  const { ownerId, roomId, peerId, contextVersion } = useChatStore();
  return <ChatContent key={`${userId}:${ownerId}:${roomId}:${peerId}:${contextVersion}`} />;
}

function ChatContent() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const userId = user?.id;
  const { ownerId, roomId, peerId, contextVersion, messages, isQueueing } = useChatStore();
  const { room, status, error: sessionError, timeLeft, phase, fresh, applyRoom, retry, newPairsAvailable, canFindNext, confirmedRoomTime } = useChatSession();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [icebreaker, setIcebreaker] = useState('Qual foi a cadeira mais difícil que já tiveste?');
  const [reportFailed, setReportFailed] = useState(false);
  const mounted = useRef(false);
  const operationBusy = useRef(false);
  const pending = useRef<{ id: string; text: string; roomId: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const current = useCallback(() => mounted.current && sameChatContext({ ownerId, roomId, contextVersion }, useChatStore.getState(), useAuthStore.getState().user?.id), [ownerId, roomId, contextVersion]);
  const history = useChatHistory(roomId, userId, peerId, current);
  const historyStatus = history.onStatus;
  const startOperation = () => {
    if (!current() || operationBusy.current) return false;
    operationBusy.current = true;
    setBusy(true); setError('');
    return true;
  };
  const settled = () => { operationBusy.current = false; setBusy(false); };
  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  useEffect(() => {
    if (!roomId || !userId || !peerId) return;
    let cancelled = false;
    const channel = supabase.channel(`room:${roomId}`, { config: { private: true } })
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        if (cancelled || !current()) return;
        // Only service-role can publish. Still reject malformed/stale payloads.
        if (!validHistoryMessage(payload, userId, peerId)) return;
        useChatStore.getState().addMessage({ ...payload, id: payload.id.toLowerCase() });
      });
    void supabase.realtime.setAuth().then(() => {
      if (!cancelled && current()) channel.subscribe(result => {
        if (!cancelled && current()) { setConnected(result === 'SUBSCRIBED'); historyStatus(result); }
      });
    }).catch(() => { if (!cancelled && current()) setError('Não foi possível ligar ao canal privado.'); });
    void Promise.resolve(supabase.from('icebreaker_suggestions').select('suggestion').eq('is_approved', true).limit(100))
      .then(({ data }) => {
        if (!cancelled && current() && data?.length) setIcebreaker(data[Math.floor(Math.random() * data.length)].suggestion);
      }).catch(() => { /* The default prompt remains usable when this optional read fails. */ });
    return () => { cancelled = true; void supabase.removeChannel(channel); };
  // This content instance is keyed by user/owner/room/peer; callbacks belong to that instance.
  }, [roomId, peerId, userId, ownerId, current, historyStatus]);

  const leave = async (next: boolean) => {
    if (next && !canFindNext() || !startOperation()) return;
    const intent = useChatStore.getState().queueIntent;
    // Fence in-flight match replies immediately, without invalidating this exit.
    if (intent) useChatStore.getState().beginQueueCancellation();
    await runChatOperation({
      current, settled,
      request: async () => {
        if (intent) {
          const result = await supabase.rpc('leave_matchmaking', matchIntentArgs(intent)).abortSignal(AbortSignal.timeout(10000));
          if (result.error || !current()) return result;
        }
        return roomId ? await supabase.rpc('leave_room', { p_room: roomId }).abortSignal(AbortSignal.timeout(10000)) : { error: null };
      },
      confirmed: result => {
        if (result.error !== null) throw result.error || new Error('Unconfirmed leave');
        const queueNext = next && canFindNext();
        const queueTime = queueNext ? confirmedRoomTime() : null;
        useChatStore.getState().resetChat();
        if (queueTime) useChatStore.getState().setQueueing(true, queueTime);
        else navigate('/lobby');
      },
      failed: failure => {
        const issue = classifyChatError(failure);
        setError(issue.kind === 'denied' ? 'Saída recusada pelo servidor. O fecho não está confirmado; podes sair apenas deste separador.'
          : 'Não foi possível confirmar a saída. Tenta novamente ou sai apenas deste separador.');
      },
    });
  };

  const leaveLocally = () => {
    if (!current()) return;
    // Explicit recovery: stop old responses before clearing the persisted intent.
    mounted.current = false;
    useChatStore.getState().resetChat();
    navigate('/lobby');
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!roomId || !text || phase !== 'active' || !fresh || !connected || !startOperation()) return;
    if (!pending.current || pending.current.text !== text || pending.current.roomId !== roomId) {
      pending.current = { id: crypto.randomUUID(), text, roomId };
    }
    const message = pending.current;
    await runChatOperation({ current, settled,
      request: () => supabase.functions.invoke('send-message', { body: { roomId, message: { id: message.id, text } }, timeout: 10000 }),
      confirmed: ({ data, error: invokeError }) => {
        if (invokeError || !data?.success || data.message?.id !== message.id || data.message?.sender_id !== user?.id
          || data.message?.text !== text || typeof data.message?.timestamp !== 'string') throw invokeError || new Error('No confirmation');
        useChatStore.getState().addMessage(data.message as ChatMessage);
        setInput(''); pending.current = null;
      },
      failed: () => setError('Envio não confirmado. Tenta novamente; o mesmo texto mantém o identificador do envio.'),
    });
  };

  const extend = async () => {
    if (!roomId || !fresh || !startOperation()) return;
    await runChatOperation({ current, settled,
      request: () => supabase.rpc('extend_room', { p_room: roomId }).abortSignal(AbortSignal.timeout(10000)),
      confirmed: ({ data, error: rpcError }) => { if (rpcError) throw rpcError; applyRoom(data); },
      failed: () => setError('Não foi possível confirmar o prolongamento da conversa.'),
    });
  };

  const report = async () => {
    if (!roomId || !startOperation()) return;
    await runChatOperation({ current, settled,
      request: () => supabase.functions.invoke('report-room', { body: { roomId }, timeout: 10000 }),
      confirmed: ({ data, error: invokeError }) => {
        if (invokeError || data?.success !== true) throw invokeError || new Error('No confirmation');
        useChatStore.getState().resetChat();
        navigate('/lobby');
      },
      failed: failure => { setReportFailed(true); setError(reportIssueText(classifyChatError(failure))); },
    });
  };

  const recovery = <div className="space-y-2">
    {sessionError && <button disabled={busy} onClick={retry} className="bg-slate-700 rounded-xl p-3 text-sm">Tentar confirmar a conversa</button>}
    {(busy || error || sessionError || phase === 'loading' || reportFailed) && <div className="space-y-2 text-sm">
      <p className="text-slate-400">Sair apenas deste separador limpa o contexto local e a espera. Não confirma o fecho nem guarda uma denúncia pendente.</p>
      <button onClick={leaveLocally} className="border border-slate-600 rounded-xl p-3">Voltar ao lobby sem confirmar fecho</button>
    </div>}
  </div>;
  const displayedError = error || (sessionError ? sessionIssueText(sessionError) : '');

  if (!roomId) return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
      {isQueueing && <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />}
      <p className="text-slate-400">{status}</p>
      {displayedError && <p role="alert" className="text-red-300">{displayedError}</p>}
      <button disabled={busy} onClick={() => void leave(false)} className="bg-slate-700 rounded-xl p-3">Voltar ao Lobby</button>
      {recovery}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-[100dvh]">
      <header className="bg-slate-800 border-b border-slate-700 p-4 space-y-3">
        <div className="flex flex-wrap gap-2 justify-between items-center">
          <div className={`font-mono text-xl font-bold ${timeLeft <= 60 ? 'text-red-400' : 'text-blue-400'}`}>
            {formatTimeCountdown(timeLeft)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => void leave(false)} disabled={busy} className="text-sm bg-slate-700 rounded-lg p-2">Sair para o Lobby</button>
            <button onClick={() => void report()} disabled={busy} className="flex items-center gap-2 text-sm text-red-400">
              <ShieldAlert className="w-4 h-4" />{busy ? 'A processar...' : reportFailed ? 'Tentar denúncia novamente' : 'Denunciar'}
            </button>
          </div>
        </div>
        <p className="bg-slate-700/50 p-3 rounded-lg text-sm text-center italic">{icebreaker}</p>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 flex flex-col bg-slate-900">
        {messages.map(message => {
          const mine = message.sender_id === user?.id;
          return (
            <div key={chatMessageKey(message)} className={`flex flex-col max-w-[80%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
              <span className="text-[10px] text-slate-400 mb-1">{mine ? 'Tu' : 'Colega'}</span>
              <div className={`px-4 py-2 rounded-2xl break-words ${mine ? 'bg-blue-600' : 'bg-slate-800'}`}>{message.text}</div>
            </div>
          );
        })}
        <div ref={endRef} />
      </main>
      <footer className="p-4 bg-slate-800 border-t border-slate-700 pb-safe space-y-3">
        {history.text && <div className="text-sm text-slate-400 space-y-2">
          <p role={history.status === 'error' || history.status === 'unavailable' ? 'alert' : 'status'}>{history.text}</p>
          {(history.status === 'error' || history.status === 'unavailable') && <button
            onClick={history.retry} disabled={!connected || phase !== 'active'} className="underline disabled:opacity-50">Tentar recuperar mensagens</button>}
        </div>}
        {displayedError && <p role="alert" className="text-sm text-red-300">{displayedError}</p>}
        {recovery}
        {phase === 'decision' ? (
          <div className="space-y-3">
            <p className="text-center text-sm text-slate-300">O tempo terminou. Tens 30 segundos para decidir.</p>
            <div className="flex gap-3">
              <button disabled={busy || !newPairsAvailable} onClick={() => void leave(true)} className="flex-1 bg-slate-700 disabled:opacity-50 p-3 rounded-xl">Passar</button>
              <button disabled={busy || !fresh || room?.extended} onClick={() => void extend()} className="flex-1 bg-blue-600 disabled:opacity-50 p-3 rounded-xl">
                {room?.extended ? 'A aguardar colega...' : 'Continuar (+3 min)'}
              </button>
            </div>
          </div>
        ) : phase === 'closed' ? (
          <div className="space-y-3">
            <p className="text-center text-sm">{room?.end_reason === 'disconnect' ? 'O colega desconectou-se.' : 'A conversa terminou.'}</p>
            <div className="flex gap-3">
              <button disabled={busy || !newPairsAvailable} onClick={() => void leave(true)} className="flex-1 bg-blue-600 disabled:opacity-50 p-3 rounded-xl">Novo Chat</button>
            </div>
          </div>
        ) : (
          <>
            {(!connected || !fresh) && <p className="text-sm text-slate-400">A confirmar a ligação...</p>}
            <form onSubmit={event => void send(event)} className="flex gap-2">
              <input aria-label="Mensagem" value={input} onChange={event => setInput(event.target.value)} maxLength={2000}
                disabled={busy || phase !== 'active' || !fresh || !connected} placeholder="Escreve uma mensagem..."
                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm disabled:opacity-50" />
              <button type="submit" aria-label="Enviar mensagem" disabled={busy || !input.trim() || phase !== 'active' || !fresh || !connected}
                className="bg-blue-600 disabled:opacity-50 rounded-xl px-4"><Send className="w-5 h-5" /></button>
            </form>
          </>
        )}
        {!newPairsAvailable && (phase === 'closed' || phase === 'decision') && <p className="text-sm text-slate-400">Novos pares só estão disponíveis antes das 22h48, após confirmação do servidor.</p>}
      </footer>
    </div>
  );
}
