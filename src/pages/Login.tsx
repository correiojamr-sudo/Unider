import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useAuthOperation } from '../hooks/useAuthOperation';
import { normalizeInstitutionalEmail, OTP_COOLDOWN_MS } from '../lib/authOperations';
import { withScopedAuth } from '../lib/authSession';
import { validAdultBirthDate, validNewPassword, validRegistrationName, GENDERS, type Gender } from '../lib/registration';
import { TERMS_VERSION } from '../lib/legal';

const fieldClass = 'w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function Login() {
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<Gender>('undisclosed');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const operation = useAuthOperation();
  const clear = () => { operation.clear(); setValidationError(''); setNotice(''); };
  const resendConfirmation = async () => {
    setValidationError(''); setNotice('');
    const address = normalizeInstitutionalEmail(email);
    if (!address) { setValidationError('Indica o teu email institucional completo.'); return; }
    if (Date.now() < resendAt + OTP_COOLDOWN_MS) { setValidationError('Aguarda um minuto antes de repetir o pedido.'); return; }
    setResendAt(Date.now());
    await operation.run('send', (current, signal) => withScopedAuth(current, signal, async auth => {
      const result = await auth.resend({ type: 'signup', email: address, options: { emailRedirectTo: `${window.location.origin}/login` } });
      if (result.error) throw result.error;
      return true;
    }), () => setNotice('Pedido de confirmação recebido. Se for aplicável à conta, receberás um email. Consulta também o spam.'));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setValidationError(''); setNotice('');
    const address = normalizeInstitutionalEmail(email);
    if (!address) { setValidationError('Indica um endereço completo do domínio @student.uc.pt.'); return; }
    if (!password) { setValidationError('Introduz a tua password.'); return; }
    if (mode === 'REGISTER') {
      if (!validNewPassword(password)) { setValidationError('A password deve ter entre 12 e 128 caracteres.'); return; }
      if (!validRegistrationName(name)) { setValidationError('Indica um nome entre 1 e 80 caracteres.'); return; }
      if (!validAdultBirthDate(birthDate)) { setValidationError('Indica uma data de nascimento válida. O acesso é apenas para maiores de 18 anos.'); return; }
      if (!GENDERS.includes(gender) || !legalAccepted) { setValidationError('Lê os termos e a informação de privacidade e confirma a aceitação e a maioridade.'); return; }
    }
    await operation.run(mode === 'LOGIN' ? 'login' : 'register', (current, signal) => withScopedAuth(current, signal, async auth => {
      const result = mode === 'LOGIN'
        ? await auth.signInWithPassword({ email: address, password })
        : await auth.signUp({ email: address, password, options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: { registration_name: name.trim(), birth_date: birthDate, gender, terms_version: TERMS_VERSION, adult: true },
        } });
      if (result.error) throw result.error;
      if (mode === 'LOGIN' && !result.data.session) throw new Error('Session not confirmed');
      return result.data;
    }), data => {
      setPassword('');
      if (data.session) useAuthStore.getState().setSession(data.session);
      else {
        // Auth can return an obfuscated existing user: don't claim creation or disclose existence.
        setNotice('Pedido recebido. Se o registo for possível, receberás um email para confirmar a conta. Depois entra com o email e a password. Consulta também o spam.');
        setMode('LOGIN'); setName(''); setBirthDate(''); setGender('undisclosed'); setLegalAccepted(false);
      }
    });
  };
  const error = validationError || operation.error;
  return <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
    <div className="text-center space-y-2">
      <h1 className="text-4xl font-bold text-white tracking-tighter">Aquecimento</h1>
      <p className="text-slate-400 text-sm">Conversas temporárias. Para maiores de 18 anos com email @student.uc.pt.</p>
    </div>
    <div className="w-full max-w-sm space-y-4">
      <div role="group" aria-label="Entrar ou criar conta" className="flex gap-2">
        {(['LOGIN', 'REGISTER'] as const).map(option => <button key={option} type="button" aria-pressed={mode === option}
          onClick={() => { if (option !== mode) { clear(); setPassword(''); setLegalAccepted(false); setName(''); setBirthDate(''); setGender('undisclosed'); setMode(option); } }}
          className={`flex-1 rounded-xl px-4 py-3 font-semibold ${mode === option ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}
        >{option === 'LOGIN' ? 'Entrar' : 'Criar conta'}</button>)}
      </div>
      {error && <p role="alert" className="p-3 bg-red-950/50 rounded-lg text-red-200 text-sm">{error}</p>}
      {notice && <p role="status" className="text-sm text-slate-300">{notice}</p>}
      <form noValidate onSubmit={submit} className="space-y-4">
        <div><label htmlFor="email">Email Institucional</label><input id="email" type="email" autoComplete="username" value={email}
          onChange={e => { clear(); setEmail(e.target.value); }} placeholder="nome@student.uc.pt" className={fieldClass} required /></div>
        <div><label htmlFor="password">Password</label><input id="password" type="password" autoComplete={mode === 'LOGIN' ? 'current-password' : 'new-password'} value={password}
          onChange={e => { clear(); setPassword(e.target.value); }} className={fieldClass} required aria-describedby={mode === 'REGISTER' ? 'password-help' : undefined} />
          {mode === 'REGISTER' && <p id="password-help" className="text-xs text-slate-400">Entre 12 e 128 caracteres. Usa uma password única.</p>}</div>
        {mode === 'REGISTER' && <>
          <div><label htmlFor="name">Nome</label><input id="name" autoComplete="nickname" maxLength={80} value={name}
            onChange={e => { clear(); setName(e.target.value); }} className={fieldClass} required />
            <p className="text-xs text-slate-400">Pode ser o nome pelo qual queres ser tratado. Não aparece ao outro participante.</p></div>
          <div><label htmlFor="birth-date">Data de nascimento</label><input id="birth-date" type="date" autoComplete="bday" min="1900-01-01" value={birthDate}
            onChange={e => { clear(); setBirthDate(e.target.value); }} className={fieldClass} required /></div>
          <div><label htmlFor="gender">Género</label><select id="gender" value={gender} onChange={e => { clear(); setGender(e.target.value as Gender); }} className={fieldClass}>
            <option value="undisclosed">Prefiro não divulgar</option><option value="male">Masculino</option><option value="female">Feminino</option>
          </select></div>
          <p className="text-xs text-slate-400">Nome, nascimento e género ficam privados. A data declarada não é prova documental de idade.</p>
          <label className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
            <input type="checkbox" checked={legalAccepted} onChange={e => { clear(); setLegalAccepted(e.target.checked); }} required className="mt-1 shrink-0" />
            <span className="text-xs text-slate-400">Declaro que tenho 18 ou mais anos e aceito os Termos de Utilização. Li a informação de privacidade. As conversas usam um buffer temporário; uma denúncia pode guardar o conteúdo disponível.</span>
          </label>
        </>}
        <div className="flex gap-4 text-xs"><a href="/termos" target="_blank" rel="noopener noreferrer" className="underline">Ler termos (novo separador)</a>
          <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="underline">Ler privacidade (novo separador)</a></div>
        <button type="submit" disabled={operation.loading || !email || !password || (mode === 'REGISTER' && !legalAccepted)}
          className="w-full bg-blue-600 rounded-xl px-4 py-3 font-semibold disabled:opacity-50">
          {operation.loading ? 'A confirmar...' : mode === 'LOGIN' ? 'Iniciar sessão' : 'Registar conta'}
        </button>
      </form>
      {mode === 'LOGIN' && <>
        <a href="/recuperar-password" className="block text-sm underline">Esqueci-me da password</a>
        <button type="button" disabled={operation.loading} onClick={() => void resendConfirmation()} className="text-sm underline disabled:opacity-50">Reenviar confirmação do email</button>
      </>}
    </div>
    <footer className="w-full max-w-sm pt-4 text-center text-[10px] text-slate-400">O Aquecimento é independente e não tem afiliação, vínculo institucional, aprovação, endosso ou suporte oficial da Universidade de Coimbra.</footer>
  </main>;
}
