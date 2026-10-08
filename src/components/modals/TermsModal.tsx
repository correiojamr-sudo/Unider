import { useId } from 'react';
import { ShieldAlert, Check } from 'lucide-react';
import ModalFrame from './ModalFrame';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useAuthOperation } from '../../hooks/useAuthOperation';
import { AUTH_TIMEOUT_MS } from '../../lib/authOperations';

export default function TermsModal({ onAccept }: { onAccept: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const { user } = useAuthStore();
  const { loading, error, run } = useAuthOperation();

  const handleAccept = async () => {
    if (!user) return;
    await run('terms', async (_current, signal) => {
      const { data, error } = await supabase.rpc('accept_terms', { p_version: '1.1' })
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
            Para continuares a utilizar o UNIDER, tens de aceitar os nossos termos atualizados.
          </p>
        </div>

        {error && (
          <div role="alert" className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        <div role="region" aria-label="Texto dos termos" tabIndex={0} className="space-y-4 text-sm text-slate-300 bg-slate-800/50 p-4 rounded-xl max-h-60 overflow-y-auto">
          <p>
            <strong>1. Confidencialidade e Efemeridade:</strong> As conversas usam um buffer temporário. O histórico recuperado pode estar incompleto e as mensagens já recebidas podem permanecer neste separador durante a sessão. O sistema permite denunciar as mensagens disponíveis.
          </p>
          <p>
            <strong>2. Política de Denúncia e Auditoria:</strong> O buffer temporário expira 5 minutos após a última mensagem nova. Uma denúncia guarda o conteúdo então disponível para auditoria interna, sem garantir a conversa completa. Tentar novamente ou cancelar não recupera mensagens já expiradas. Os registos de denúncia com mais de 30 dias são removidos pela limpeza periódica.
          </p>
          <p>
            <strong>3. Eliminação da Conta:</strong> Podes apagar a conta e o perfil nas Definições. As referências ao perfil nas denúncias são removidas, mas o texto e registos antigos podem conter informações pessoais durante o prazo acima. Identificadores de participação na sala mantêm-se até à limpeza, um dia após o fim da sessão, para permitir denúncias. O buffer temporário e os metadados de envio expiram separadamente em 5 e 10 minutos sem novas mensagens, respetivamente.
          </p>
          <p>
            <strong>4. Independência:</strong> O UNIDER é um projeto independente, não possuindo qualquer afiliação ou endosso por parte da Universidade de Coimbra.
          </p>
        </div>

        <button
          onClick={handleAccept}
          disabled={loading || !user}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl px-4 py-3 font-semibold transition-all"
        >
          {loading ? 'A aceitar...' : 'Aceitar e Continuar'}
          {!loading && <Check className="w-4 h-4" />}
        </button>
    </ModalFrame>
  );
}
