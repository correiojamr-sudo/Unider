import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getLisbonDay } from '../utils/time.ts';
import { mergeChatMessages } from '../lib/chatHistory.ts';
import type { MatchIntent } from '../lib/matchIntent.ts';

export interface ChatMessage {
  id: string;
  sender_id: string;
  text: string;
  timestamp: string;
}

interface ChatState {
  contextVersion: number;
  ownerId: string | null;
  setOwner: (ownerId: string) => void;
  roomId: string | null;
  peerId: string | null;
  messages: ChatMessage[];
  pastPartners: string[];
  extended: boolean;
  peerExtended: boolean;
  isQueueing: boolean;
  queueDay: string | null;
  queueIntent: MatchIntent | null;
  queueCancelling: boolean;
  beginQueueCancellation: () => void;
  setQueueing: (val: boolean, now?: Date) => void;
  setRoom: (roomId: string | null, peerId: string | null) => void;
  addMessage: (msg: ChatMessage) => void;
  mergeMessages: (messages: ChatMessage[]) => void;
  addPastPartner: (partnerId: string) => void;
  setExtended: (val: boolean) => void;
  setPeerExtended: (val: boolean) => void;
  resetChat: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      contextVersion: 0,
      ownerId: null,
      setOwner: (ownerId) => set(state => state.ownerId === ownerId ? {} : ({
        contextVersion: state.contextVersion + 1,
        ownerId, roomId: null, peerId: null, messages: [], pastPartners: [],
        extended: false, peerExtended: false, isQueueing: false, queueDay: null, queueIntent: null, queueCancelling: false,
      })),
      roomId: null,
      peerId: null,
      messages: [],
      pastPartners: [],
      extended: false,
      peerExtended: false,
      isQueueing: false,
      queueDay: null,
      queueIntent: null,
      queueCancelling: false,
      beginQueueCancellation: () => set({ queueCancelling: true }),
      setQueueing: (val, now = new Date()) => set(state => {
        const day = val ? getLisbonDay(now) : null;
        const same = val && state.isQueueing && state.queueIntent?.day === day && !state.queueCancelling;
        return { isQueueing: val, queueDay: day, queueCancelling: false,
          queueIntent: val ? same ? state.queueIntent : { id: crypto.randomUUID(), day: day! } : null,
          contextVersion: state.contextVersion + (state.isQueueing === val && (!val || same) ? 0 : 1) };
      }),
      setRoom: (roomId, peerId) => set((state) => ({ roomId, peerId, isQueueing: false, queueDay: null,
        queueIntent: state.isQueueing || state.roomId === roomId ? state.queueIntent : null,
        queueCancelling: false,
        contextVersion: state.contextVersion + (state.roomId === roomId && state.peerId === peerId ? 0 : 1),
        messages: state.roomId === roomId ? state.messages : [], extended: false, peerExtended: false })),
      addMessage: (msg) => set((state) => ({ messages: mergeChatMessages(state.messages, [msg]) })),
      mergeMessages: (messages) => set(state => ({ messages: mergeChatMessages(state.messages, messages) })),
      addPastPartner: (partnerId) => set((state) => ({ pastPartners: [...state.pastPartners, partnerId] })),
      setExtended: (val) => set({ extended: val }),
      setPeerExtended: (val) => set({ peerExtended: val }),
      resetChat: () => set(state => ({
        contextVersion: state.contextVersion + 1,
        roomId: null,
        peerId: null,
        messages: [],
        extended: false,
        peerExtended: false,
        isQueueing: false,
        queueDay: null,
        queueIntent: null,
        queueCancelling: false,
      })),
    }),
    {
      name: 'campus-chat-storage',
      storage: createJSONStorage(() => sessionStorage), // Keeps context through refresh but not closing tab
    }
  )
);
