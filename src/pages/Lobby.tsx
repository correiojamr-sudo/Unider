import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { supabase } from '../lib/supabase';
import { formatTimeCountdown } from '../utils/time';
import { lobbySchedule } from '../lib/lobbySchedule';
import { canJoinLobbyQueue, hasLobbyQueueIntent, shouldEnterChat } from '../lib/lobbyQueue';
import { saveLobbySuggestion } from '../lib/lobbySuggestion';
import { lobbyRequest } from '../lib/lobbyRequest';
import { matchIntentArgs } from '../lib/matchIntent';
import { LogOut, Clock, Send, Users, Settings } from 'lucide-react';
import TermsModal from '../components/modals/TermsModal';
import SettingsModal from '../components/modals/SettingsModal';

type TermsStatus = 'checking' | 'required' | 'accepted' | 'error';

export default function Lobby() {
  const userId = useAuthStore(state => state.user?.id);
  return <LobbyContent key={userId ?? 'signed-out'} />;
}

function LobbyContent() {
  const navigate = useNavigate();
  const { currentTime, clockStatus, clockFailed } = useAppStore();
  const { user, signOut, sessionRevision = 0 } = useAuthStore();
  const userId = user?.id;
  const chat = useChatStore();
  const schedule = lobbySchedule(currentTime);
  const currentMode = schedule.mode;

  const [suggestion, setSuggestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const suggestionRequest = useRef(0);
  const suggestionBusy = useRef(false);
  const suggestionController = useRef<AbortController | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [terms, setTerms] = useState<{ userId?: string; revision?: number; status: TermsStatus }>({ status: 'checking' });
  const [termsRetry, setTermsRetry] = useState(0);
  const termsStatus = terms.userId === userId && terms.revision === sessionRevision ? terms.status : 'checking';
  const accepted = Boolean(userId && termsStatus === 'accepted');
  const clockReady = clockStatus === 'confirmed' && Boolean(useAppStore.getState().confirmedTime(userId, sessionRevision));
  const inQueue = clockReady ? hasLobbyQueueIntent(chat, userId, currentTime)
    : Boolean(userId && chat.ownerId === userId && !chat.roomId && chat.isQueueing);
  const ownRoom = Boolean(userId && chat.ownerId === userId && chat.roomId);
  const [queueCancelError, setQueueCancelError] = useState('');
  const [queueCancelBusy, setQueueCancelBusy] = useState(false);
  const queueCancelRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const current = () => !cancelled && useAuthStore.getState().user?.id === userId
      && (useAuthStore.getState().sessionRevision ?? 0) === sessionRevision;
    const unsubscribe = useAuthStore.subscribe(() => { if (!current()) controller.abort(); });
    const checkTerms = async () => {
      if (!userId) return;
      setTerms({ userId, revision: sessionRevision, status: 'checking' });
      try {
        const { data, error } = await lobbyRequest(controller, signal => supabase.from('profiles')
          .select('terms_version').eq('id', userId).abortSignal(signal).single());
        if (current()) {
          setTerms({ userId, revision: sessionRevision, status: error || !data ? 'error' : data.terms_version === '1.1' ? 'accepted' : 'required' });
        }
      } catch {
        if (current()) setTerms({ userId, revision: sessionRevision, status: 'error' });
      } finally {
        controller.abort();
      }
    };
    void checkTerms();
    return () => { cancelled = true; unsubscribe(); controller.abort(); };
  }, [userId, sessionRevision, termsRetry]);

  useEffect(() => {
    const state = useChatStore.getState();
    const now = useAppStore.getState().confirmedTime(userId, sessionRevision);
    if (!now || state.ownerId !== userId || state.roomId) return;
    if (state.isQueueing && !hasLobbyQueueIntent(state, userId, now)) {
      state.setQueueing(false);
    } else if (useAuthStore.getState().user?.id === userId && shouldEnterChat(state, userId, accepted, now)) {
      navigate('/chat');
    }
  }, [currentTime, clockStatus, chat.isQueueing, chat.queueDay, chat.queueCancelling, chat.ownerId, chat.roomId, userId, sessionRevision, accepted, navigate]);

  useEffect(() => {
    return () => { queueCancelRequest.current += 1; };
  }, []);

  useEffect(() => {
    const unsubscribe = useAuthStore.subscribe(state => {
      if ((state.sessionRevision ?? 0) === sessionRevision) return;
      suggestionRequest.current += 1;
      suggestionController.current?.abort();
      if (suggestionBusy.current) {
        suggestionBusy.current = false;
        setSubmitting(false);
        setSuggestionError('Não foi possível confirmar o envio. O texto foi mantido; a sugestão pode já ter sido recebida.');
      }
      setSubmitted(false);
    });
    return () => {
      unsubscribe();
      suggestionRequest.current += 1;
      suggestionController.current?.abort();
    };
  }, [sessionRevision]);

  useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(() => setSubmitted(false), 3000);
    return () => clearTimeout(timer);
  }, [submitted]);

  const handleSuggest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || suggestionBusy.current || suggestion.length < 5 || suggestion.length > 180) return;
    const request = ++suggestionRequest.current;
    const controller = new AbortController();
    suggestionController.current = controller;
    const current = () => request === suggestionRequest.current && useAuthStore.getState().user?.id === userId
      && (useAuthStore.getState().sessionRevision ?? 0) === sessionRevision;
    const unsubscribe = useAuthStore.subscribe(() => { if (!current()) controller.abort(); });
    suggestionBusy.current = true;
    setSubmitting(true);
    setSubmitted(false);
    setSuggestionError('');
    try {
      const confirmed = await saveLobbySuggestion(() => lobbyRequest(controller, signal => supabase
        .from('icebreaker_suggestions').insert({ user_id: userId, suggestion }).abortSignal(signal)));
      if (!current()) return;
      if (confirmed) {
        setSubmitted(true);
        setSuggestion('');
      } else {
        setSuggestionError('Não foi possível confirmar o envio. O texto foi mantido; a sugestão pode já ter sido recebida.');
      }
    } finally {
      unsubscribe(); controller.abort();
      if (current()) {
        suggestionBusy.current = false;
        suggestionController.current = null;
        setSubmitting(false);
      }
    }
  };

  const handleJoinQueue = () => {
    const state = useChatStore.getState();
    const now = useAppStore.getState().confirmedTime(userId, sessionRevision);
    if (!now || useAuthStore.getState().user?.id !== userId || !canJoinLobbyQueue(state, userId, accepted, now)) return;
    state.setQueueing(true, now);
  };

  const cancelQueue = async () => {
    const state = useChatStore.getState();
    if (state.ownerId !== userId || queueCancelBusy) return;
    if (!state.queueIntent) { state.setQueueing(false); return; }
    const request = ++queueCancelRequest.current;
    const current = () => request === queueCancelRequest.current && useAuthStore.getState().user?.id === userId
      && useChatStore.getState().contextVersion === state.contextVersion;
    state.beginQueueCancellation();
    setQueueCancelBusy(true); setQueueCancelError('');
    try {
      const result = await supabase.rpc('leave_matchmaking', matchIntentArgs(state.queueIntent)).abortSignal(AbortSignal.timeout(10000));
      if (!current()) return;
      if (result.error) throw result.error;
      useChatStore.getState().setQueueing(false);
    } catch {
      if (current()) setQueueCancelError('Cancelamento não confirmado. A entrada automática está suspensa; tenta novamente.');
    } finally {
      if (request === queueCancelRequest.current) setQueueCancelBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center p-6 space-y-8 relative">
      {termsStatus === 'required' && (
        <TermsModal key={`${userId}:${sessionRevision}`} onAccept={() => {
          if (useAuthStore.getState().user?.id === userId && (useAuthStore.getState().sessionRevision ?? 0) === sessionRevision) {
            setTerms({ userId, revision: sessionRevision, status: 'accepted' });
          }
        }} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
      <header className="w-full flex justify-between items-center py-2">
        <h1 className="text-xl font-bold tracking-tight">UNIDER</h1>
        <div className="flex gap-2">
          <button aria-label="Definições" onClick={() => setShowSettings(true)} className="p-2 text-slate-400 hover:text-white transition-colors">
            <Settings className="w-5 h-5" />
          </button>
          <button aria-label="Terminar sessão" onClick={signOut} className="p-2 text-slate-400 hover:text-white transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 w-full max-w-sm flex flex-col justify-center space-y-12">

        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-4 bg-slate-800 rounded-full mb-2">
            <Clock className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-2xl font-semibold">
            {clockReady ? schedule.title : 'Horário por confirmar'}
          </h2>
          <div className="text-5xl font-mono font-bold tracking-tight text-blue-400">
            {clockReady ? formatTimeCountdown(schedule.countdown) : '--:--'}
          </div>
          <p className="text-slate-400 text-sm">
            {clockReady ? schedule.description : 'A entrada fica disponível depois de confirmar o horário do servidor.'}
          </p>
          <p className="text-xs text-slate-400">{clockReady ? 'Hora estimada a partir do servidor.' : 'O relógio do dispositivo não confirma o horário.'}</p>
          {!clockReady && <div className="space-y-2">
            <p role="status" className="text-sm text-slate-300">{clockFailed || clockStatus === 'stale' ? 'Não foi possível confirmar o horário. A tua conversa e a intenção de espera foram mantidas.' : 'A confirmar o horário...'}</p>
            <button onClick={() => window.dispatchEvent(new Event('focus'))} className="text-sm underline">Confirmar horário</button>
          </div>}
        </div>

        {currentMode === 'DAYTIME' && (
          <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50 space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              Sugere um quebra-gelo para hoje
            </h3>
            <form onSubmit={handleSuggest} className="space-y-3">
              <textarea
                aria-label="Sugestão de quebra-gelo"
                value={suggestion}
                disabled={submitting}
                onChange={(e) => { setSuggestion(e.target.value); setSubmitted(false); setSuggestionError(''); }}
                placeholder="Ex: Qual foi a cadeira mais difícil que já tiveste?"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none h-24"
                maxLength={180}
              />
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">
                  {suggestion.length}/180
                </span>
                <button
                  type="submit"
                  disabled={!userId || submitting || suggestion.length < 5}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-all"
                >
                  {submitting ? 'A enviar...' : submitted ? 'Enviado!' : 'Enviar'}
                  {!submitted && <Send className="w-4 h-4" />}
                </button>
              </div>
              {suggestionError && <p role="alert" className="text-sm text-red-300">{suggestionError}</p>}
              {submitted && <p role="status" className="text-sm text-blue-300">Sugestão enviada.</p>}
            </form>
          </div>
        )}

        {termsStatus === 'error' && (
          <div className="text-sm space-y-2">
            <p role="alert" className="text-red-300">Não foi possível confirmar os termos. Tenta novamente.</p>
            <button onClick={() => { setTerms({ userId, revision: sessionRevision, status: 'checking' }); setTermsRetry(value => value + 1); }} className="bg-slate-700 rounded-xl p-3">Verificar termos</button>
          </div>
        )}

        {ownRoom ? (
          <button onClick={() => navigate('/chat')} className="w-full bg-blue-600 rounded-xl p-4 font-semibold">Voltar à conversa</button>
        ) : (inQueue || !clockReady || currentMode === 'QUEUE' || currentMode === 'ACTIVE') && (
          <div className="space-y-4">
            {!inQueue ? (
              <button
                onClick={handleJoinQueue}
                disabled={!clockReady || !canJoinLobbyQueue(chat, userId, accepted, currentTime)}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-4 py-4 font-semibold text-lg transition-all animate-pulse shadow-[0_0_20px_rgba(37,99,235,0.3)]"
              >
                <Users className="w-5 h-5" />
                {currentMode === 'QUEUE' ? 'Preparar entrada às 22h30' : 'Entrar na Fila do Campus'}
              </button>
            ) : (
              <div className="p-4 bg-blue-900/20 border border-blue-900/50 rounded-xl text-center space-y-2">
                <div className="text-blue-400 font-medium">Entrada preparada.</div>
                <div className="text-sm text-slate-400">
                   {currentMode === 'QUEUE' ? 'Às 22h30 vamos pedir o emparelhamento, após confirmar os termos.' : 'A abrir o chat para pedir o emparelhamento...'}
                </div>
                <button onClick={() => void cancelQueue()} disabled={queueCancelBusy} className="bg-slate-700 rounded-lg px-4 py-2 text-sm">{queueCancelBusy ? 'A cancelar...' : 'Cancelar espera'}</button>
                {queueCancelError && <p role="alert" className="text-red-300">{queueCancelError}</p>}
              </div>
            )}
          </div>
        )}

      </div>

      <footer className="w-full max-w-sm mt-auto pt-8 pb-4 text-center">
        <p className="text-[10px] text-slate-400 leading-tight">
          O UNIDER é um projeto independente desenvolvido por estudantes e não possui qualquer afiliação, vínculo institucional, endosso ou suporte oficial por parte da Universidade de Coimbra.
        </p>
      </footer>
    </div>
  );
}
