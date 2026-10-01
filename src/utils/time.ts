import { formatInTimeZone } from 'date-fns-tz';

const TIMEZONE = 'Europe/Lisbon';

export const getLisbonTime = (): Date => {
  // Return the date adjusted to represent Lisbon time (removed due to unused import)
  return new Date();
};

export const getSecondsUntil = (targetTimeStr: string): number => {
  const now = new Date();
  // Get the current time string in Lisbon
  const currentStr = formatInTimeZone(now, TIMEZONE, 'HH:mm:ss');

  // Parse hours, minutes, seconds
  const [tHours, tMinutes, tSeconds] = targetTimeStr.split(':').map(Number);
  const [cHours, cMinutes, cSeconds] = currentStr.split(':').map(Number);

  // Convert both to seconds since start of day
  const targetSecondsOfDay = tHours * 3600 + tMinutes * 60 + (tSeconds || 0);
  const currentSecondsOfDay = cHours * 3600 + cMinutes * 60 + cSeconds;

  let diff = targetSecondsOfDay - currentSecondsOfDay;

  // If target time is earlier in the day than current time, it means it's for tomorrow
  if (diff < 0) {
    diff += 24 * 3600;
  }

  return diff;
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
