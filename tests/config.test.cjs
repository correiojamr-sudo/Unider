const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsFixture = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/publicConfig.ts', 'utf8').replaceAll('import.meta.env', '({})'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsFixture, URL, atob });
const { readPublicConfig } = exportsFixture;
const key = 'sb_publishable_config_fixture_only';
const jwt = role => [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ role })).toString('base64url'), 'fixture_signature'].join('.');
const valid = { VITE_SUPABASE_URL: 'https://unider-build.invalid', VITE_SUPABASE_ANON_KEY: key };

test('public config accepts publishable/legacy anon and explicit local development URLs', () => {
  for (const value of [key, jwt('anon')]) assert.equal(readPublicConfig({ ...valid, VITE_SUPABASE_ANON_KEY: value }).key, value);
  assert.equal(readPublicConfig({ ...valid, VITE_SUPABASE_URL: 'http://localhost:54321/' }).url, 'http://localhost:54321');
});
test('missing, malformed, privileged and ambiguous config fails without leaking values', () => {
  const cases = [{}, { ...valid, VITE_SUPABASE_URL: '' }, { ...valid, VITE_SUPABASE_ANON_KEY: '' },
    ...['not-a-url', 'http://remote.invalid', 'https://name:password@remote.invalid', 'https://remote.invalid/path', 'https://remote.invalid?token=private'].map(url => ({ ...valid, VITE_SUPABASE_URL: url })),
    ...['sb_secret_fixture_do_not_print', jwt('service_role'), jwt('authenticated'), 'public-anon-key', 'sb_publishable_short', 'bad.jwt.signature'].map(value => ({ ...valid, VITE_SUPABASE_ANON_KEY: value }))];
  for (const env of cases) assert.throws(() => readPublicConfig(env), error => {
    assert.equal(error.name, 'PublicConfigError');
    for (const value of Object.values(env)) if (value) assert.ok(!error.message.includes(value));
    return true;
  });
});
test('actual Vite build preflight rejects invalid config even with CI=true; accepts synthetic public config', async () => {
  const { resolveConfig, build } = await import('vite');
  const saved = { url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY, ci: process.env.CI, marker: process.env.VITE_UNIDER_UNUSED_MARKER };
  try {
    process.env.CI = 'true';
    for (const invalid of ['', 'sb_secret_fixture_do_not_print', jwt('service_role'), 'public-anon-key']) {
      process.env.VITE_SUPABASE_URL = valid.VITE_SUPABASE_URL; process.env.VITE_SUPABASE_ANON_KEY = invalid;
      await assert.rejects(resolveConfig({ logLevel: 'silent' }, 'build'), error => {
        if (invalid) assert.ok(!error.message.includes(invalid)); return /Configuração|VITE_SUPABASE/.test(error.message);
      });
    }
    process.env.VITE_SUPABASE_ANON_KEY = key;
    process.env.VITE_SUPABASE_URL = 'not-a-url';
    await assert.rejects(resolveConfig({ logLevel: 'silent' }, 'build'), /VITE_SUPABASE_URL/);
    process.env.VITE_SUPABASE_URL = valid.VITE_SUPABASE_URL;
    const config = await resolveConfig({ logLevel: 'silent' }, 'build');
    assert.equal(config.build.outDir, 'dist');
    const marker = 'UNIDER_SYNTHETIC_UNUSED_ENV_MUST_NOT_SHIP';
    process.env.VITE_UNIDER_UNUSED_MARKER = marker;
    const bundle = await build({ logLevel: 'silent', build: { write: false } });
    const emitted = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => result.output ?? []);
    assert.ok(emitted.some(item => item.type === 'chunk' && item.code.includes(key)), 'The public fixture is explicitly included');
    assert.equal(emitted.some(item => item.type === 'chunk' && item.code.includes(marker)), false, 'Unused VITE variables must not ship');
  } finally {
    for (const [name, value] of [['VITE_SUPABASE_URL', saved.url], ['VITE_SUPABASE_ANON_KEY', saved.key], ['CI', saved.ci], ['VITE_UNIDER_UNUSED_MARKER', saved.marker]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
