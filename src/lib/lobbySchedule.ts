import { getLisbonClock, getSecondsUntil } from '../utils/time.ts';

export type LobbyMode = 'DAYTIME' | 'QUEUE' | 'ACTIVE' | 'CLOSING';

export function getModeFromTime(now: Date): LobbyMode {
  const time = getLisbonClock(now);
  if (time >= '22:28:00' && time < '22:30:00') return 'QUEUE';
  if (time >= '22:30:00' && time < '22:48:00') return 'ACTIVE';
  if (time >= '22:48:00' && time < '22:50:00') return 'CLOSING';
  return 'DAYTIME';
}

export function lobbySchedule(now: Date) {
  const mode = getModeFromTime(now);
  const target = mode === 'DAYTIME' ? '22:28:00' : mode === 'QUEUE' ? '22:30:00'
    : mode === 'ACTIVE' ? '22:48:00' : '22:50:00';
  const title = mode === 'DAYTIME' ? 'A pré-fila abre às 22h28'
    : mode === 'QUEUE' ? 'As conversas começam às 22h30'
    : mode === 'ACTIVE' ? 'Novos pares até às 22h48' : 'A sessão fecha às 22h50';
  const description = mode === 'DAYTIME' ? 'As conversas decorrem das 22h30 às 22h50, em Lisboa.'
    : mode === 'QUEUE' ? 'Podes preparar a tua entrada e cancelar a espera.'
    : mode === 'ACTIVE' ? 'Tempo restante para pedir uma nova conversa.'
    : 'Já não há novos pares. As conversas existentes podem continuar até às 22h50.';
  return { mode, target, title, description, countdown: getSecondsUntil(target, now, mode === 'DAYTIME') };
}
