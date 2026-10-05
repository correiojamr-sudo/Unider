export interface ChatIssue {
  kind: 'denied' | 'transient' | 'unknown';
  code: string | null;
  status: number | null;
}

export function classifyChatError(error: unknown, responseStatus?: number): ChatIssue {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const context = value.context && typeof value.context === 'object' ? value.context as Record<string, unknown> : {};
  const code = typeof value.code === 'string' ? value.code : null;
  const status = typeof value.status === 'number' ? value.status
    : typeof context.status === 'number' ? context.status : responseStatus && responseStatus > 0 ? responseStatus : null;
  if (code === '42501' || ['PGRST301', 'PGRST302', 'PGRST303'].includes(code ?? '')
    || [401, 403, 404, 410].includes(status ?? 0)) return { kind: 'denied', code, status };
  if ((status !== null && (status >= 500 || [408, 409, 429].includes(status)))
    || code?.startsWith('08') || ['40001', '40P01', '57014'].includes(code ?? '')
    || ['FunctionsFetchError', 'FunctionsRelayError', 'AbortError', 'TimeoutError', 'TypeError'].includes(String(value.name))) {
    return { kind: 'transient', code, status };
  }
  return { kind: 'unknown', code, status };
}

export function sessionIssueText(issue: ChatIssue): string {
  return issue.kind === 'denied'
    ? 'O servidor recusou o acesso à conversa ou à conta. Podes voltar ao lobby; o fecho da sala não está confirmado.'
    : 'Não foi possível confirmar a conversa. Podes tentar novamente ou voltar ao lobby.';
}

export function reportIssueText(issue: ChatIssue): string {
  if (issue.status === 401 || issue.status === 403) return 'Denúncia não confirmada: o servidor recusou o pedido. Não foi possível confirmar se a conversa foi suspensa.';
  if (issue.status === 409) return 'Denúncia não confirmada: a sala está ocupada. Tenta novamente; não foi confirmado o seu fecho.';
  return 'Denúncia não confirmada. A sala foi mantida para tentares novamente; não foi possível confirmar se a conversa foi suspensa.';
}

export interface ChatContext { ownerId: string | null; roomId: string | null; contextVersion: number }
export function sameChatContext(expected: ChatContext, current: ChatContext, userId: string | undefined) {
  return Boolean(userId && expected.ownerId === userId && current.ownerId === expected.ownerId
    && current.roomId === expected.roomId && current.contextVersion === expected.contextVersion);
}
