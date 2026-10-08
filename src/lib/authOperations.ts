export const AUTH_TIMEOUT_MS = 10_000;
export const OTP_COOLDOWN_MS = 60_000;

export function normalizeInstitutionalEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  // A complete address, not just a suffix. Auth and the profile trigger remain
  // authoritative; this only prevents malformed requests from the form.
  const local = email.split('@')[0];
  return email.length <= 254 && local.length <= 64 &&
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@student\.uc\.pt$/.test(email)
    ? email : null;
}

export function validEmailOtp(value: string) {
  return /^\d{6,10}$/.test(value);
}

export function authErrorMessage(error: unknown, operation: 'send' | 'verify' | 'terms' | 'delete' | 'logout') {
  const detail = error as { code?: string; status?: number; name?: string } | null;
  if (detail?.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(detail?.code ?? '')) {
    return 'Demasiados pedidos. Aguarda um minuto antes de tentar novamente.';
  }
  if (detail?.code === 'otp_expired') return 'O código é inválido ou expirou. Confirma-o ou pede outro código.';
  if (['signup_disabled', 'email_provider_disabled'].includes(detail?.code ?? '')) return 'A entrada não está disponível para este endereço. Tenta mais tarde.';
  if (detail?.code === 'email_address_invalid') return 'Confirma o teu endereço institucional completo.';
  const messages = {
    send: 'Não foi possível confirmar o pedido de email. Verifica a ligação e tenta novamente.',
    verify: 'Não foi possível validar o código. Confirma o código e a ligação e tenta novamente.',
    terms: 'Não foi possível guardar o consentimento. Tenta novamente.',
    delete: 'A eliminação da conta não foi confirmada. Verifica a ligação e tenta novamente.',
    logout: 'A saída não foi confirmada no servidor. Verifica a ligação e tenta novamente.',
  };
  return messages[operation];
}

export async function runAuthOperation<T>(options: {
  request: () => PromiseLike<T>;
  current: () => boolean;
  confirmed: (result: T) => void;
  failed: (error: unknown) => void;
  settled: () => void;
}) {
  try {
    const result = await options.request();
    if (options.current()) options.confirmed(result);
  } catch (error) {
    if (options.current()) options.failed(error);
  } finally {
    if (options.current()) options.settled();
  }
}
