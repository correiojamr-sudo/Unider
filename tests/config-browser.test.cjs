const assert = require('node:assert/strict');
const { test } = require('node:test');
test('actual dev bootstrap diagnoses invalid config before loading App or making external calls', {
  skip: !process.env.UNIDER_TEST_PLAYWRIGHT ? 'Set UNIDER_TEST_PLAYWRIGHT to an installed module.' : false, timeout: 60000,
}, async t => {
  const { chromium } = require(process.env.UNIDER_TEST_PLAYWRIGHT);
  const { createServer } = await import('vite');
  const saved = { url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.UNIDER_TEST_BROWSER ? { executablePath: process.env.UNIDER_TEST_BROWSER } : {}) });
    const fixtureJwt = Buffer.from('{"role":"service_role"}').toString('base64url');
    for (const key of ['', 'sb_secret_config_fixture_only', `eyJhbGciOiJIUzI1NiJ9.${fixtureJwt}.fixture_signature`]) {
      process.env.VITE_SUPABASE_URL = 'https://unider-bootstrap.invalid'; process.env.VITE_SUPABASE_ANON_KEY = key;
      const server = await createServer({ logLevel: 'silent', cacheDir: 'node_modules/.vite-config-fixture', server: { host: '127.0.0.1', port: 0, watch: null } });
      try {
        await server.listen();
        const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const external = [], errors = [], loaded = [];
        await context.route('**/*', route => { const url = route.request().url(); loaded.push(url);
          if (url.startsWith(origin + '/')) return route.continue(); external.push(url); return route.abort(); });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin); await page.getByRole('alert').waitFor();
        assert.match(await page.getByRole('alert').textContent(), /Configuração pública em falta/);
        if (key) {
          assert.ok(!(await page.content()).includes(key));
          const result = await server.transformRequest('/src/lib/publicConfig.ts');
          assert.ok(!result.code.includes(key), 'Rejected secrets must not be injected into served config code');
        }
        await page.getByRole('button', { name: 'Recarregar' }).click(); await page.getByRole('alert').waitFor();
        assert.equal(loaded.some(url => url.includes('/src/App.tsx') || url.includes('/src/lib/supabase.ts')), false);
        assert.deepEqual(external, []); assert.deepEqual(errors, []);
        await context.close();
      } finally { await server.close(); }
    }
    t.diagnostic('Real main.tsx and Vite dev config: missing/secret/service_role, no App/client loaded and zero external requests.');
  } finally {
    if (browser) await browser.close();
    for (const [name, value] of [['VITE_SUPABASE_URL', saved.url], ['VITE_SUPABASE_ANON_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
