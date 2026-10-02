import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { ShieldCheck } from 'lucide-react';

export default function TermsModal() {
  const { user, fetchProfile } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    if (!user) return;
    setLoading(true);
    await supabase.from('profiles').update({
      terms_accepted_at: new Date().toISOString(),
      terms_version: '1.0'
    }).eq('id', user.id);
    await fetchProfile();
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-sm w-full space-y-6 shadow-2xl">
        <div className="flex items-center gap-3 text-blue-400">
          <ShieldCheck className="w-8 h-8" />
          <h2 className="text-xl font-bold text-white">Privacidade e Regras</h2>
        </div>

        <div className="text-sm text-slate-300 space-y-4 max-h-64 overflow-y-auto pr-2">
          <p>
            Bem-vindo(a) ao UNIDER. Para garantir um ambiente seguro e de confiança, pedimos que leias as nossas regras:
          </p>
          <ul className="list-disc pl-4 space-y-2 text-slate-400">
            <li><strong>Tolerância Zero:</strong> Assédio, bullying, discurso de ódio ou partilha de conteúdos ilícitos resultarão em expulsão imediata.</li>
            <li><strong>Efemeridade:</strong> As mensagens desaparecem no final da sessão. No entanto, se fores alvo de denúncia, a transcrição será guardada de forma segura para investigação.</li>
            <li><strong>Independência:</strong> O UNIDER é um projeto independente gerido por estudantes. Não tem qualquer afiliação oficial à Universidade de Coimbra.</li>
          </ul>
        </div>

        <button
          onClick={handleAccept}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl py-3 font-semibold transition-colors"
        >
          {loading ? 'A aceitar...' : 'Aceito os Termos'}
        </button>
      </div>
    </div>
  );
}
