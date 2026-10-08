const assert = require('node:assert/strict');
const { test } = require('node:test');

test('isolated chat browser recovery and stale-response regressions', {
  skip: !process.env.UNIDER_TEST_PLAYWRIGHT ? 'Set UNIDER_TEST_PLAYWRIGHT to an installed module.' : false,
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
    import Chat from '/src/pages/Chat.tsx';
    import Lobby from '/src/pages/Lobby.tsx';
    import { useAuthStore } from '/src/store/authStore.ts';
    import { useChatStore } from '/src/store/chatStore.ts';
    import { useTimeSync } from '/src/hooks/useTimeSync.ts';
    import '/src/index.css';
    const config = JSON.parse(sessionStorage.getItem('fixture-config') || '{}');
    window.fixture = { roomMode: 'active', leaveMode: 'success', reportMode: 'error409', sendMode: 'success',
      extendMode: 'success', matchMode: 'waiting', historyMode: 'success', history: [], calls: [], pending: [], channels: [], ...config,
      serverRoom: { status: 'matched', room_id: 'room-a', peer_id: 'bob', expires_at: '2026-10-05T21:32:00Z',
        hard_close_at: '2026-10-05T21:50:00Z', decision_until: '2026-10-05T21:32:30Z',
        ended_at: null, end_reason: null, extended_once: false, extended: false, peer_extended: false } };
    if (!sessionStorage.getItem('fixture-loaded')) {
      useChatStore.getState().setOwner('alice');
      if (config.queue) useChatStore.getState().setQueueing(true);
      else {
        useChatStore.getState().setRoom('room-a', 'bob');
        useChatStore.getState().addMessage({ id: 'saved', sender_id: 'bob', text: 'Mensagem guardada', timestamp: '2026-10-05T21:30:00Z' });
      }
      sessionStorage.setItem('fixture-loaded', 'true');
    }
    window.stores = { auth: useAuthStore, chat: useChatStore };
    function App() { useTimeSync(); return <Routes><Route path='/lobby' element={<Lobby />} /><Route path='*' element={<Chat />} /></Routes>; }
    createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
  `;
  const mockAuth = `
    import { create } from 'zustand';
    export const useAuthStore = create(() => ({ user: { id: 'alice' }, signOut: async () => {} }));
  `;
  const mockSupabase = `
    function room(id) { return { ...window.fixture.serverRoom, room_id: id, peer_id: window.stores.chat.getState().peerId || 'bob',
      server_now: new Date().toISOString() }; }
    function response(type, mode, success, call) {
      let promise;
      if (mode === 'pending') promise = new Promise((resolve, reject) => window.fixture.pending.push({ type, call,
        finish: (failure = false, result) => failure ? reject(new TypeError('fixture offline')) : resolve(result ?? success()) }));
      else if (mode === 'offline') promise = Promise.reject(new TypeError('fixture offline'));
      else if (mode === 'denied') promise = Promise.resolve({ data: null, error: { code: '42501' }, status: 403 });
      else if (mode === 'transient') promise = Promise.resolve({ data: null, error: { code: '08006' }, status: 503 });
      else if (mode === 'unknown') promise = Promise.resolve({ data: null, error: { message: 'Room unavailable' }, status: 400 });
      else if (mode === 'malformed') promise = Promise.resolve({ data: { status: 'matched', room_id: 'other-room' }, error: null, status: 200 });
      else if (mode.startsWith('error')) promise = Promise.resolve({ data: null, error: { name: 'FunctionsHttpError', context: { status: Number(mode.slice(5)) } } });
      else promise = Promise.resolve(success());
      promise.abortSignal = () => promise;
      return promise;
    }
    export const supabase = {
      rpc(name, args) {
        const f = window.fixture; const call = { name, args }; f.calls.push(call);
        if (name === 'get_room_state') return response(name, f.roomMode, () => ({ data: room(args.p_room), error: null, status: 200 }), call);
        if (name === 'find_or_join_match') return response(name, f.matchMode, () => ({ data: f.matchMode === 'matched' ? room('room-a') : { status: 'waiting', server_now: new Date().toISOString() }, error: null, status: 200 }), call);
        if (name === 'extend_room') return response(name, f.extendMode, () => {
          f.serverRoom.extended = true;
          return { data: room(args.p_room), error: null, status: 200 };
        }, call);
        if (name === 'leave_room' || name === 'leave_matchmaking') return response(name, f.leaveMode, () => ({ data: null, error: null, status: 204 }), call);
        throw new Error('Unexpected RPC: ' + name);
      },
      functions: { invoke(name, options) {
        const f = window.fixture; const call = { name, ...options }; f.calls.push(call);
        if (name === 'get-server-time') return Promise.resolve({ data: { server_now: new Date().toISOString() }, error: null });
        if (name === 'get-room-messages') return response(name, f.historyMode,
          () => ({ data: { success: true, roomId: options.body.roomId, partial: true, messages: f.history.slice() }, error: null }), call);
        const sender = window.stores.auth.getState().user.id;
        return response(name, name === 'send-message' ? f.sendMode : f.reportMode, () => ({ data: name === 'send-message'
          ? { success: true, message: { ...options.body.message, sender_id: sender, timestamp: new Date().toISOString() } } : { success: true }, error: null }), call);
      } },
      realtime: { setAuth: () => Promise.resolve() },
      channel(topic, config) {
        const channel = { topic, config, on(event, filter, callback) { channel.receive = callback; return channel; },
          subscribe(callback) { channel.status = callback; callback('SUBSCRIBED'); return channel; } };
        window.fixture.channels.push(channel); return channel;
      },
      removeChannel(channel) { channel.removed = true; return Promise.resolve(); },
      from(table) {
        const query = { select() { return query; }, eq() { return query; },
          abortSignal() { return query; },
          single() { const reply = Promise.resolve({ data: { terms_version: '1.1' }, error: null }); reply.abortSignal = () => reply; return reply; },
          limit() { return Promise.resolve({ data: [], error: null }); } };
        if (!['profiles', 'icebreaker_suggestions'].includes(table)) throw new Error('Unexpected table');
        return query;
      }
    };
  `;
  const server = await createServer({ root, configFile: false, cacheDir: 'node_modules/.vite-chat-fixture', logLevel: 'error',
    plugins: [react({ exclude: /chat-fixture/ }), { name: 'isolated-chat-fixture', enforce: 'pre',
      resolveId(id) { if (['/fixture.tsx', '/tests/chat-fixture.tsx', root + '/tests/chat-fixture.tsx'].includes(id)) return root + '/tests/chat-fixture.tsx'; },
      load(id) {
        if (id === root + '/tests/chat-fixture.tsx') return fixture;
        if (id === root + '/src/store/authStore.ts') return mockAuth;
        if (id === root + '/src/lib/supabase.ts') return mockSupabase;
      },
      configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
        if (!['/lobby', '/chat'].includes(req.url.split('?')[0])) return next();
        const html = await vite.transformIndexHtml('/chat', '<html lang="pt-PT"><body class="bg-slate-900 text-slate-100"><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      }); },
    }], server: { host: '127.0.0.1', port: 0, watch: null },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.UNIDER_TEST_BROWSER ? { executablePath: process.env.UNIDER_TEST_BROWSER } : {}) });
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const external = [];
    await context.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const NativeDate = Date;
      window.fixtureNow = NativeDate.parse(sessionStorage.getItem('fixture-now') || '2026-10-05T21:30:00Z');
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [window.fixtureNow])); }
        static now() { return window.fixtureNow; }
      };
    });
    await page.goto(origin + '/chat');
    const reset = async (config = {}, time = '2026-10-05T21:30:00Z') => {
      await page.evaluate(({ config, time }) => {
        sessionStorage.clear(); sessionStorage.setItem('fixture-config', JSON.stringify(config)); sessionStorage.setItem('fixture-now', time);
      }, { config, time });
      await page.goto(origin + '/chat');
      await page.waitForFunction(() => Boolean(window.stores));
    };
    const ready = () => page.waitForFunction(() => Boolean(document.querySelector('input') && !document.querySelector('input').disabled));
    const exit = () => page.getByRole('button', { name: 'Sair para o Lobby', exact: true });
    const alert = () => page.getByRole('alert').innerText();
    const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await t.test('message controls have names and fit a small screen without live clock announcements', async () => {
      await reset(); await ready(); await page.setViewportSize({ width: 320, height: 568 });
      await page.getByRole('textbox', { name: 'Mensagem', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).waitFor();
      await exit().waitFor(); await page.getByRole('button', { name: 'Denunciar', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('header .font-mono').evaluate(element => Boolean(element.closest('[aria-live], [role="status"], [role="alert"]'))), false);
      const input = await page.getByRole('textbox', { name: 'Mensagem', exact: true }).boundingBox();
      assert.ok(input.y >= 0 && input.y + input.height <= 568);
      await page.setViewportSize({ width: 390, height: 844 });
    });

    await t.test('history recovers a message sent while unsubscribed', async () => {
      await reset(); await ready();
      await page.evaluate(() => {
        const channel = window.fixture.channels.at(-1);
        channel.status('CHANNEL_ERROR');
        window.fixture.history = [{ id: '00000000-0000-0000-0000-000000000031', sender_id: 'bob',
          text: 'Mensagem durante a interrupção', timestamp: '2026-10-05T21:30:01.000Z' }];
        // The peer's server send reached the buffer, but no broadcast callback
        // ran on this disconnected receiver. Rejoin alone must recover it.
        channel.status('SUBSCRIBED');
      }); await flush();
      await page.getByText('Mensagem durante a interrupção', { exact: true }).waitFor();
    });

    await t.test('same UUID from two senders renders both messages and each retry only once', async () => {
      await reset(); await ready();
      await page.evaluate(() => {
        const shared = { id: '00000000-0000-0000-0000-000000000099', timestamp: '2026-10-05T21:30:01.000Z' };
        const first = { ...shared, sender_id: 'alice', text: 'Texto da Alice' };
        const second = { ...shared, sender_id: 'bob', text: 'Texto do Bob' };
        const channel = window.fixture.channels.at(-1);
        [first, second, first, second].forEach(payload => channel.receive({ payload }));
        window.fixture.history = [first, second];
        channel.status('CHANNEL_ERROR'); channel.status('SUBSCRIBED');
      });
      await page.getByText('Texto da Alice', { exact: true }).waitFor();
      await page.getByText('Texto do Bob', { exact: true }).waitFor();
      assert.equal(await page.getByText('Texto da Alice', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Texto do Bob', { exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => window.stores.chat.getState().messages.length), 3);
    });

    await t.test('pending snapshot merges interleaved broadcasts once and retains existing messages', async () => {
      await reset({ historyMode: 'pending' }); await ready();
      await page.waitForFunction(() => window.fixture.pending.some(p => p.type === 'get-room-messages'));
      const before = await page.evaluate(() => window.fixture.calls.filter(c => c.name === 'get-room-messages').length);
      await page.evaluate(() => {
        const message = n => ({ id: '00000000-0000-0000-0000-' + String(n).padStart(12, '0'), sender_id: 'bob',
          text: 'Histórico ' + n, timestamp: '2026-10-05T21:30:0' + n + '.000Z' });
        const channel = window.fixture.channels.at(-1);
        channel.receive({ payload: message(4) }); channel.receive({ payload: message(3) });
        channel.status('SUBSCRIBED'); channel.status('SUBSCRIBED');
        window.fixture.history = [message(2), message(3)];
        window.fixture.pending.filter(p => p.type === 'get-room-messages').forEach(p => p.finish());
      }); await page.getByText('Histórico 2', { exact: true }).waitFor();
      assert.equal(await page.getByText('Histórico 3', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Mensagem guardada', { exact: true }).count(), 1);
      assert.deepEqual(await page.evaluate(() => window.stores.chat.getState().messages.map(m => m.text)),
        ['Mensagem guardada', 'Histórico 2', 'Histórico 3', 'Histórico 4']);
      assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.name === 'get-room-messages').length), before);
      await page.getByText(/Algumas mensagens anteriores podem já ter expirado/).waitFor();
    });

    await t.test('history failure has explicit retry; a pending history read does not block exit or report', async () => {
      await reset({ historyMode: 'error503' }); await ready();
      await page.getByRole('alert').filter({ hasText: 'Não foi possível recuperar' }).waitFor();
      const before = await page.evaluate(() => window.fixture.calls.filter(c => c.name === 'get-room-messages').length);
      await page.evaluate(() => { window.fixture.historyMode = 'success'; window.fixture.channels.at(-1).status('SUBSCRIBED'); });
      await flush();
      assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.name === 'get-room-messages').length), before);
      await page.getByRole('button', { name: 'Tentar recuperar mensagens' }).click();
      await page.getByText(/Algumas mensagens anteriores podem já ter expirado/).waitFor();
      assert.equal(await page.evaluate(() => window.stores.chat.getState().messages.length), 1);
      assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.name === 'get-room-messages').length), before + 1);
      await reset({ historyMode: 'error403' }, '2026-10-05T21:32:00Z');
      await page.getByRole('alert').filter({ hasText: 'O servidor recusou o histórico' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Tentar recuperar mensagens' }).isDisabled(), true);
      assert.equal(await exit().isEnabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Denunciar', exact: true }).isEnabled(), true);
      for (const action of ['exit', 'report']) {
        await reset({ historyMode: 'pending', reportMode: 'success' }); await ready();
        assert.equal(await exit().isEnabled(), true);
        assert.equal(await page.getByRole('button', { name: 'Denunciar', exact: true }).isEnabled(), true);
        await (action === 'exit' ? exit() : page.getByRole('button', { name: 'Denunciar', exact: true })).click();
        await page.waitForURL('**/lobby');
        await page.evaluate(() => window.fixture.pending.filter(p => p.type === 'get-room-messages').forEach(p => p.finish()));
        await flush(); assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), null);
      }
    });

    await t.test('late history cannot merge or display errors after room/user/same-ID context replacement', async () => {
      for (const change of ['room', 'user', 'same-ID']) for (const failure of [false, true]) {
        await reset({ historyMode: 'pending' }); await ready();
        await page.waitForFunction(() => window.fixture.pending.some(p => p.type === 'get-room-messages'));
        await page.evaluate(({ change, failure }) => {
          const old = window.fixture.pending.filter(p => p.type === 'get-room-messages');
          window.fixture.historyMode = 'success';
          if (change === 'room') window.stores.chat.getState().setRoom('room-b', 'carol');
          else if (change === 'user') {
            window.stores.chat.getState().setOwner('carol'); window.stores.chat.getState().setRoom('room-a', 'dave');
            window.stores.auth.setState({ user: { id: 'carol' } });
          } else { window.stores.chat.getState().resetChat(); window.stores.chat.getState().setRoom('room-a', 'bob'); }
          window.stores.chat.getState().addMessage({ id: 'replacement', sender_id: 'bob', text: 'Contexto substituído', timestamp: new Date().toISOString() });
          old.forEach(p => p.finish(failure, { data: { success: true, roomId: 'room-a', partial: true, messages: [
            { id: '00000000-0000-0000-0000-000000000032', sender_id: 'bob', text: 'Histórico antigo', timestamp: new Date().toISOString() }
          ] }, error: null }));
        }, { change, failure }); await flush();
        assert.equal(await page.getByText('Histórico antigo', { exact: true }).count(), 0);
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.equal(await page.evaluate(() => window.stores.chat.getState().messages.length), 1);
        assert.equal(new URL(page.url()).pathname, '/chat');
      }
    });

    await t.test('loading and waiting always allow confirmed room/queue exit', async () => {
      await reset({ roomMode: 'pending' });
      await page.reload(); // Persisted room with no confirmed state.
      await exit().click(); await page.waitForURL('**/lobby');
      assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), null);
      assert.ok(await page.evaluate(() => window.fixture.calls.some(call => call.name === 'leave_room' && call.args.p_room === 'room-a')));
      await reset({ queue: true, matchMode: 'pending' });
      await page.getByRole('button', { name: 'Voltar ao Lobby', exact: true }).click(); await page.waitForURL('**/lobby');
      assert.ok(await page.evaluate(() => window.fixture.calls.some(call => call.name === 'leave_matchmaking')));
      assert.equal(await page.evaluate(() => window.stores.chat.getState().isQueueing), false);
      await page.evaluate(() => window.fixture.pending.forEach(call => call.finish())); await flush();
      assert.equal(new URL(page.url()).pathname, '/lobby');
    });

    await t.test('denied, malformed and offline rooms keep context until explicit local recovery', async () => {
      for (const mode of ['denied', 'malformed', 'unknown', 'offline']) {
        await reset({ roomMode: mode, leaveMode: mode === 'denied' ? 'denied' : 'offline' });
        await page.getByRole('alert').waitFor();
        assert.equal(await page.getByRole('textbox').isDisabled(), true);
        await exit().click(); await page.getByRole('alert').filter({ hasText: /[Ss]aída/ }).waitFor();
        assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), 'room-a');
        assert.equal(await page.evaluate(() => window.stores.chat.getState().messages.length), 1);
        await page.getByRole('button', { name: 'Voltar ao lobby sem confirmar fecho' }).click(); await page.waitForURL('**/lobby');
        assert.equal(await page.evaluate(() => window.stores.chat.getState().isQueueing), false);
        assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), null);
      }
      await reset({ roomMode: 'transient' }); await page.getByRole('alert').waitFor();
      await page.evaluate(() => { window.fixture.roomMode = 'active'; });
      await page.getByRole('button', { name: 'Tentar confirmar a conversa' }).click(); await ready();
      assert.equal(await page.evaluate(() => window.stores.chat.getState().messages.length), 1);
    });

    await t.test('message retry retains UUID and report failures do not claim suspension or clear room', async () => {
      await reset({ sendMode: 'offline' }); await ready();
      await page.getByRole('textbox').fill('Envio com retry');
      await page.getByRole('button', { name: 'Enviar mensagem' }).click(); await page.getByRole('alert').waitFor();
      await page.evaluate(() => { window.fixture.sendMode = 'success'; });
      await page.getByRole('button', { name: 'Enviar mensagem' }).click();
      await page.getByText('Envio com retry', { exact: true }).waitFor();
      const ids = await page.evaluate(() => window.fixture.calls.filter(call => call.name === 'send-message').map(call => call.body.message.id));
      assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
      for (const status of [401, 403, 409, 503]) {
        await page.evaluate(status => { window.fixture.reportMode = 'error' + status; }, status);
        await page.getByRole('button', { name: /Denunciar|Tentar denúncia novamente/ }).click();
        await page.getByRole('alert').filter({ hasText: 'Denúncia não confirmada' }).waitFor();
        assert.ok(!(await alert()).includes('A conversa foi suspensa'));
        assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), 'room-a');
        assert.equal(await page.evaluate(() => window.stores.chat.getState().messages.length), 2);
      }
      if (process.env.UNIDER_TEST_CHAT_SCREENSHOT) await page.screenshot({ path: process.env.UNIDER_TEST_CHAT_SCREENSHOT, fullPage: true });
      await page.evaluate(() => { window.fixture.reportMode = 'success'; });
      await page.getByRole('button', { name: 'Tentar denúncia novamente' }).click(); await page.waitForURL('**/lobby');
      assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), null);
    });

    await t.test('decision, closed phase, votes and the new-pair cutoff retain server deadlines', async () => {
      await reset({}, '2026-10-05T21:32:00Z');
      await page.getByRole('button', { name: 'Continuar (+3 min)' }).click();
      await page.getByRole('button', { name: 'A aguardar colega...' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'A aguardar colega...' }).isDisabled(), true);
      await exit().click(); await page.waitForURL('**/lobby');
      await reset({}, '2026-10-05T21:33:00Z');
      await page.getByRole('button', { name: 'Novo Chat' }).click();
      await page.getByText('A aguardar pelo próximo colega...', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.stores.chat.getState().isQueueing), true);
      await reset({}, '2026-10-05T21:48:00Z');
      await page.getByRole('button', { name: 'Novo Chat' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Novo Chat' }).isDisabled(), true);
      await exit().click(); await page.waitForURL('**/lobby');
      assert.equal(await page.evaluate(() => window.stores.chat.getState().isQueueing), false);
      await reset({ leaveMode: 'pending' }, '2026-10-05T21:47:59Z');
      await page.getByRole('button', { name: 'Novo Chat' }).click();
      await page.waitForFunction(() => window.fixture.pending.length > 0);
      await page.evaluate(() => {
        window.fixtureNow = Date.parse('2026-10-05T21:48:00Z');
        window.fixture.pending.splice(0).forEach(call => call.finish());
      }); await page.waitForURL('**/lobby');
      assert.equal(await page.evaluate(() => window.stores.chat.getState().isQueueing), false);
    });

    await t.test('late send/report/leave/extend and old broadcasts cannot alter a replacement context', async () => {
      for (const operation of ['send-message', 'report-room', 'leave_room', 'extend_room']) {
        const config = { [operation === 'send-message' ? 'sendMode' : operation === 'report-room' ? 'reportMode' : operation === 'leave_room' ? 'leaveMode' : 'extendMode']: 'pending' };
        await reset(config, operation === 'extend_room' ? '2026-10-05T21:32:00Z' : '2026-10-05T21:30:00Z');
        if (operation === 'send-message') { await ready(); await page.getByRole('textbox').fill('Mensagem antiga'); await page.getByRole('button', { name: 'Enviar mensagem' }).click(); }
        else if (operation === 'report-room') await page.getByRole('button', { name: 'Denunciar', exact: true }).click();
        else if (operation === 'leave_room') await exit().click();
        else await page.getByRole('button', { name: 'Continuar (+3 min)' }).click();
        await page.waitForFunction(name => window.fixture.pending.some(call => call.type === name), operation);
        await page.evaluate(() => {
          window.fixture.oldChannels = window.fixture.channels.slice();
          window.stores.chat.getState().setRoom('room-b', 'carol');
          window.stores.chat.getState().addMessage({ id: 'new', sender_id: 'alice', text: 'Novo contexto', timestamp: new Date().toISOString() });
          window.fixture.pending.splice(0).forEach(call => call.finish());
          window.fixture.oldChannels.forEach(channel => channel.receive({ payload: { id: 'old', sender_id: 'bob', text: 'Broadcast antigo', timestamp: new Date().toISOString() } }));
        }); await flush();
        assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), 'room-b');
        assert.equal(await page.evaluate(() => window.stores.chat.getState().messages.length), 1);
        assert.equal(new URL(page.url()).pathname, '/chat');
      }
      await reset({ sendMode: 'pending' }); await ready();
      await page.getByRole('textbox').fill('Envio do proprietário antigo'); await page.getByRole('button', { name: 'Enviar mensagem' }).click();
      await page.waitForFunction(() => window.fixture.pending.length > 0);
      await page.evaluate(() => {
        window.stores.chat.getState().setOwner('carol'); window.stores.chat.getState().setRoom('room-a', 'dave');
        window.stores.auth.setState({ user: { id: 'carol' } }); window.fixture.pending.splice(0).forEach(call => call.finish());
      }); await flush();
      assert.equal(await page.evaluate(() => window.stores.chat.getState().ownerId), 'carol');
      assert.equal(await page.evaluate(() => window.stores.chat.getState().messages.length), 0);
      assert.equal(await page.getByRole('textbox').inputValue(), '');
    });

    await t.test('late polling cannot replace a newer room or revive a cancelled queue', async () => {
      await reset({ roomMode: 'pending' }); await page.waitForFunction(() => window.fixture.pending.length > 0);
      await page.evaluate(() => {
        window.fixture.roomMode = 'active'; window.stores.chat.getState().setRoom('room-b', 'carol');
        window.fixture.pending.splice(0).forEach(call => call.finish());
      }); await ready();
      assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), 'room-b');
      await reset({ queue: true, matchMode: 'pending' }); await page.waitForFunction(() => window.fixture.pending.length > 0);
      await page.getByRole('button', { name: 'Voltar ao lobby sem confirmar fecho' }).click(); await page.waitForURL('**/lobby');
      await page.evaluate(() => window.fixture.pending.splice(0).forEach(call => call.finish())); await flush();
      assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), null);
      assert.equal(await page.evaluate(() => window.stores.chat.getState().isQueueing), false);
      assert.equal(new URL(page.url()).pathname, '/lobby');
    });

    await t.test('confirmed queue cancellation wins in both response orders and cancels the original intent', async () => {
      for (const order of ['match-first', 'cancel-first']) {
        await reset({ queue: true, matchMode: 'pending', leaveMode: 'pending' });
        await page.waitForFunction(() => window.fixture.pending.some(p => p.type === 'find_or_join_match'));
        const intent = await page.evaluate(() => window.stores.chat.getState().queueIntent);
        await page.getByRole('button', { name: 'Voltar ao Lobby', exact: true }).click();
        await page.waitForFunction(() => window.fixture.pending.some(p => p.type === 'leave_matchmaking'));
        assert.equal(await page.evaluate(() => window.stores.chat.getState().queueCancelling), true);
        const finishMatch = () => page.evaluate(() => window.fixture.pending.filter(p => p.type === 'find_or_join_match').forEach(p => p.finish(false,
          { data: { ...window.fixture.serverRoom, server_now: new Date().toISOString() }, error: null, status: 200 })));
        const finishCancel = () => page.evaluate(() => window.fixture.pending.filter(p => p.type === 'leave_matchmaking').forEach(p => p.finish()));
        if (order === 'match-first') { await finishMatch(); await flush(); assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), null); await finishCancel(); }
        else { await finishCancel(); await page.waitForURL('**/lobby'); await finishMatch(); }
        await page.waitForURL('**/lobby'); await flush();
        assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), null);
        assert.equal(await page.evaluate(() => window.stores.chat.getState().queueIntent), null);
        const args = await page.evaluate(() => window.fixture.calls.find(call => call.name === 'leave_matchmaking').args);
        assert.deepEqual(args, { p_intent: intent.id, p_day: intent.day });
      }
      await reset({ queue: true, matchMode: 'matched' }); await ready();
      const intent = await page.evaluate(() => window.stores.chat.getState().queueIntent);
      await exit().click(); await page.waitForURL('**/lobby');
      assert.deepEqual(await page.evaluate(() => window.fixture.calls.find(call => call.name === 'leave_matchmaking').args), { p_intent: intent.id, p_day: intent.day });
      assert.ok(await page.evaluate(() => window.fixture.calls.some(call => call.name === 'leave_room')));
    });

    await t.test('pending operation permits local exit and same-ID replacement invalidates old completion', async () => {
      await reset({ reportMode: 'pending' });
      await page.getByRole('button', { name: 'Denunciar', exact: true }).click();
      await page.waitForFunction(() => window.fixture.pending.length > 0);
      await page.getByRole('button', { name: 'Voltar ao lobby sem confirmar fecho' }).click(); await page.waitForURL('**/lobby');
      await page.evaluate(() => window.fixture.pending.splice(0).forEach(call => call.finish())); await flush();
      assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), null);
      assert.equal(await page.evaluate(() => window.stores.chat.getState().isQueueing), false);
      await reset({ reportMode: 'pending' });
      await page.getByRole('button', { name: 'Denunciar', exact: true }).click();
      await page.waitForFunction(() => window.fixture.pending.length > 0);
      await page.evaluate(() => {
        window.stores.chat.getState().resetChat(); window.stores.chat.getState().setRoom('room-a', 'bob');
        window.stores.chat.getState().addMessage({ id: 'replacement', sender_id: 'bob', text: 'Nova instância', timestamp: new Date().toISOString() });
        window.fixture.pending.splice(0).forEach(call => call.finish());
      }); await flush();
      assert.equal(await page.evaluate(() => window.stores.chat.getState().roomId), 'room-a');
      assert.equal(await page.evaluate(() => window.stores.chat.getState().messages[0].id), 'replacement');
      assert.equal(new URL(page.url()).pathname, '/chat');
    });

    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    t.diagnostic(`Chromium ${browser.version()}, 390x844, real Chat/Lobby/hooks/stores; isolated service fixture; zero external requests.`);
  } finally {
    if (browser) await browser.close(); await server.close();
  }
});
