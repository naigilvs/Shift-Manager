// Pure helpers shared by the API routes.
import crypto from 'node:crypto';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#c026d3', '#4f46e5'];

export const normPhone = (p) => String(p || '').replace(/\D/g, '');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
export const newToken = () => crypto.randomBytes(32).toString('hex');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}

const pad = (n) => String(n).padStart(2, '0');
export function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const isDateTime = (s) => typeof s === 'string' && DT_RE.test(s);
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function toUTC(dt) {
  const [d, t] = dt.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, day, h, mi);
}
export const minutesBetween = (a, b) => (toUTC(b) - toUTC(a)) / 60000;
export const weekdayOf = (dt) => new Date(toUTC(dt)).getUTCDay();

export function validateShiftTimes(start, end) {
  if (!isDateTime(start) || !isDateTime(end)) return 'Start and end must be valid dates and times.';
  const mins = minutesBetween(start, end);
  if (mins <= 0) return 'The shift must end after it starts.';
  if (mins > 24 * 60) return 'A shift can be at most 24 hours long.';
  return null;
}

export function fmtShift(s) {
  const d = new Date(toUTC(s.start));
  const day = `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return `${day}, ${s.start.slice(11)}–${s.end.slice(11)}`;
}

/**
 * Returns null when the shift fits the member's general availability
 * (or they haven't set any), otherwise a human-readable explanation.
 */
export function availabilityIssue(slots, name, start, end) {
  if (!slots.length) return null;
  const startDay = start.slice(0, 10);
  const endDay = end.slice(0, 10);
  const wd = weekdayOf(start);
  const covers = (day, from, to) =>
    slots.some((s) => s.weekday === day && s.start <= from && (s.end >= to || (to === '24:00' && s.end >= '23:59')));

  const st = start.slice(11);
  const et = end.slice(11);
  let ok;
  if (startDay === endDay) ok = covers(wd, st, et);
  else ok = covers(wd, st, '24:00') && (et === '00:00' || covers((wd + 1) % 7, '00:00', et));
  if (ok) return null;

  const describe = (day) => {
    const list = slots.filter((s) => s.weekday === day).sort((a, b) => a.start.localeCompare(b.start));
    return list.length
      ? `${name}'s general availability on ${DAYS[day]}s is ${list.map((s) => `${s.start}–${s.end}`).join(', ')}.`
      : `${name} is not generally available on ${DAYS[day]}s.`;
  };
  let msg = describe(wd);
  if (startDay !== endDay) msg += ' ' + describe((wd + 1) % 7);
  return `${msg} This shift (${st}–${et}) is outside that.`;
}
