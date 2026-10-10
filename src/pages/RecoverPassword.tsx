import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useAuthOperation } from '../hooks/useAuthOperation';
import { normalizeInstitutionalEmail, OTP_COOLDOWN_MS } from '../lib/authOperations';
import { validNewPassword } from '../lib/registration';
import { withScopedAuth } from '../lib/authSession';

export default function RecoverPassword() {
  const userId = useAuthStore(state => state.session?.user.id);
  // Remount credentials/notices on identity changes, not just async callbacks.
  return <RecoveryForm key={userId ?? 'anonymous'} />;
}

function RecoveryForm() {
  const { session, isLoading } = useAuthStore();
  const operation = useAuthOperation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [completedFor, setCompletedFor] = useState<string | null>(null);
  const clear = () => { operation.clear(); setValidation(''); setNotice(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setValidation(''); setNotice('');
    if (session) {
      if (!validNewPassword(password)) { setValidation('A password deve ter entre 12 e 128 caracteres.'); return; }
      await operation.run('password', (current, signal) => withScopedAuth(current, signal, async auth => {
        const result = await auth.updateUser({ password });
        if (result.error) throw result.error;
        if (result.data.user?.id !== session.user.id) throw new Error('Identity not confirmed');
        return result.data.user.id;
      }), id => { setPassword(''); setCompletedFor(id); setNotice('Password alterada. Podes voltar à aplicação.'); });
    } else {
      const address = normalizeInstitutionalEmail(email);
      if (!address) { setValidation('Indica o teu email @student.uc.pt completo.'); return; }
      if (Date.now() < sentAt + OTP_COOLDOWN_MS) { setValidation('Aguarda um minuto antes de repetir o pedido.'); return; }
      setSentAt(Date.now());
      await operation.run('reset', (current, signal) => withScopedAuth(current, signal, async auth => {
        const result = await auth.resetPasswordForEmail(address, { redirectTo: `${window.location.origin}/recuperar-password` });
        if (result.error) throw result.error;
        return true;
      }), () => setNotice('Se existir uma conta com esse email, receberás uma mensagem de recuperação. Abre a ligação nesse email para definir a password. Consulta também o spam.'));
    }
  };
  const completed = session && completedFor === session.user.id;
  return <main className="flex-1 p-6 space-y-5">
    <h1 className="text-2xl font-bold">Recuperar password</h1>
    <p className="text-sm text-slate-400">{session ? 'Define uma nova password para a sessão autenticada.' : 'Também podes usar esta opção se a tua conta antiga entrava por código de email.'}</p>
    {(validation || operation.error) && <p role="alert" className="text-red-200">{validation || operation.error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!completed && <form noValidate onSubmit={submit} className="space-y-4">
      <label htmlFor={session ? 'new-password' : 'recovery-email'}>{session ? 'Nova password (12–128 caracteres)' : 'Email Institucional'}</label>
      {session ? <input id="new-password" type="password" autoComplete="new-password" value={password} onChange={e => { clear(); setPassword(e.target.value); }} required className="w-full rounded-xl bg-slate-800 p-3" />
        : <input id="recovery-email" type="email" autoComplete="email" value={email} onChange={e => { clear(); setEmail(e.target.value); }} required className="w-full rounded-xl bg-slate-800 p-3" />}
      <button disabled={isLoading || operation.loading} className="w-full rounded-xl bg-blue-600 p-3 disabled:opacity-50">{operation.loading ? 'A confirmar...' : session ? 'Guardar password' : 'Enviar email de recuperação'}</button>
    </form>}
    <a href={session ? '/lobby' : '/login'} className="block underline">{session ? 'Voltar à aplicação' : 'Voltar a entrar'}</a>
  </main>;
}
