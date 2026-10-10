const assert = require('node:assert/strict');
const { test } = require('node:test');

test('isolated auth browser: password login/signup/recovery, late replies, Terms/Settings and startup races', {
  skip: !process.env.UNIDER_TEST_PLAYWRIGHT ? 'Set UNIDER_TEST_PLAYWRIGHT to an installed module.' : false,
  timeout: 60000,
}, async t => {
  const { chromium } = require(process.env.UNIDER_TEST_PLAYWRIGHT);
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const fs = require('node:fs');
  const root = process.cwd().replaceAll('\\', '/');
  const fixture = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import App from '/src/App.tsx';
    import Login from '/src/pages/Login.tsx';
    import RecoverPassword from '/src/pages/RecoverPassword.tsx';
    import TermsModal from '/src/components/modals/TermsModal.tsx';
    import SettingsModal from '/src/components/modals/SettingsModal.tsx';
    import { useAuthStore } from '/src/store/authStore.ts';
    import { useChatStore } from '/src/store/chatStore.ts';
    import '/src/index.css';
    window.fixture = { modes: {}, calls: [], pending: [], accepted: 0, closed: 0, events: [] };
    window.stores = { auth: useAuthStore, chat: useChatStore };
    window.fixture.login = id => useAuthStore.getState().setSession(id ? { user: { id } } : null);
    function Root() {
      const [view, setView] = useState('login');
      window.fixture.render = setView;
      return view === 'login' ? <Login /> : view === 'recovery' ? <RecoverPassword /> : view === 'terms' ? <TermsModal onAccept={() => window.fixture.accepted++} />
        : view === 'settings' ? <SettingsModal onClose={() => window.fixture.closed++} /> : view === 'app' ? <App /> : <p>Desmontado</p>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><Root /></React.StrictMode>);
  `;
  const mockSupabase = `
    const f = () => window.fixture;
    function request(name, args, success) {
      const state = f(); state.calls.push({ name, args });
      const mode = state.modes[name];
      let promise;
      if (mode === 'pending') promise = new Promise((resolve, reject) => state.pending.push({ name,
        finish: (failure = false) => failure ? reject(new Error('SECRET internal exception')) : resolve(success()) }));
      else if (mode === 'throw') promise = Promise.reject(new TypeError('SECRET offline'));
      else if (mode === 'error') promise = Promise.resolve({ data: null, error: { code: name === 'verify' ? 'otp_expired' : 'fixture_error', message: 'SECRET internal response' } });
      else promise = Promise.resolve(success());
      promise.abortSignal = () => promise; return promise;
    }
    export const supabase = {
      functions: { invoke: () => Promise.resolve({ data: { server_now: new Date().toISOString() }, error: null }) },
      auth: {
        signInWithPassword: args => request('login', args, () => ({ data: { session: { user: { id: 'verified' } } }, error: null })),
        signUp: args => request('register', args, () => ({ data: { user: { id: 'new-unconfirmed' }, session: null }, error: null })),
        resetPasswordForEmail: (email, options) => request('reset', { email, options }, () => ({ data: {}, error: null })),
        resend: args => request('resend', args, () => ({ data: {}, error: null })),
        updateUser: args => request('password', args, () => ({ data: { user: window.stores.auth.getState().user }, error: null })),
        signInWithOtp: args => request('send', args, () => ({ data: { session: null }, error: null })),
        verifyOtp: args => request('verify', args, () => ({ data: { session: { user: { id: 'verified' } } }, error: null })),
        signOut: () => request('logout', {}, () => ({ error: null })),
        getSession: () => request('startup', {}, () => ({ data: { session: null }, error: null })),
        onAuthStateChange: cb => { f().events.push(cb); return { data: { subscription: { unsubscribe() { f().events = f().events.filter(item => item !== cb); } } } }; },
      },
      rpc: (name, args) => request(name, args, () => ({ data: name === 'accept_terms' ? true : null, error: null })),
    };
  `;
  const sessionSource = fs.readFileSync('src/lib/authSession.ts', 'utf8');
  const sessionFixture = sessionSource.slice(0, sessionSource.indexOf('// Scoped SDK')) + `
    import { supabase } from './supabase';
    export async function withScopedAuth(current, signal, request) {
      if (!current() || signal.aborted) throw new Error('obsolete');
      return request(supabase.auth);
    }
  `;
  const server = await createServer({ root, configFile: false, cacheDir: 'node_modules/.vite-auth-fixture', logLevel: 'error',
    plugins: [react({ exclude: /auth-fixture/ }), { name: 'isolated-auth-fixture', enforce: 'pre',
      resolveId(id) { if (id === '/auth-fixture.tsx') return root + '/tests/auth-fixture.tsx'; },
      load(id) {
        if (id === root + '/tests/auth-fixture.tsx') return fixture;
        if (id === root + '/src/lib/supabase.ts') return mockSupabase;
        if (id === root + '/src/lib/authSession.ts') return sessionFixture;
        if (id === root + '/src/pages/Lobby.tsx') return `export default function Lobby() { return <p>Lobby autorizado</p> }`;
        if (id === root + '/src/pages/Chat.tsx') return `export default function Chat() { return <p>Chat fixture</p> }`;
      },
      configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
        if (!['/', '/login', '/lobby'].includes(req.url.split('?')[0])) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml('/', '<html><body><div id="root"></div><script type="module" src="/auth-fixture.tsx"></script></body></html>'));
      }); },
    }], server: { host: '127.0.0.1', port: 0, watch: null },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.UNIDER_TEST_BROWSER ? { executablePath: process.env.UNIDER_TEST_BROWSER } : {}) });
    const context = await browser.newContext();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const external = [];
    await context.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const reset = async () => { await page.goto(origin); await page.locator('#email').waitFor(); };
    const mode = (name, value) => page.evaluate(([name, value]) => { window.fixture.modes[name] = value; }, [name, value]);
    const fillEmail = async email => { await page.locator('#email').fill(email); };
    const finish = (name, failure = false) => page.evaluate(([name, failure]) => {
      const index = window.fixture.pending.findIndex(item => item.name === name);
      if (index >= 0) window.fixture.pending.splice(index, 1)[0].finish(failure);
    }, [name, failure]);
    const fillLogin = async (email = '  Nome@STUDENT.UC.PT  ') => {
      await fillEmail(email); await page.locator('#password').fill('fixture-password-123');
    };
    const register = async () => {
      await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
      await fillLogin('nova@student.uc.pt');
      await page.locator('#name').fill(' Nome privado ');
      await page.locator('#birth-date').fill('2000-01-01');
    };
    await reset();
    assert.equal(await page.getByRole('button', { name: 'Entrar', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('checkbox').count(), 0);
    await fillLogin(); await mode('login', 'error');
    await page.getByRole('button', { name: 'Iniciar sessão' }).click();
    await page.getByRole('alert').waitFor();
    assert.ok(!(await page.locator('body').innerText()).includes('SECRET'));
    assert.equal(await page.locator('#password').getAttribute('type'), 'password');
    await mode('login', 'success'); await page.getByRole('button', { name: 'Iniciar sessão' }).click();
    await page.waitForFunction(() => window.stores.auth.getState().user?.id === 'verified');
    assert.equal(await page.evaluate(() => window.fixture.calls[0].args.email), 'nome@student.uc.pt');
    assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.name === 'register')), false);
    assert.equal(await page.locator('#password').inputValue(), '');

    await reset(); await fillEmail('nova@student.uc.pt');
    await page.getByRole('button', { name: 'Reenviar confirmação do email' }).click();
    await page.getByRole('status').filter({ hasText: 'Pedido de confirmação recebido' }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls[0].args.type), 'signup');
    await page.getByRole('button', { name: 'Reenviar confirmação do email' }).click();
    await page.getByRole('alert').filter({ hasText: 'um minuto' }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls.length), 1);

    await reset(); await register();
    assert.equal(await page.locator('#gender').inputValue(), 'undisclosed');
    assert.equal(await page.getByRole('button', { name: 'Registar conta' }).isDisabled(), true);
    await page.getByRole('checkbox').check(); await page.locator('#birth-date').fill('2020-01-01');
    await page.getByRole('button', { name: 'Registar conta' }).click(); await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
    await page.locator('#birth-date').fill('2000-01-01'); await page.locator('#password').fill('short');
    await page.getByRole('button', { name: 'Registar conta' }).click(); await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
    await page.locator('#password').fill('fixture-password-123');
    await page.getByRole('button', { name: 'Registar conta' }).click();
    await page.getByRole('status').filter({ hasText: 'Pedido recebido' }).waitFor();
    const signup = await page.evaluate(() => window.fixture.calls[0].args);
    assert.equal(signup.email, 'nova@student.uc.pt');
    assert.deepEqual(signup.options.data, { registration_name: 'Nome privado', birth_date: '2000-01-01', gender: 'undisclosed', terms_version: '2.0', adult: true });
    assert.equal(signup.options.emailRedirectTo, origin + '/login');
    assert.equal(await page.evaluate(() => window.stores.auth.getState().session), null);
    assert.equal(await page.locator('#password').inputValue(), '');

    // Late login success/failure cannot authenticate after correction or a mode switch.
    for (const failure of [false, true]) {
      await reset(); await fillLogin('alice@student.uc.pt'); await mode('login', 'pending');
      await page.getByRole('button', { name: 'Iniciar sessão' }).click();
      await page.getByRole('button', { name: 'Criar conta', exact: true }).click(); await finish('login', failure);
      assert.equal(await page.evaluate(() => window.stores.auth.getState().session), null);
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.equal(await page.getByRole('checkbox').isChecked(), false);
    }
    await reset(); await register(); await page.getByRole('checkbox').check(); await mode('register', 'pending');
    await page.getByRole('button', { name: 'Registar conta' }).click();
    await page.locator('#name').fill('Outro nome'); await finish('register');
    assert.equal(await page.getByRole('status').count(), 0);
    assert.equal(await page.locator('#name').inputValue(), 'Outro nome');

    // Recovery is public before authentication; updates require the authenticated session.
    await reset(); await page.evaluate(() => { window.stores.auth.getState().finishStartup(); window.fixture.render('recovery'); });
    await page.locator('#recovery-email').fill('nome@student.uc.pt');
    await page.getByRole('button', { name: 'Enviar email de recuperação' }).click();
    await page.getByRole('status').filter({ hasText: 'Se existir uma conta' }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls[0].args.options.redirectTo), origin + '/recuperar-password');
    await page.getByRole('button', { name: 'Enviar email de recuperação' }).click();
    await page.getByRole('alert').filter({ hasText: 'um minuto' }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls.length), 1);
    await page.evaluate(() => window.fixture.login('recovered')); await page.locator('#new-password').fill('new-fixture-password');
    await mode('password', 'pending'); await page.getByRole('button', { name: 'Guardar password' }).click();
    await page.evaluate(() => window.fixture.login('another-user')); await finish('password');
    assert.equal(await page.getByText('Password alterada.', { exact: false }).count(), 0);
    // A new identity cannot inherit the previous account's typed password.
    assert.equal(await page.locator('#new-password').inputValue(), '');
    await page.locator('#new-password').fill('another-fixture-password'); await mode('password', 'success');
    await page.getByRole('button', { name: 'Guardar password' }).click();
    await page.getByRole('status').filter({ hasText: 'Password alterada' }).waitFor();

    for (const failure of [false, true]) {
      await reset(); await page.evaluate(() => { window.fixture.login('alice'); window.fixture.render('terms'); window.fixture.modes.accept_terms = 'pending'; });
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Aceitar e Continuar' }).click();
      await page.evaluate(() => window.fixture.login('carol')); await finish('accept_terms', failure);
      assert.equal(await page.evaluate(() => window.fixture.accepted), 0);
      await page.getByRole('button', { name: 'Aceitar e Continuar' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Aceitar e Continuar' }).isDisabled(), true);
      await page.getByRole('checkbox').check();
      await mode('accept_terms', 'throw'); await page.getByRole('button', { name: 'Aceitar e Continuar' }).click();
      await page.getByText('Não foi possível guardar o consentimento. Tenta novamente.').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Aceitar e Continuar' }).isEnabled(), true);
    }

    await reset(); await page.evaluate(() => { window.fixture.login('alice'); window.fixture.render('settings'); window.fixture.modes.delete_own_user_account = 'pending'; });
    await page.getByRole('button', { name: 'Apagar a minha conta' }).click();
    await page.getByRole('button', { name: 'Sim, apagar' }).click();
    await page.evaluate(() => window.fixture.login('carol')); await finish('delete_own_user_account');
    await page.getByRole('button', { name: 'Apagar a minha conta' }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.closed), 0);
    assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.name === 'logout')), false);
    await page.getByRole('button', { name: 'Apagar a minha conta' }).click(); await mode('delete_own_user_account', 'throw');
    await page.getByRole('button', { name: 'Sim, apagar' }).click();
    await page.getByText('A eliminação da conta não foi confirmada.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sim, apagar' }).isEnabled(), true);

    // Actual App startup, including StrictMode teardown, against an isolated Auth API.
    await reset(); await mode('startup', 'pending'); await page.evaluate(() => window.fixture.render('app'));
    await page.waitForFunction(() => window.fixture.pending.some(item => item.name === 'startup'));
    await page.evaluate(() => window.fixture.events.forEach(cb => cb('SIGNED_IN', { user: { id: 'new' } })));
    await page.getByText('Lobby autorizado').waitFor();
    await finish('startup', true); await finish('startup', false);
    assert.equal(await page.evaluate(() => window.stores.auth.getState().user.id), 'new');
    // A delayed scoped logout notice carries no old null session. Its read is
    // itself invalidated if a new identity arrives before the read completes.
    await page.evaluate(() => { const channel = new BroadcastChannel('unider-auth-storage-changes'); channel.postMessage('changed'); channel.close(); });
    await page.waitForFunction(() => window.fixture.pending.some(item => item.name === 'startup'));
    await page.evaluate(() => window.fixture.events.forEach(cb => cb('SIGNED_IN', { user: { id: 'newer-after-notice' } })));
    await finish('startup'); await finish('startup');
    assert.equal(await page.evaluate(() => window.stores.auth.getState().user.id), 'newer-after-notice');
    await reset(); await mode('startup', 'throw'); await page.evaluate(() => window.fixture.render('app'));
    await page.getByText('A sessão inicial não foi confirmada.', { exact: false }).waitFor();
    await page.locator('#email').waitFor();
    assert.equal(await page.evaluate(() => window.stores.auth.getState().isLoading), false);
    // Public legal pages remain readable before login, without OTP/acceptance.
    const legalCallsBefore = await page.evaluate(() => window.fixture.calls.filter(call => ['send', 'verify', 'accept_terms'].includes(call.name)).length);
    await page.evaluate(() => { history.pushState({}, '', '/privacidade'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByRole('heading', { name: 'Política de Privacidade', exact: true }).waitFor();
    assert.ok((await page.locator('main').innerText()).includes('João António Pires Martins dos Santos Rodrigues'));
    assert.ok((await page.locator('main').innerText()).includes('aquecimentoapp@gmail.com'));
    assert.equal(await page.getByRole('button', { name: 'Aceitar e Continuar' }).count(), 0);
    await page.evaluate(() => { history.pushState({}, '', '/termos'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByRole('heading', { name: 'Termos de Utilização', exact: true }).waitFor();
    assert.ok((await page.locator('main').innerText()).includes('18 ou mais anos'));
    await page.evaluate(() => window.fixture.events.forEach(cb => cb('SIGNED_IN', { user: { id: 'legal-reader' } })));
    await page.getByRole('heading', { name: 'Termos de Utilização', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(call => ['send', 'verify', 'accept_terms'].includes(call.name)).length), legalCallsBefore);
    await page.evaluate(() => { history.pushState({}, '', '/recuperar-password'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.locator('#new-password').waitFor();
    await page.evaluate(() => window.fixture.events.forEach(cb => cb('SIGNED_OUT', null)));
    await page.locator('#recovery-email').waitFor();
    assert.equal(new URL(page.url()).pathname, '/recuperar-password');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    t.diagnostic('Actual Login, App, Terms, Settings and stores; local API fixture; no external requests.');
  } finally { if (browser) await browser.close(); await server.close(); }
});
