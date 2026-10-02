import { useState } from 'react';
import { ShieldAlert, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

export default function TermsModal({ onAccept }: { onAccept: () => void }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAccept = async () => {
    if (!user) return;
    setLoading(true);
    setError('');

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        terms_accepted_at: new Date().toISOString(),
        terms_version: '1.0'
      })
      .eq('id', user.id);

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      onAccept();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-6 shadow-2xl relative overflow-hidden">
        {/* Header */}
        <div className="space-y-2">
          <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center mb-4">
            <ShieldAlert className="w-6 h-6 text-blue-500" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Termos de Utilização</h2>
          <p className="text-slate-400 text-sm">
            Para continuares a utilizar o UNIDER, tens de aceitar os nossos termos atualizados.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4 text-sm text-slate-300 bg-slate-800/50 p-4 rounded-xl max-h-60 overflow-y-auto">
          <p>
            <strong>1. Confidencialidade e Efemeridade:</strong> As conversas são desenhadas para ser efémeras e eliminadas da memória. No entanto, o sistema permite denunciar mensagens.
          </p>
          <p>
            <strong>2. Política de Denúncia e Auditoria:</strong> Em caso de denúncia fundamentada de assédio, ameaças ou conduta ilícita, o registo integral da conversa é preservado na base de dados para auditoria interna e eventual encaminhamento às autoridades (PJ / MP) mediante ordem legal.
          </p>
          <p>
            <strong>3. Direito ao Esquecimento (GDPR):</strong> Podes, a qualquer momento, apagar a tua conta e todos os teus dados associados nas Definições.
          </p>
          <p>
            <strong>4. Independência:</strong> O UNIDER é um projeto independente, não possuindo qualquer afiliação ou endosso por parte da Universidade de Coimbra.
          </p>
        </div>

        <button
          onClick={handleAccept}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl px-4 py-3 font-semibold transition-all"
        >
          {loading ? 'A aceitar...' : 'Aceitar e Continuar'}
          {!loading && <Check className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
