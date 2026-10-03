const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(file, overrides = {}) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('Invalid TypeScript');
  const module = { exports: {} };
  cache.set(file, module.exports);
  const localRequire = name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith('https://')) return { createClient: () => { throw new Error('Unexpected network client'); } };
    return name.startsWith('.') ? load(path.resolve(path.dirname(file), name), overrides) : require(name);
  };
  vm.runInNewContext(result.outputText, { module, exports: module.exports, require: localRequire,
    Request, Response, crypto: globalThis.crypto, AbortSignal, fetch, console, Date, Error, SyntaxError, TextEncoder, Uint8Array,
    Deno: { env: { get: () => undefined } } }, { filename: file });
  return module.exports;
}
module.exports = { load };
