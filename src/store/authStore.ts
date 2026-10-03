import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useChatStore } from './chatStore';

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setSession: (session) => set((state) => {
    if (!session || (state.user && state.user.id !== session.user.id)) useChatStore.getState().resetChat();
    if (session) useChatStore.getState().setOwner(session.user.id);
    return { session, user: session?.user || null, isLoading: false };
  }),
  signOut: async () => {
    const room = useChatStore.getState().roomId;
    if (room) await supabase.rpc('leave_room', { p_room: room });
    await supabase.rpc('leave_matchmaking');
    await supabase.auth.signOut();
    useChatStore.getState().resetChat();
    set({ user: null, session: null });
  },
}));
