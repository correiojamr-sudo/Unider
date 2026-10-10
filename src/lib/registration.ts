export const MIN_PASSWORD_LENGTH = 12;
export const GENDERS = ['male', 'female', 'undisclosed'] as const;
export type Gender = typeof GENDERS[number];

export function validNewPassword(password: string) {
  // Never trim or silently truncate a password.
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= 128;
}

export function validAdultBirthDate(value: string, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1900-01-01') return false;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(today);
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value);
  const cutoff = `${get('year') - 18}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`;
  return value <= cutoff;
}

export function validRegistrationName(value: string) {
  const name = value.trim();
  return name.length >= 1 && name.length <= 80 &&
    !Array.from(name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
