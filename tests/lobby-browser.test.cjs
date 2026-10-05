const assert = require('node:assert/strict');
const { test } = require('node:test');

// Optional real-browser fixture. No Supabase client is loaded, and all requests
// outside the loopback origin are blocked. No accounts, OTP or hosted data.
test('isolated browser: refresh, cancellation, terms, cutoffs and suggestion retry', {
  skip: !process.env.UNIDER_TEST_PLAYWRIGHT ? 'Set UNIDER_TEST_PLAYWRIGHT to an installed Playwright module; no installation required by this test.' : false,
  timeout: 60000,
}, async t => {
  const { chromium } = require(process.env.UNIDER_TEST_PLAYWRIGHT);
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const root = process.cwd().replaceAll('\\', '/');
  const fixture = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { BrowserRouter, Routes, Route } from 'react-router-dom';
    import Lobby from '/src/pages/Lobby.tsx';
    import { useAuthStore } from '/src/store/authStore.ts';
    import { useChatStore } from '/src/store/chatStore.ts';
    import { useAppStore } from '/src/store/appStore.ts';
    import { useTimeSync } from '/src/hooks/useTimeSync.ts';
    import { clockSample } from '/src/lib/serverClock.ts';
    import '/src/index.css';
    window.fixture = { terms: 'accepted', suggestion: 'error', calls: [], pending: [] };
    const saved = JSON.parse(sessionStorage.getItem('fixture-config') || '{}');
    Object.assign(window.fixture, saved);
    window.fixtureServerNow = Date.parse(sessionStorage.getItem('fixture-server-now') || new Date(window.fixtureNow).toISOString());
    window.fixture.syncClock = () => {
      const state = useAppStore.getState(), userId = useAuthStore.getState().user?.id;
      state.confirmClock(clockSample(new Date(window.fixtureServerNow).toISOString(), userId, 0, performance.now(), performance.now()));
    };
    useChatStore.getState().setOwner('alice');
    window.stores = { auth: useAuthStore, chat: useChatStore, app: useAppStore };
    function App() {
      useTimeSync();
      return <Routes><Route path='/chat' element={<p>Chat fixture: pedido de emparelhamento</p>} />
        <Route path='*' element={<Lobby />} /></Routes>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
  `;
  const mockAuth = `
    import { create } from 'zustand';
    import { useChatStore } from '/src/store/chatStore.ts';
    export const useAuthStore = create(() => ({ user: { id: 'alice' }, signOut: async () => {
      useChatStore.getState().resetChat(); useAuthStore.setState({ user: null });
    } }));
  `;
  const mockSupabase = `
    export const supabase = {
      functions: { invoke(name) {
        if (name !== 'get-server-time') throw new Error('Unexpected Function');
        window.fixture.calls.push(name);
        if (window.fixture.clockMode === 'error') return Promise.resolve({ data: null, error: {} });
        if (window.fixture.clockMode === 'pending') return new Promise((resolve, reject) => (window.fixture.clockPending ||= []).push({ resolve, reject }));
        return Promise.resolve({ data: { server_now: new Date(window.fixtureServerNow).toISOString() }, error: null });
      } },
      from(table) {
        const query = {
          select() { return query; }, eq() { return query; },
          single() {
            window.fixture.calls.push('terms');
            const reply = () => ({ data: { terms_version: window.fixture.terms === 'accepted' ? '1.1' : null }, error: null });
            if (window.fixture.terms === 'pending') return new Promise(resolve => window.fixture.pending.push(() => resolve(reply())));
            if (window.fixture.terms === 'error') return Promise.reject(new Error('fixture offline'));
            return Promise.resolve(reply());
          },
          insert(payload) {
            if (table !== 'icebreaker_suggestions') throw new Error('Unexpected write');
            window.fixture.calls.push({ suggestion: payload });
            if (window.fixture.suggestion === 'pending') return new Promise(resolve => window.fixture.pending.push(() => resolve({ error: null })));
            if (window.fixture.suggestion === 'throw') throw new Error('fixture offline');
            return Promise.resolve({ error: window.fixture.suggestion === 'success' ? null : { message: 'fixture error' } });
          }
        };
        return query;
      },
      rpc(name) {
        window.fixture.calls.push(name);
        if (name !== 'accept_terms') throw new Error('Unexpected RPC');
        const reply = Promise.resolve(window.fixture.accept === false ? { data: false, error: { message: 'fixture refused' } } : { data: true, error: null });
        reply.abortSignal = () => reply;
        return reply;
      },
      channel() { throw new Error('Lobby must not open a channel'); }
    };
  `;
  const server = await createServer({ root, configFile: false, cacheDir: 'node_modules/.vite-lobby-fixture', logLevel: 'error',
    plugins: [react({ exclude: /lobby-fixture/ }), { name: 'isolated-lobby-fixture', enforce: 'pre',
      resolveId(id) {
        if (['/fixture.tsx', '/tests/lobby-fixture.tsx', root + '/tests/lobby-fixture.tsx'].includes(id)) return root + '/tests/lobby-fixture.tsx';
      },
      load(id) {
        if (id === root + '/tests/lobby-fixture.tsx') return fixture;
        if (id === root + '/src/store/authStore.ts') return mockAuth;
        if (id === root + '/src/lib/supabase.ts') return mockSupabase;
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!['/lobby', '/chat'].includes(req.url.split('?')[0])) return next();
          const html = await vite.transformIndexHtml('/lobby', '<html lang="pt-PT"><body class="bg-slate-900 text-slate-100"><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
          res.setHeader('Content-Type', 'text/html'); res.end(html);
        });
      },
    }],
    server: { host: '127.0.0.1', port: 0, watch: null },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.UNIDER_TEST_BROWSER ? { executablePath: process.env.UNIDER_TEST_BROWSER } : {}) });
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const external = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/')) return route.continue();
      external.push(url); return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const NativeDate = Date;
      const initial = sessionStorage.getItem('fixture-now') || '2026-10-05T21:28:00Z';
      window.fixtureNow = NativeDate.parse(initial);
      window.fixtureElapsed = 0;
      Object.defineProperty(performance, 'now', { value: () => window.fixtureElapsed });
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [window.fixtureNow])); }
        static now() { return window.fixtureNow; }
      };
    });
    const setTime = async time => page.evaluate(value => {
      window.fixtureNow = Date.parse(value);
      window.fixtureServerNow = window.fixtureNow;
      sessionStorage.setItem('fixture-now', value);
      sessionStorage.setItem('fixture-server-now', value);
      window.fixture.syncClock();
    }, time);
    const reset = async (time, config = {}) => {
      await page.evaluate(({ time, config }) => {
        sessionStorage.clear();
        sessionStorage.setItem('fixture-now', time);
        sessionStorage.setItem('fixture-config', JSON.stringify(config));
      }, { time, config });
      await page.goto(origin + '/lobby');
      await page.waitForFunction(() => Boolean(window.stores));
    };
    await page.goto(origin + '/lobby');
    const prepare = () => page.getByRole('button', { name: 'Preparar entrada às 22h30' });
    await prepare().click();
    await page.getByText('Entrada preparada.', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Cancelar espera' }).click();
    await page.reload();
    await prepare().waitFor();
    await setTime('2026-10-05T21:30:00Z');
    assert.equal(new URL(page.url()).pathname, '/lobby');
    await reset('2026-10-05T21:29:59Z');
    await prepare().click();
    await page.reload();
    await page.getByText('Entrada preparada.', { exact: true }).waitFor();
    await setTime('2026-10-05T21:30:00Z');
    await page.waitForURL('**/chat');
    await page.evaluate(() => window.stores.chat.getState().resetChat());
    await page.goto(origin + '/lobby'); // Return after cancellation, avoiding an automatic re-entry race.
    await page.reload();
    await page.getByRole('button', { name: 'Entrar na Fila do Campus' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/lobby');

    for (const clock of ['21:35:00', '21:47:59', '21:48:00', '21:49:59', '21:50:00']) {
      await setTime('2026-10-05T' + clock + 'Z');
      if (clock < '21:48:00') await page.getByRole('button', { name: 'Entrar na Fila do Campus' }).waitFor();
      else assert.equal(await page.getByRole('button', { name: 'Entrar na Fila do Campus' }).count(), 0);
      if (clock === '21:35:00') await page.getByText('13:00', { exact: true }).waitFor();
    }
    await page.evaluate(() => {
      const state = window.stores.chat.getState();
      state.setRoom('fixture-room', 'bob');
      state.addMessage({ id: 'fixture-message', text: 'fixture' });
    });
    await setTime('2026-10-05T21:49:59Z');
    await page.getByRole('button', { name: 'Voltar à conversa' }).waitFor();
    assert.equal(await page.evaluate(() => window.stores.chat.getState().messages.length), 1);
    assert.equal(await page.getByRole('button', { name: 'Entrar na Fila do Campus' }).count(), 0);

    await reset('2026-10-05T21:28:00Z');
    await prepare().click();
    await page.evaluate(() => sessionStorage.setItem('fixture-config', JSON.stringify({ terms: 'pending' })));
    await page.reload();
    await page.waitForFunction(() => window.fixture?.pending.length > 0);
    await setTime('2026-10-05T21:30:00Z');
    assert.equal(new URL(page.url()).pathname, '/lobby');
    await page.evaluate(() => { window.fixture.terms = 'required'; window.fixture.pending.splice(0).forEach(resolve => resolve()); });
    await page.getByText('Termos de Utilização', { exact: true }).waitFor();
    await page.evaluate(() => { window.fixture.accept = false; });
    await page.getByRole('button', { name: 'Aceitar e Continuar' }).click();
    await page.getByText('Não foi possível guardar o consentimento. Tenta novamente.', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/lobby');
    await page.evaluate(() => { window.fixture.accept = true; });
    await page.getByRole('button', { name: 'Aceitar e Continuar' }).click();
    await page.waitForURL('**/chat');

    await reset('2026-10-05T21:30:00Z', { terms: 'error' });
    await page.getByRole('button', { name: 'Verificar termos' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Entrar na Fila do Campus' }).isDisabled(), true);
    await page.evaluate(() => { window.fixture.terms = 'accepted'; });
    await page.getByRole('button', { name: 'Verificar termos' }).click();
    await page.waitForFunction(() => !document.querySelector('button.animate-pulse').disabled);

    await reset('2026-10-05T21:30:00Z', { terms: 'pending' });
    await page.waitForFunction(() => window.fixture.pending.length > 0);
    await page.evaluate(() => {
      window.fixture.oldTerms = window.fixture.pending.splice(0);
      window.stores.chat.getState().setOwner('bob');
      window.stores.auth.setState({ user: { id: 'bob' } });
    });
    await page.waitForFunction(() => window.fixture.pending.length > 0);
    await page.evaluate(async () => {
      window.fixture.terms = 'accepted';
      window.fixture.oldTerms.forEach(resolve => resolve());
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.getByRole('button', { name: 'Entrar na Fila do Campus' }).isDisabled(), true);
    assert.equal(new URL(page.url()).pathname, '/lobby');

    await reset('2026-10-05T21:47:59Z');
    await page.getByRole('button', { name: 'Entrar na Fila do Campus' }).waitFor();
    await page.evaluate(() => { window.fixtureServerNow = Date.parse('2026-10-05T21:48:00Z'); window.fixtureElapsed += 10000; window.dispatchEvent(new Event('focus')); });
    await page.getByRole('heading', { name: 'A sessão fecha às 22h50' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Entrar na Fila do Campus' }).count(), 0);

    await reset('2026-10-05T12:00:00Z');
    const text = 'Uma sugestão de teste local';
    await page.getByRole('textbox').fill(text);
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('textbox').inputValue(), text);
    assert.equal(await page.getByRole('button', { name: 'Enviar', exact: true }).isEnabled(), true);
    await page.evaluate(() => { window.fixture.suggestion = 'throw'; });
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    assert.equal(await page.getByRole('textbox').inputValue(), text);
    await page.evaluate(() => { window.fixture.suggestion = 'success'; });
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.getByRole('status').waitFor();
    assert.equal(await page.getByRole('textbox').inputValue(), '');
    await page.getByRole('textbox').fill('Outra sugestão local');
    await page.evaluate(() => { window.fixture.suggestion = 'pending'; });
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.waitForFunction(() => window.fixture.pending.length > 0);
    await page.evaluate(() => {
      window.stores.chat.getState().setOwner('bob');
      window.stores.auth.setState({ user: { id: 'bob' } });
    });
    await page.waitForFunction(() => document.querySelector('textarea').value === '');
    await page.getByRole('textbox').fill('Texto do novo utilizador');
    await page.evaluate(() => window.fixture.pending.splice(0).forEach(resolve => resolve()));
    assert.equal(await page.getByRole('textbox').inputValue(), 'Texto do novo utilizador');
    assert.equal(await page.getByRole('status').count(), 0);
    assert.equal(await page.getByRole('textbox').isEnabled(), true);

    // Device day/time diverges from the authenticated server sample. Refresh
    // retains server-day intent; failure/staleness cannot clear it or a room.
    await reset('2026-10-05T21:28:00Z');
    await prepare().click();
    await page.evaluate(() => {
      sessionStorage.setItem('fixture-server-now', new Date(window.fixtureServerNow).toISOString());
      sessionStorage.setItem('fixture-now', '2026-10-07T08:00:00Z');
      window.fixtureNow = Date.parse('2026-10-07T08:00:00Z'); window.stores.app.getState().updateTime();
    });
    await page.reload();
    assert.equal(await page.evaluate(() => window.stores.chat.getState().queueDay), '2026-10-05');
    await page.getByText('Entrada preparada.', { exact: true }).waitFor();
    const reads = await page.evaluate(() => window.fixture.calls.filter(name => name === 'get-server-time').length);
    await page.evaluate(() => { for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('focus')); });
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(name => name === 'get-server-time').length), reads);
    await page.evaluate(() => { window.fixture.clockMode = 'error'; window.fixtureElapsed += 90000; window.dispatchEvent(new Event('focus')); });
    await page.getByRole('heading', { name: 'Horário por confirmar' }).waitFor();
    await page.getByRole('button', { name: 'Cancelar espera' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/lobby');
    assert.equal(await page.evaluate(() => window.stores.chat.getState().isQueueing), true);
    await page.evaluate(() => window.stores.chat.getState().setRoom('clock-room', 'bob'));
    await page.getByRole('button', { name: 'Voltar à conversa' }).waitFor();
    assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), 'clock-room');
    await reset('2026-10-05T21:30:00Z', { clockMode: 'error' });
    await page.getByRole('heading', { name: 'Horário por confirmar' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Entrar na Fila do Campus' }).isDisabled(), true);
    await reset('2026-10-05T21:30:00Z', { clockMode: 'pending' });
    await page.waitForFunction(() => window.fixture.clockPending?.length > 0);
    await page.evaluate(() => { window.fixture.oldClock = window.fixture.clockPending.splice(0); window.stores.chat.getState().setOwner('bob'); window.stores.auth.setState({ user: { id: 'bob' } }); });
    await page.evaluate(() => window.fixture.oldClock.forEach(item => item.resolve({ data: { server_now: '2026-10-05T21:30:00.000Z' }, error: null })));
    assert.equal(await page.evaluate(() => window.stores.app.getState().clockStatus), 'unconfirmed');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.UNIDER_TEST_SCREENSHOT) await page.screenshot({ path: process.env.UNIDER_TEST_SCREENSHOT, fullPage: true });
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    t.diagnostic(`390x844 Chromium ${browser.version()}; real Lobby, clock hook, React StrictMode and Zustand; simulated server samples, skewed device, stale/failure/old responses; no external HTTP requests.`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
