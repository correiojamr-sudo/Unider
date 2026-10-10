import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useAuthOperation } from '../hooks/useAuthOperation';
import { normalizeInstitutionalEmail, validEmailOtp, OTP_COOLDOWN_MS } from '../lib/authOperations';
import { withScopedAuth } from '../lib/authSession';
import { LogIn, ShieldAlert } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'EMAIL' | 'OTP'>('EMAIL');
  const operation = useAuthOperation();
  const { loading } = operation;
  const [validationError, setValidationError] = useState('');
  const error = validationError || operation.error;
  const [destination, setDestination] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const cooldown = Math.max(0, Math.min(60, Math.ceil((resendAt - now) / 1000)));
  const [legalAccepted, setLegalAccepted] = useState(false);
  useEffect(() => {
    if (!resendAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  const sendOtp = async (resend = false) => {
    setValidationError('');
    const address = normalizeInstitutionalEmail(resend ? destination : email);
    if (!address) {
      setValidationError('Indica um endereço completo do domínio @student.uc.pt.');
      return;
    }
    if (!legalAccepted) {
      setValidationError('Confirma que tens 18 ou mais anos e aceita os Termos de Utilização.');
      return;
    }
    if (loading || Date.now() < resendAt) return;
    setNow(Date.now());
    setResendAt(Date.now() + OTP_COOLDOWN_MS);
    await operation.run('send', (current, signal) => withScopedAuth(current, signal, async auth => {
      const result = await auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
      if (result.error) throw result.error;
      return result;
    }), () => {
      setDestination(address);
      setEmail(address);
      setOtp('');
      setStep('OTP');
    });
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');
    if (!validEmailOtp(otp)) {
      setValidationError('Introduz o código completo do email, entre 6 e 10 dígitos.');
      return;
    }
    await operation.run('verify', (current, signal) => withScopedAuth(current, signal, async auth => {
      const result = await auth.verifyOtp({ email: destination, token: otp, type: 'email' });
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error('Session not confirmed');
      return result.data.session;
    }), session => useAuthStore.getState().setSession(session));
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tighter">Aquecimento</h1>
        <p className="text-slate-400 text-sm">Conversas temporárias. Para maiores de 18 anos com email @student.uc.pt.</p>
      </div>

      <div className="w-full max-w-sm space-y-6">
        {error && (
          <div role="alert" className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-red-200 text-sm flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {step === 'EMAIL' ? (
          <form noValidate onSubmit={e => { e.preventDefault(); void sendOtp(); }} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="email" className="text-xs font-medium text-slate-400 uppercase tracking-wider">Email Institucional</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { operation.clear(); setValidationError(''); setEmail(e.target.value); }}
                placeholder="nome@student.uc.pt"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                required
              />
            </div>

            <label className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 cursor-pointer group">
              <div className="flex items-center h-5">
                <input
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(e) => { operation.clear(); setValidationError(''); setLegalAccepted(e.target.checked); }}
                  className="w-4 h-4 rounded border-slate-600 text-blue-600 focus:ring-blue-600 bg-slate-700"
                  required
                />
              </div>
              <div className="text-xs text-slate-400 leading-relaxed">
                Declaro que tenho 18 ou mais anos e aceito os Termos de Utilização. Li a informação de privacidade. As conversas usam um buffer temporário; uma denúncia pode guardar o conteúdo disponível.
              </div>
            </label>
            <div className="flex gap-4 text-xs">
              <a href="/termos" target="_blank" rel="noopener noreferrer" className="underline">Ler termos (novo separador)</a>
              <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="underline">Ler privacidade (novo separador)</a>
            </div>

            <button
              type="submit"
              disabled={loading || cooldown > 0 || !email || !legalAccepted}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-xl px-4 py-3 font-semibold transition-all"
            >
              {loading ? 'A enviar...' : cooldown > 0 ? `Tentar novamente em ${cooldown}s` : 'Continuar'}
              {!loading && <LogIn className="w-4 h-4" />}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <p role="status" className="text-sm text-slate-300">Pedido de email confirmado para <strong>{destination}</strong>. Consulta a caixa de entrada e o spam.</p>
            <div className="space-y-1">
              <label htmlFor="otp" className="text-xs font-medium text-slate-400 uppercase tracking-wider">Código do email (6–10 dígitos)</label>
              <input
                id="otp"
                type="text"
                value={otp}
                onChange={(e) => { operation.clear(); setValidationError(''); setOtp(e.target.value.replace(/\D/g, '').slice(0, 10)); }}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-400 text-center tracking-[0.15em] sm:tracking-[0.5em] font-mono text-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !validEmailOtp(otp)}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-xl px-4 py-3 font-semibold transition-all"
            >
              {loading ? 'A verificar...' : 'Entrar'}
            </button>
            <button
              type="button"
              onClick={() => void sendOtp(true)}
              disabled={loading || cooldown > 0}
              className="w-full text-sm text-slate-400 disabled:opacity-50 hover:text-white transition-colors"
            >
              {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar código'}
            </button>
            <button
              type="button"
              onClick={() => { operation.clear(); setValidationError(''); setOtp(''); setDestination(''); setStep('EMAIL'); }}
              className="w-full text-sm text-slate-400 hover:text-white transition-colors"
            >
              Voltar e corrigir email
            </button>
          </form>
        )}
      </div>

      <footer className="w-full max-w-sm mt-auto pt-8 pb-4 text-center">
        <p className="text-[10px] text-slate-400 leading-tight">
          O Aquecimento é independente e não tem afiliação, vínculo institucional, aprovação, endosso ou suporte oficial da Universidade de Coimbra.
        </p>
      </footer>
    </div>
  );
}
