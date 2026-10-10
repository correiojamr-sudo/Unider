const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');

test('browser keyboard: modal isolation, required consent, restoration and compact layouts', {
  skip: !process.env.UNIDER_TEST_PLAYWRIGHT ? 'Set UNIDER_TEST_PLAYWRIGHT to an installed module.' : false,
  timeout: 60000,
}, async t => {
  const { chromium } = require(process.env.UNIDER_TEST_PLAYWRIGHT);
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const root = process.cwd().replaceAll('\\', '/');
  const fixture = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { BrowserRouter } from 'react-router-dom';
    import Lobby from '/src/pages/Lobby.tsx';
    import Login from '/src/pages/Login.tsx';
    import TermsModal from '/src/components/modals/TermsModal.tsx';
    import { useAuthStore } from '/src/store/authStore.ts';
    import { useAppStore } from '/src/store/appStore.ts';
    import { useChatStore } from '/src/store/chatStore.ts';
    import '/src/index.css';
    window.fixture = { terms: 'accepted', accept: false, calls: [] };
    useAppStore.setState({ currentTime: new Date('2026-10-05T12:00:00Z') });
    window.fixture.auth = useAuthStore;
    window.fixture.app = useAppStore; window.fixture.chat = useChatStore;
    function Root() {
      const [view, render] = useState('lobby');
      const [extraTerms, showTerms] = useState(false);
      window.fixture.render = render; window.fixture.showTerms = showTerms;
      return <><BrowserRouter>{view === 'login' ? <Login /> : <Lobby />}</BrowserRouter>
        {extraTerms && <TermsModal onAccept={() => showTerms(false)} />}</>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><Root /></React.StrictMode>);
  `;
  const auth = `
    import { create } from 'zustand';
    export const useAuthStore = create(() => ({ user: { id: 'alice' }, contextVersion: 1,
      isSigningOut: false, signOut: async () => {}, signOutForContext: async () => false }));
  `;
  const api = `
    export const supabase = {
      from() { const query = { select() { return query; }, eq() { return query; },
        abortSignal() { return query; },
        single() { return Promise.resolve({ data: { terms_version: window.fixture.terms === 'accepted' ? '2.0' : null }, error: null }); } }; return query; },
      rpc(name, args) {
        window.fixture.calls.push({ name, args });
        if (name === 'accept_terms' && window.fixture.accept) window.fixture.terms = 'accepted';
        const reply = Promise.resolve({ data: name === 'accept_terms' && window.fixture.accept, error: null });
        reply.abortSignal = () => reply; return reply;
      }
    };
  `;
  const html = fs.readFileSync('index.html', 'utf8').replace('/src/main.tsx', '/accessibility-fixture.tsx');
  const server = await createServer({ root, configFile: false, cacheDir: 'node_modules/.vite-accessibility-fixture', logLevel: 'error',
    plugins: [react({ exclude: /accessibility-fixture/ }), { name: 'isolated-accessibility-fixture', enforce: 'pre',
      resolveId(id) {
        if (['/accessibility-fixture.tsx', '/tests/accessibility-fixture.tsx', root + '/tests/accessibility-fixture.tsx'].includes(id)) return root + '/tests/accessibility-fixture.tsx';
      },
      load(id) {
        if (id === root + '/tests/accessibility-fixture.tsx') return fixture;
        if (id === root + '/src/store/authStore.ts') return auth;
        if (id === root + '/src/lib/supabase.ts') return api;
      },
      configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
        if (req.url.split('?')[0] !== '/') return next();
        res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/', html));
      }); },
    }], server: { host: '127.0.0.1', port: 0, watch: null },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.UNIDER_TEST_BROWSER ? { executablePath: process.env.UNIDER_TEST_BROWSER } : {}) });
    const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const external = [], errors = [];
    await context.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    const focused = async locator => assert.equal(await locator.evaluate(element => element === document.activeElement), true);
    const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto(origin);
    assert.equal(await page.title(), 'Aquecimento');
    assert.equal(await page.locator('html').getAttribute('lang'), 'pt-PT');
    const favicon = await context.request.get(origin + '/favicon.svg');
    assert.equal(favicon.status(), 200); assert.match(await favicon.text(), /<title>Aquecimento<\/title>/);
    const trigger = page.getByRole('button', { name: 'Definições', exact: true });
    await page.getByRole('textbox', { name: 'Sugestão de quebra-gelo' }).waitFor();
    await page.getByRole('button', { name: 'Terminar sessão' }).waitFor();
    await noOverflow(); await trigger.click();
    const settings = page.getByRole('dialog', { name: 'Definições', exact: true });
    await settings.waitFor(); assert.equal(await settings.getAttribute('aria-modal'), 'true');
    assert.ok(await settings.getAttribute('aria-describedby'));
    const close = page.getByRole('button', { name: 'Fechar definições' });
    const remove = page.getByRole('button', { name: 'Apagar a minha conta' });
    await focused(close);
    assert.equal(await page.locator('#root').evaluate(element => element.inert), true);
    await page.evaluate(() => {
      const button = document.createElement('button'); button.id = 'dynamic-background';
      button.textContent = 'Fundo dinâmico'; document.body.append(button);
    });
    await page.waitForFunction(() => document.getElementById('dynamic-background').inert);
    await page.evaluate(() => document.querySelector('#root button').focus()); await focused(close);
    await page.keyboard.press('Shift+Tab'); await focused(remove);
    await page.keyboard.press('Tab'); await focused(close);
    assert.equal(await close.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
    await remove.click(); const cancel = page.getByRole('button', { name: 'Cancelar', exact: true });
    await focused(cancel); await noOverflow();
    await page.screenshot({ path: process.env.UNIDER_ACCESSIBILITY_SCREENSHOT || undefined });
    await cancel.click(); await focused(remove);
    await page.keyboard.press('Escape'); await settings.waitFor({ state: 'detached' }); await focused(trigger);
    assert.equal(await page.locator('#root').evaluate(element => element.inert), false);
    assert.equal(await page.locator('#dynamic-background').evaluate(element => element.inert), false);
    await page.evaluate(() => document.getElementById('dynamic-background').remove());
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);

    // Required consent above an already open Settings dialog cannot be dismissed.
    await trigger.click(); await page.evaluate(() => window.fixture.showTerms(true));
    const terms = page.getByRole('dialog', { name: 'Termos de Utilização' });
    await terms.waitFor(); await focused(page.getByRole('heading', { name: 'Termos de Utilização' }));
    const accept = page.getByRole('button', { name: 'Aceitar e Continuar' });
    assert.equal(await accept.isDisabled(), true);
    await page.keyboard.press('Shift+Tab'); await focused(terms.getByRole('checkbox'));
    await page.keyboard.press('Tab'); await focused(page.getByRole('region', { name: 'Texto dos termos' }));
    await page.keyboard.press('Tab'); await focused(terms.getByRole('link'));
    await page.keyboard.press('Tab'); await focused(terms.getByRole('checkbox'));
    await terms.getByRole('checkbox').check();
    await page.keyboard.press('Escape'); assert.equal(await terms.count(), 1);
    await page.mouse.click(1, 1); assert.equal(await terms.count(), 1);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
    await accept.click(); await terms.getByRole('alert').waitFor(); assert.equal(await terms.count(), 1);
    await page.evaluate(() => { window.fixture.accept = true; }); await terms.getByRole('checkbox').check(); await accept.click();
    await terms.waitFor({ state: 'detached' }); await focused(close);
    await page.keyboard.press('Escape'); await focused(trigger);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map(call => call.args)), [{ p_version: '2.0', p_adult: true }, { p_version: '2.0', p_adult: true }]);

    // Actual Lobby consent gate also survives Escape and does not create queue intent.
    await page.evaluate(() => {
      window.fixture.terms = 'required'; window.fixture.accept = false;
      window.fixture.app.setState({ currentTime: new Date('2026-10-05T21:29:00Z') });
      window.fixture.auth.setState({ user: { id: 'bob' }, contextVersion: 2 });
    });
    await terms.waitFor(); await page.keyboard.press('Escape'); assert.equal(await terms.count(), 1);
    assert.equal(await page.evaluate(() => window.fixture.chat.getState().isQueueing), false);
    assert.equal(await page.locator('#root button').filter({ hasText: 'Preparar entrada às 22h30' }).isDisabled(), true);
    await noOverflow();
    const box = await terms.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 568);
    await page.evaluate(() => { window.fixture.accept = true; }); await terms.getByRole('checkbox').check(); await accept.click();
    await terms.waitFor({ state: 'detached' });
    await page.evaluate(() => window.fixture.render('login'));
    await page.getByRole('textbox', { name: 'Email Institucional' }).waitFor();
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await page.getByRole('checkbox', { name: /buffer temporário/ }).waitFor(); await noOverflow();
    assert.ok(!(await page.locator('body').innerText()).includes('registo integral'));
    await page.evaluate(() => window.fixture.render('lobby')); await trigger.click();
    await remove.click(); await page.getByRole('button', { name: 'Sim, apagar' }).click();
    await page.getByRole('status').filter({ hasText: 'Falta confirmar a saída' }).waitFor();
    await focused(page.getByRole('button', { name: 'Confirmar saída' }));
    await page.keyboard.press('Escape'); await settings.waitFor({ state: 'detached' }); await focused(trigger);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    t.diagnostic('Real components and keyboard in Chrome at 320×568; StrictMode, stacked dialogs, no external requests.');
  } finally { if (browser) await browser.close(); await server.close(); }
});
