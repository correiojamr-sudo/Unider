const assert = require('node:assert/strict');
const { test } = require('node:test');

test('isolated auth browser: OTP recovery, late replies, Terms/Settings and startup races', {
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
      return view === 'login' ? <Login /> : view === 'terms' ? <TermsModal onAccept={() => window.fixture.accepted++} />
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
    const fillEmail = async email => { await page.locator('#email').fill(email); await page.getByRole('checkbox').check(); };
    const finish = (name, failure = false) => page.evaluate(([name, failure]) => {
      const index = window.fixture.pending.findIndex(item => item.name === name);
      if (index >= 0) window.fixture.pending.splice(index, 1)[0].finish(failure);
    }, [name, failure]);
    await reset(); await fillEmail('  Nome@STUDENT.UC.PT  '); await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByText('Pedido de email confirmado para', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls[0].args.email), 'nome@student.uc.pt');
    assert.equal(await page.getByRole('button', { name: /Reenviar em/ }).isDisabled(), true);
    await page.locator('#otp').fill('12345678'); await mode('verify', 'error');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'expirou' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Entrar', exact: true }).isEnabled(), true);
    assert.ok(!(await page.locator('body').innerText()).includes('SECRET'));
    await page.clock.install(); await page.clock.fastForward(61000);
    await mode('send', 'throw'); await page.getByRole('button', { name: 'Reenviar código', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Não foi possível' }).waitFor();
    assert.ok((await page.locator('body').innerText()).includes('nome@student.uc.pt'));
    await page.clock.fastForward(61000); await mode('send', 'success');
    await page.getByRole('button', { name: 'Reenviar código', exact: true }).click();
    await page.getByRole('button', { name: /Reenviar em/ }).waitFor();
    await page.locator('#otp').fill('1234567890'); await mode('verify', 'pending');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('button', { name: 'Voltar e corrigir email' }).click();
    await page.locator('#email').fill('outra@student.uc.pt'); await finish('verify');
    assert.equal(await page.evaluate(() => window.stores.auth.getState().user), null);
    assert.equal(await page.locator('#email').inputValue(), 'outra@student.uc.pt');
    await page.clock.resume();

    // Send response after correction must not show an OTP destination or keep loading.
    await reset(); await fillEmail('alice@student.uc.pt'); await mode('send', 'pending');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.locator('#email').fill('bob@student.uc.pt'); await finish('send');
    assert.equal(await page.locator('#otp').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'A enviar...' }).count(), 0);

    // Rejection at the first step never claims that mail was sent.
    await reset(); await fillEmail('alice@student.uc.pt'); await mode('send', 'throw');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.equal(await page.locator('#otp').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'A enviar...' }).count(), 0);

    for (const failure of [false, true]) {
      await reset(); await page.evaluate(() => { window.fixture.login('alice'); window.fixture.render('terms'); window.fixture.modes.accept_terms = 'pending'; });
      await page.getByRole('button', { name: 'Aceitar e Continuar' }).click();
      await page.evaluate(() => window.fixture.login('carol')); await finish('accept_terms', failure);
      assert.equal(await page.evaluate(() => window.fixture.accepted), 0);
      await page.getByRole('button', { name: 'Aceitar e Continuar' }).waitFor();
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
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    t.diagnostic('Actual Login, App, Terms, Settings and stores; local API fixture; no external requests.');
  } finally { if (browser) await browser.close(); await server.close(); }
});
