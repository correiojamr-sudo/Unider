import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { supabase } from '../lib/supabase';
import { getSecondsUntil, formatTimeCountdown } from '../utils/time';
import { LogOut, Clock, Send, Users } from 'lucide-react';

export default function Lobby() {
  const navigate = useNavigate();
  const { currentMode } = useAppStore();
  const { user, signOut } = useAuthStore();

  const [suggestion, setSuggestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [countdown, setCountdown] = useState<number>(0);
  const [inQueue, setInQueue] = useState(false);

  useEffect(() => {
    const targetTime = currentMode === 'DAYTIME' ? '22:28:00' : '22:30:00';
    setCountdown(getSecondsUntil(targetTime));

    const timer = setInterval(() => {
      setCountdown(getSecondsUntil(targetTime));
    }, 1000);

    return () => clearInterval(timer);
  }, [currentMode]);

  useEffect(() => {
    // If we transition to active and we are in queue, or if we join late during active time
    if (currentMode === 'ACTIVE' && inQueue) {
      navigate('/chat');
    }
  }, [currentMode, inQueue, navigate]);

  const handleSuggest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suggestion || suggestion.length < 5 || suggestion.length > 180) return;

    setSubmitting(true);
    const { error } = await supabase.from('icebreaker_suggestions').insert({
      user_id: user?.id,
      suggestion
    });

    setSubmitting(false);
    if (!error) {
      setSubmitted(true);
      setSuggestion('');
      setTimeout(() => setSubmitted(false), 3000);
    }
  };

  const handleJoinQueue = () => {
    setInQueue(true);
    useChatStore.getState().setQueueing(true);
  };

  return (
    <div className="flex-1 flex flex-col items-center p-6 space-y-8">
      <header className="w-full flex justify-between items-center py-2">
        <h1 className="text-xl font-bold tracking-tight">CAMPUS DROPS</h1>
        <button onClick={signOut} className="p-2 text-slate-400 hover:text-white transition-colors">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 w-full max-w-sm flex flex-col justify-center space-y-12">

        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-4 bg-slate-800 rounded-full mb-2">
            <Clock className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-2xl font-semibold">
            {currentMode === 'DAYTIME' ? 'Próximo Drop às 22h30' : 'A fila está aberta!'}
          </h2>
          <div className="text-5xl font-mono font-bold tracking-tight text-blue-400">
            {formatTimeCountdown(countdown)}
          </div>
          <p className="text-slate-400 text-sm">
            {currentMode === 'DAYTIME'
              ? 'A fila de espera abre às 22h28.'
              : 'As conversas começam em breve.'}
          </p>
        </div>

        {currentMode === 'DAYTIME' && (
          <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50 space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              Sugere um quebra-gelo para hoje
            </h3>
            <form onSubmit={handleSuggest} className="space-y-3">
              <textarea
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                placeholder="Ex: Qual foi a cadeira mais difícil que já tiveste?"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none h-24"
                maxLength={180}
              />
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">
                  {suggestion.length}/180
                </span>
                <button
                  type="submit"
                  disabled={submitting || suggestion.length < 5}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-all"
                >
                  {submitted ? 'Enviado!' : 'Enviar'}
                  {!submitted && <Send className="w-4 h-4" />}
                </button>
              </div>
            </form>
          </div>
        )}

        {(currentMode === 'QUEUE' || currentMode === 'ACTIVE') && (
          <div className="space-y-4">
            {!inQueue ? (
              <button
                onClick={handleJoinQueue}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-4 py-4 font-semibold text-lg transition-all animate-pulse shadow-[0_0_20px_rgba(37,99,235,0.3)]"
              >
                <Users className="w-5 h-5" />
                Entrar na Fila do Campus
              </button>
            ) : (
              <div className="p-4 bg-blue-900/20 border border-blue-900/50 rounded-xl text-center space-y-2">
                <div className="text-blue-400 font-medium">Estás na fila.</div>
                <div className="text-sm text-slate-400">
                   {currentMode === 'QUEUE' ? 'Aguarda, serás emparelhado automaticamente às 22h30.' : 'A emparelhar...'}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
