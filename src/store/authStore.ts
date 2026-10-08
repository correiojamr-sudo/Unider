import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useChatStore } from './chatStore';
import { AUTH_TIMEOUT_MS, authErrorMessage } from '../lib/authOperations';
import { withScopedAuth } from '../lib/authSession';
import { matchIntentArgs } from '../lib/matchIntent';

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  contextVersion: number;
  sessionRevision: number;
  isSigningOut: boolean;
  signOutError: string;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  applyAuthEvent: (session: Session | null) => void;
  finishStartup: () => void;
  dismissSignOutError: () => void;
  signOut: () => Promise<boolean>;
  signOutForContext: (options: { expectedContextVersion?: number; accountDeleted?: boolean }) => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  isLoading: true,
  contextVersion: 0,
  sessionRevision: 0,
  isSigningOut: false,
  signOutError: '',
  setUser: (user) => set({ user }),
  setSession: (session) => set((state) => {
    if (!session || (state.user && state.user.id !== session.user.id)) useChatStore.getState().resetChat();
    if (session) useChatStore.getState().setOwner(session.user.id);
    const changed = state.user?.id !== session?.user.id;
    return { session, user: session?.user || null, isLoading: false,
      sessionRevision: state.sessionRevision + 1,
      contextVersion: state.contextVersion + (changed ? 1 : 0),
      ...(changed ? { isSigningOut: false, ...(session ? { signOutError: '' } : {}) } : {}) };
  }),
  applyAuthEvent: session => get().setSession(session),
  finishStartup: () => set({ isLoading: false }),
  dismissSignOutError: () => set({ signOutError: '' }),
  signOut: () => get().signOutForContext({}),
  signOutForContext: async (options) => {
    const context = options?.expectedContextVersion ?? get().contextVersion;
    if (context !== get().contextVersion || get().isSigningOut) return false;
    const session = get().session;
    if (!session) return false;
    const revision = get().sessionRevision;
    const chat = useChatStore.getState();
    const current = () => get().contextVersion === context && get().sessionRevision === revision &&
      useChatStore.getState().contextVersion === chat.contextVersion;
    const controller = new AbortController();
    const unsubscribe = useAuthStore.subscribe(() => { if (!current()) controller.abort(); });
    const unsubscribeChat = useChatStore.subscribe(() => { if (!current()) controller.abort(); });
    set({ isSigningOut: true, signOutError: '' });
    let stage: 'leave' | 'logout' = 'leave';
    try {
      if (!options?.accountDeleted) {
        if (chat.queueIntent) {
          chat.beginQueueCancellation();
          const result = await supabase.rpc('leave_matchmaking', matchIntentArgs(chat.queueIntent)).abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)]));
          if (!current()) return false;
          if (result.error) throw result.error;
        }
        if (chat.roomId) {
          const result = await supabase.rpc('leave_room', { p_room: chat.roomId }).abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)]));
          if (!current()) return false;
          if (result.error) throw result.error;
        }
      }
      stage = 'logout';
      const result = await withScopedAuth(current, controller.signal, auth => auth.signOut());
      if (result.error) throw result.error;
      if (!get().session && get().contextVersion === context + 1) return true;
      if (!current()) return false;
      get().setSession(null);
      return true;
    } catch (error) {
      const ownSignedOut = !get().session && get().contextVersion === context + 1;
      if (current() || (stage === 'logout' && ownSignedOut)) {
        const message = stage === 'leave'
          ? 'A saída da conversa não foi confirmada. A sessão continua aberta; tenta novamente.'
          : authErrorMessage(error, 'logout') + (!get().session ? ' A sessão local foi removida; isto não confirma a revogação remota.' : '');
        set({ signOutError: (options?.accountDeleted ? 'A conta foi eliminada. ' : '') + message });
      }
      return false;
    } finally {
      unsubscribe(); unsubscribeChat(); controller.abort();
      if (get().contextVersion === context) set({ isSigningOut: false });
    }
  },
}));
