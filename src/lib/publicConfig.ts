/// <reference types="vite/client" />
export interface PublicConfig { url: string; key: string }
export class PublicConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'PublicConfigError'; }
}

// Structural validation, without network or values in diagnostics. Decoding a
// legacy JWT identifies its intended role; it cannot verify project/signature.
export function readPublicConfig(env: Record<string, unknown>): PublicConfig {
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
  if (typeof url !== 'string' || !url.trim() || typeof key !== 'string' || !key.trim()) {
    throw new PublicConfigError('Configuração pública em falta: define VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY e reinicia a aplicação.');
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new PublicConfigError('VITE_SUPABASE_URL deve ser um endereço HTTPS válido.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (url !== url.trim() || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash
    || parsed.pathname !== '/' || (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:'))) {
    throw new PublicConfigError('VITE_SUPABASE_URL deve ser um endereço HTTPS válido (HTTP apenas em loopback).');
  }
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key);
  if (!publicKey && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      publicKey = payload?.role === 'anon';
    } catch { /* Fail closed. */ }
  }
  if (!publicKey) throw new PublicConfigError('VITE_SUPABASE_ANON_KEY deve ser uma chave pública publishable ou anon; chaves secretas são recusadas.');
  return Object.freeze({ url: parsed.origin, key });
}

let clientConfig: PublicConfig | undefined;
export function getPublicConfig(): PublicConfig {
  return clientConfig ??= readPublicConfig({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  });
}
