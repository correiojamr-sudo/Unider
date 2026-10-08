import { create } from 'zustand';
import { getModeFromTime } from '../lib/lobbySchedule.ts';
import type { LobbyMode } from '../lib/lobbySchedule.ts';
import { confirmedClock } from '../lib/serverClock.ts';
import type { ClockSample } from '../lib/serverClock.ts';

export type AppMode = LobbyMode;
export { getModeFromTime };

interface AppState {
  currentMode: AppMode;
  currentTime: Date;
  clockSample: ClockSample | null;
  clockStatus: 'unconfirmed' | 'confirmed' | 'stale';
  clockFailed: boolean;
  clockContext: { userId?: string; revision: number };
  resetClock: (userId?: string, revision?: number) => void;
  confirmClock: (sample: ClockSample) => void;
  failClock: () => void;
  confirmedTime: (userId?: string, revision?: number) => Date | null;
  setMode: (mode: AppMode) => void;
  updateTime: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentMode: getModeFromTime(new Date()),
  currentTime: new Date(),
  clockSample: null, clockStatus: 'unconfirmed', clockFailed: false, clockContext: { revision: 0 },
  resetClock: (userId, revision = 0) => set({ clockSample: null, clockStatus: 'unconfirmed', clockFailed: false, clockContext: { userId, revision } }),
  confirmClock: (sample) => {
    const context = get().clockContext;
    if (sample.userId !== context.userId || sample.revision !== context.revision) return;
    set({ clockSample: sample, clockFailed: false }); get().updateTime();
  },
  failClock: () => { set({ clockFailed: true }); get().updateTime(); },
  confirmedTime: (userId, revision = 0) => confirmedClock(get().clockSample, userId, revision, performance.now()),
  setMode: (mode) => set({ currentMode: mode }),
  updateTime: () => {
    const { clockSample, clockContext } = get();
    const now = confirmedClock(clockSample, clockContext.userId, clockContext.revision, performance.now());
    if (now) set({ currentTime: now, currentMode: getModeFromTime(now), clockStatus: 'confirmed' });
    else set({ clockStatus: clockSample ? 'stale' : 'unconfirmed' });
  },
}));
