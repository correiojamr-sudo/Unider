import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';
import { Settings as SettingsIcon, Trash2, X } from 'lucide-react';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { signOut } = useAuthStore();
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    await supabase.rpc('delete_own_user_account');
    await signOut(); // This will clear state and redirect to login
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-sm w-full space-y-6 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 text-slate-200">
          <SettingsIcon className="w-6 h-6" />
          <h2 className="text-xl font-bold">Definições</h2>
        </div>

        <div className="space-y-4 pt-4 border-t border-slate-700">
            {!showConfirm ? (
                <button
                    onClick={() => setShowConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/50 rounded-xl py-3 font-semibold transition-colors"
                >
                    <Trash2 className="w-4 h-4" />
                    Apagar a minha conta
                </button>
            ) : (
                <div className="space-y-4 p-4 bg-red-950/30 rounded-xl border border-red-900/50">
                    <p className="text-sm text-red-200 font-medium text-center">
                        Tens a certeza? Esta ação é irreversível e todos os teus dados serão apagados.
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowConfirm(false)}
                            disabled={loading}
                            className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-xl py-2 text-sm font-semibold transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={loading}
                            className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl py-2 text-sm font-semibold transition-colors"
                        >
                            {loading ? 'A apagar...' : 'Sim, apagar'}
                        </button>
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
