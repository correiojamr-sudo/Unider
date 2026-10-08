import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Europe/Lisbon';

export const getLisbonTime = (): Date => new Date();
export const getLisbonDay = (date: Date): string => formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd');
export const getLisbonClock = (date: Date): string => formatInTimeZone(date, TIMEZONE, 'HH:mm:ss');

// Use actual instants so a countdown across a Lisbon DST change is accurate.
export const getSecondsUntil = (targetTime: string, now = new Date(), nextDay = true): number => {
  const day = getLisbonDay(now);
  let target = fromZonedTime(`${day}T${targetTime}`, TIMEZONE);
  if (target.getTime() < now.getTime() && nextDay) {
    const tomorrow = new Date(`${day}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    target = fromZonedTime(`${tomorrow.toISOString().slice(0, 10)}T${targetTime}`, TIMEZONE);
  }
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1000));
};

export const formatTimeCountdown = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const isTimeAfter = (timeStr: string): boolean => {
  const currentStr = formatInTimeZone(new Date(), TIMEZONE, 'HH:mm:ss');
  return currentStr >= timeStr;
};

export const isTimeBefore = (timeStr: string): boolean => {
  const currentStr = formatInTimeZone(new Date(), TIMEZONE, 'HH:mm:ss');
  return currentStr < timeStr;
};
