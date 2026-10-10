import { useId, useState } from 'react';
import { ShieldAlert, Check } from 'lucide-react';
import ModalFrame from './ModalFrame';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useAuthOperation } from '../../hooks/useAuthOperation';
import { AUTH_TIMEOUT_MS } from '../../lib/authOperations';
import { TERMS_VERSION } from '../../lib/legal';
import LegalText from '../LegalText';

export default function TermsModal({ onAccept }: { onAccept: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const { user } = useAuthStore();
  const { loading, error, run } = useAuthOperation();
  const [declaredUser, setDeclaredUser] = useState<string | null>(null);
  const adultAccepted = !!user && declaredUser === user.id;

  const handleAccept = async () => {
    if (!user || !adultAccepted) return;
    await run('terms', async (_current, signal) => {
      const { data, error } = await supabase.rpc('accept_terms', { p_version: TERMS_VERSION, p_adult: true })
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)]));
      if (error || data !== true) throw error || new Error('Consent not confirmed');
      return data;
    }, onAccept);
  };

  return (
    <ModalFrame titleId={titleId} descriptionId={descriptionId} className="max-w-md">
        {/* Header */}
        <div className="space-y-2">
          <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center mb-4">
            <ShieldAlert className="w-6 h-6 text-blue-500" />
          </div>
          <h2 id={titleId} tabIndex={-1} data-modal-initial-focus className="text-2xl font-bold tracking-tight">Termos de Utilização</h2>
          <p id={descriptionId} className="text-slate-400 text-sm">
            Para continuares a utilizar o Aquecimento, lê os termos e confirma a tua maioridade.
          </p>
        </div>

        {error && (
          <div role="alert" className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        <div role="region" aria-label="Texto dos termos" tabIndex={0} className="space-y-4 text-sm text-slate-300 bg-slate-800/50 p-4 rounded-xl max-h-60 overflow-y-auto">
          <LegalText />
        </div>

        <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="block text-sm underline">Ler Política de Privacidade (novo separador)</a>
        <label className="flex gap-3 text-sm">
          <input type="checkbox" checked={adultAccepted} onChange={event => setDeclaredUser(event.target.checked ? user?.id ?? null : null)} />
          <span>Declaro que tenho 18 ou mais anos e aceito os Termos de Utilização.</span>
        </label>

        <button
          onClick={handleAccept}
          disabled={loading || !user || !adultAccepted}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl px-4 py-3 font-semibold transition-all"
        >
          {loading ? 'A aceitar...' : 'Aceitar e Continuar'}
          {!loading && <Check className="w-4 h-4" />}
        </button>
    </ModalFrame>
  );
}
