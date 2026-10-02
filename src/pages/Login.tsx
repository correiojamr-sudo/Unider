import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { LogIn, ShieldAlert } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'EMAIL' | 'OTP'>('EMAIL');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.endsWith('@student.uc.pt')) {
      setError('Acesso restrito ao domínio @student.uc.pt');
      return;
    }

    if (!legalAccepted) {
      setError('Tem de aceitar os termos de confidencialidade.');
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
    } else {
      setStep('OTP');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    });

    setLoading(false);

    if (verifyError) {
      setError(verifyError.message);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tighter">UNIDER</h1>
        <p className="text-slate-400 text-sm">Conversas efémeras. Exclusivo UC.</p>
      </div>

      <div className="w-full max-w-sm space-y-6">
        {error && (
          <div className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-red-200 text-sm flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {step === 'EMAIL' ? (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="email" className="text-xs font-medium text-slate-400 uppercase tracking-wider">Email Institucional</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@student.uc.pt"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                required
              />
            </div>

            <label className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 cursor-pointer group">
              <div className="flex items-center h-5">
                <input
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(e) => setLegalAccepted(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 text-blue-600 focus:ring-blue-600 bg-slate-700"
                  required
                />
              </div>
              <div className="text-xs text-slate-400 leading-relaxed">
                As conversas são confidenciais e efémeras. Em caso de denúncia fundamentada de assédio, ameaças ou conduta ilícita, o registo integral da conversa é preservado na base de dados para auditoria interna e eventual encaminhamento às autoridades judiciais e policiais (PJ / MP) mediante ordem legal.
              </div>
            </label>

            <button
              type="submit"
              disabled={loading || !email || !legalAccepted}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-xl px-4 py-3 font-semibold transition-all"
            >
              {loading ? 'A enviar...' : 'Continuar'}
              {!loading && <LogIn className="w-4 h-4" />}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="otp" className="text-xs font-medium text-slate-400 uppercase tracking-wider">Código de 6 dígitos</label>
              <input
                id="otp"
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-center tracking-[0.5em] font-mono text-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || otp.length < 6}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-xl px-4 py-3 font-semibold transition-all"
            >
              {loading ? 'A verificar...' : 'Entrar'}
            </button>
            <button
              type="button"
              onClick={() => setStep('EMAIL')}
              className="w-full text-sm text-slate-400 hover:text-white transition-colors"
            >
              Voltar
            </button>
          </form>
        )}
      </div>

      <footer className="w-full max-w-sm mt-auto pt-8 pb-4 text-center">
        <p className="text-[10px] text-slate-500 leading-tight">
          O UNIDER é um projeto independente desenvolvido por estudantes e não possui qualquer afiliação, vínculo institucional, endosso ou suporte oficial por parte da Universidade de Coimbra.
        </p>
      </footer>
    </div>
  );
}
