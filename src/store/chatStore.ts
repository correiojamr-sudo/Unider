import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  sender_id: string;
  text: string;
  timestamp: string;
}

interface ChatState {
  roomId: string | null;
  peerId: string | null;
  messages: ChatMessage[];
  pastPartners: string[];
  extended: boolean;
  peerExtended: boolean;
  isQueueing: boolean;
  setQueueing: (val: boolean) => void;
  setRoom: (roomId: string | null, peerId: string | null) => void;
  addMessage: (msg: ChatMessage) => void;
  addPastPartner: (partnerId: string) => void;
  setExtended: (val: boolean) => void;
  setPeerExtended: (val: boolean) => void;
  resetChat: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      roomId: null,
      peerId: null,
      messages: [],
      pastPartners: [],
      extended: false,
      peerExtended: false,
      isQueueing: false,
      setQueueing: (val) => set({ isQueueing: val }),
      setRoom: (roomId, peerId) => set({ roomId, peerId, isQueueing: false }),
      addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
      addPastPartner: (partnerId) => set((state) => ({ pastPartners: [...state.pastPartners, partnerId] })),
      setExtended: (val) => set({ extended: val }),
      setPeerExtended: (val) => set({ peerExtended: val }),
      resetChat: () => set({
        roomId: null,
        peerId: null,
        messages: [],
        extended: false,
        peerExtended: false,
        isQueueing: false
      }),
    }),
    {
      name: 'campus-chat-storage',
      storage: createJSONStorage(() => sessionStorage), // Keeps context through refresh but not closing tab
    }
  )
);
