import { create } from 'zustand';
import { formatInTimeZone } from 'date-fns-tz';

export type AppMode = 'DAYTIME' | 'QUEUE' | 'ACTIVE';

interface AppState {
  currentMode: AppMode;
  currentTime: Date;
  setMode: (mode: AppMode) => void;
  updateTime: () => void;
}

const TIMEZONE = 'Europe/Lisbon';

export const getModeFromTime = (date: Date): AppMode => {
  const timeStr = formatInTimeZone(date, TIMEZONE, 'HH:mm:ss');

  if (timeStr >= '22:28:00' && timeStr < '22:30:00') {
    return 'QUEUE';
  } else if (timeStr >= '22:30:00' && timeStr < '22:50:00') {
    return 'ACTIVE';
  } else {
    return 'DAYTIME';
  }
};

export const useAppStore = create<AppState>((set) => ({
  currentMode: getModeFromTime(new Date()),
  currentTime: new Date(),
  setMode: (mode) => set({ currentMode: mode }),
  updateTime: () => {
    const now = new Date();
    set({ currentTime: now, currentMode: getModeFromTime(now) });
  },
}));
