const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { load } = require('./load-ts.cjs');
const legal = load('src/lib/legal.ts');

test('legal identity, privacy contact and acceptance version are consistent', () => {
  assert.equal(legal.TERMS_VERSION, '2.0');
  assert.equal(legal.PRIVACY_EMAIL, 'aquecimentoapp@gmail.com');
  assert.equal(legal.CONTROLLER_NAME, 'João António Pires Martins dos Santos Rodrigues');
  const terms = legal.termsSections.map(section => section.text).join(' ');
  const privacy = legal.privacySections.map(section => section.text).join(' ');
  assert.match(terms, /18 ou mais anos/);
  assert.match(terms, /não a idade/);
  assert.match(privacy, /não é encriptação ponta a ponta/);
  assert.match(privacy, /buffer inteiro/);
  assert.match(privacy, /CNPD/);
  assert.match(privacy, /Sugestões podem permanecer/);
  assert.ok(terms.includes(legal.CONTROLLER_NAME) && privacy.includes(legal.PRIVACY_EMAIL));
  const sql = readFileSync('supabase/migrations/20261010145007_adult_terms_v2.sql', 'utf8');
  assert.ok(sql.includes(`terms_version = '${legal.TERMS_VERSION}'`));
  assert.match(sql, /adult_declared_at IS NOT NULL/);
  assert.match(sql, /p_adult IS DISTINCT FROM true/);
});

test('legal documents are available outside protected routes', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /path="\/termos" element=\{<Legal \/>\}/);
  assert.match(app, /path="\/privacidade" element=\{<Legal privacy \/>\}/);
  const modal = readFileSync('src/components/modals/TermsModal.tsx', 'utf8');
  assert.match(modal, /p_version: TERMS_VERSION, p_adult: true/);
  assert.match(modal, /disabled=\{loading \|\| !user \|\| !adultAccepted\}/);
  assert.match(readFileSync('src/pages/Legal.tsx', 'utf8'), /<LegalText privacy=\{privacy\}/);
  assert.match(modal, /<LegalText \/>/);
});
