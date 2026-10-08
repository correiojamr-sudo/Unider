import type { ChatMessage } from '../store/chatStore';
import { classifyChatError } from './chatRecovery.ts';

// Redis deduplicates within a sender, so two participants may use the same UUID.
export const chatMessageKey = (message: Pick<ChatMessage, 'sender_id' | 'id'>) => `${message.sender_id}:${message.id.toLowerCase()}`;

export function validHistoryMessage(value: unknown, userId: string, peerId: string): value is ChatMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  return typeof m.id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(m.id)
    && [userId, peerId].includes(m.sender_id as string) && typeof m.text === 'string'
    && Boolean(m.text.trim()) && m.text.length <= 2000 && typeof m.timestamp === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.timestamp) && Number.isFinite(Date.parse(m.timestamp))
    && new Date(m.timestamp).toISOString() === m.timestamp;
}

export function readHistorySnapshot(value: unknown, roomId: string, userId: string, peerId: string): ChatMessage[] {
  const data = value as { success?: unknown; roomId?: unknown; partial?: unknown; messages?: unknown } | null;
  if (data?.success !== true || data.roomId !== roomId || data.partial !== true
    || !Array.isArray(data.messages) || data.messages.length > 200) throw new Error('Unconfirmed history');
  const seen = new Map<string, string>();
  return data.messages.map(value => {
    if (!validHistoryMessage(value, userId, peerId)) throw new Error('Invalid history');
    const message = { id: value.id.toLowerCase(), sender_id: value.sender_id, text: value.text, timestamp: value.timestamp };
    const serialized = JSON.stringify(message);
    const key = chatMessageKey(message);
    if (seen.has(key) && seen.get(key) !== serialized) throw new Error('Conflicting history');
    seen.set(key, serialized);
    return message;
  });
}

// Preserve known messages when a snapshot overlaps a broadcast or a send reply.
// Timestamp then ID gives deterministic order even when replies arrive backwards.
export function mergeChatMessages(known: ChatMessage[], incoming: ChatMessage[]) {
  const messages = new Map(known.map(message => [chatMessageKey(message), message]));
  for (const message of incoming) if (!messages.has(chatMessageKey(message))) messages.set(chatMessageKey(message), message);
  return [...messages.values()].sort((a, b) => {
    const time = (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0);
    const aKey = chatMessageKey(a), bKey = chatMessageKey(b);
    return time || (aKey < bKey ? -1 : aKey > bKey ? 1 : 0);
  });
}

export interface HistoryState { status: 'idle' | 'loading' | 'partial' | 'error' | 'unavailable'; text: string }

export function createChatHistoryRecovery(options: {
  roomId: string; userId: string; peerId: string;
  current: () => boolean;
  request: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;
  merge: (messages: ChatMessage[]) => void;
  state: (state: HistoryState) => void;
}) {
  let active = true, subscribed = false, busy = false, generation = 0;
  let controller = new AbortController();
  const cancel = () => { generation++; busy = false; controller.abort(); };
  const recover = async () => {
    if (!active || !subscribed || busy || !options.current()) return;
    busy = true;
    const operation = ++generation;
    controller = new AbortController();
    const current = () => active && subscribed && operation === generation && options.current();
    options.state({ status: 'loading', text: 'A recuperar mensagens disponíveis...' });
    try {
      const result = await options.request(controller.signal);
      if (!current()) return;
      if (result.error) throw result.error;
      const messages = readHistorySnapshot(result.data, options.roomId, options.userId, options.peerId);
      options.merge(messages);
      options.state({ status: 'partial', text: 'Mostram-se as mensagens ainda disponíveis. Algumas mensagens anteriores podem já ter expirado.' });
    } catch (error) {
      if (!current()) return;
      const issue = classifyChatError(error);
      options.state({ status: issue.kind === 'denied' ? 'unavailable' : 'error', text: issue.kind === 'denied'
        ? 'O servidor recusou o histórico. Só é recuperável numa sala ativa e autorizada; as mensagens conhecidas foram mantidas.'
        : 'Não foi possível recuperar mensagens anteriores. As mensagens conhecidas foram mantidas; podes tentar novamente.' });
    } finally { if (current()) busy = false; }
  };
  return {
    retry: recover,
    status: (connected: boolean) => {
      if (!active || !options.current() || connected === subscribed) return;
      subscribed = connected;
      if (connected) return recover();
      cancel(); options.state({ status: 'idle', text: '' });
    },
    stop: () => { active = false; subscribed = false; cancel(); },
  };
}
