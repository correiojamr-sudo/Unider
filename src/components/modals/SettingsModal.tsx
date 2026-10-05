import { useState } from 'react';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { signOut } = useAuthStore();
  const [step, setStep] = useState<'INITIAL' | 'CONFIRM'>('INITIAL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDeleteAccount = async () => {
    setLoading(true);
    setError('');

    const { error: rpcError } = await supabase.rpc('delete_own_user_account');

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
    } else {
      await signOut();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 space-y-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold tracking-tight">Definições</h2>

        {error && (
          <div className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        {step === 'INITIAL' ? (
          <div className="space-y-4">
            <button
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
              <p className="text-sm text-red-200/70">
                Esta ação irá apagar permanentemente a tua conta e o perfil. As referências ao perfil nas denúncias são removidas, mas o texto e registos antigos podem conter informações pessoais durante 30 dias, até à limpeza periódica. Identificadores de participação mantêm-se até à limpeza, um dia após o fim da sessão, para permitir denúncias. O buffer e os metadados de envio expiram em 5 e 10 minutos sem novas mensagens, respetivamente. Queres continuar?
              </p>
            </div>
            <div className="flex gap-3">
              <button
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
      </div>
    </div>
  );
}
