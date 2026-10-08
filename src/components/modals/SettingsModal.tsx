import { useId, useLayoutEffect, useRef, useState } from 'react';
import ModalFrame from './ModalFrame';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useAuthOperation } from '../../hooks/useAuthOperation';
import { AUTH_TIMEOUT_MS } from '../../lib/authOperations';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const contextVersion = useAuthStore(state => state.contextVersion);
  return <SettingsContent key={contextVersion} onClose={onClose} />;
}

function SettingsContent({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const confirmExitButton = useRef<HTMLButtonElement>(null);
  const { user, signOutForContext, contextVersion, isSigningOut } = useAuthStore();
  const [step, setStep] = useState<'INITIAL' | 'CONFIRM' | 'DELETED'>('INITIAL');
  const { loading, error, run } = useAuthOperation();
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    if (step !== previousStep.current) {
      if (step === 'CONFIRM') cancelButton.current?.focus();
      else if (step === 'INITIAL') deleteButton.current?.focus();
      else if (step === 'DELETED') confirmExitButton.current?.focus();
      previousStep.current = step;
    }
  }, [step]);

  const finishDeletion = async () => {
    if (await signOutForContext({ expectedContextVersion: contextVersion, accountDeleted: true }) &&
      useAuthStore.getState().contextVersion === contextVersion + 1 && !useAuthStore.getState().user) onClose();
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    await run('delete', async (_current, signal) => {
      const result = await supabase.rpc('delete_own_user_account')
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)]));
      if (result.error) throw result.error;
      return result;
    }, () => { setStep('DELETED'); void finishDeletion(); });
  };

  return (
    <ModalFrame titleId={titleId} descriptionId={descriptionId} onDismiss={onClose} className="max-w-sm" header={
      <div className="relative">
        <button
          aria-label="Fechar definições"
          data-modal-initial-focus
          onClick={onClose}
          className="absolute top-0 right-0 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 id={titleId} className="text-xl font-bold tracking-tight pr-6">Definições</h2>
        <p id={descriptionId} className="text-sm text-slate-300 mt-2">Gere a eliminação da tua conta.</p>
      </div>
    }>

        {error && (
          <div role="alert" className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        {step === 'DELETED' ? (
          <div className="space-y-4">
            <p role="status">A conta foi eliminada. Falta confirmar a saída da sessão.</p>
            <button ref={confirmExitButton} onClick={() => void finishDeletion()} disabled={loading || isSigningOut} className="underline">Confirmar saída</button>
          </div>
        ) : step === 'INITIAL' ? (
          <div className="space-y-4">
            <button
              ref={deleteButton}
              onClick={() => setStep('CONFIRM')}
              className="w-full flex items-center justify-between p-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-red-400 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Trash2 className="w-5 h-5" />
                <span className="font-medium">Apagar a minha conta</span>
              </div>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-red-950/50 border border-red-900 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-red-400 font-medium">
                <AlertTriangle className="w-5 h-5" />
                Ação Irreversível
              </div>
              <p className="text-sm text-red-200">
                Esta ação irá apagar permanentemente a tua conta e o perfil. As referências ao perfil nas denúncias são removidas, mas o texto e registos antigos podem conter informações pessoais até à limpeza periódica dos registos com mais de 30 dias. Identificadores de participação mantêm-se até à limpeza, um dia após o fim da sessão, para permitir denúncias. O buffer e os metadados de envio expiram em 5 e 10 minutos sem novas mensagens, respetivamente. Queres continuar?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                ref={cancelButton}
                onClick={() => setStep('INITIAL')}
                disabled={loading}
                className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl py-3 font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={loading}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl py-3 font-medium transition-colors"
              >
                {loading ? 'A apagar...' : 'Sim, apagar'}
              </button>
            </div>
          </div>
        )}
    </ModalFrame>
  );
}
