// API client + date helpers used across the app.

const TOKEN_KEY = 'sm.token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body || {};
  }
}

export async function api(method, path, body) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) { setToken(null); window.dispatchEvent(new Event('sm:logout')); }
    throw new ApiError(res.status, data);
  }
  return data;
}

// ---- dates (all shift times are local wall-clock strings 'YYYY-MM-DDTHH:MM') ----
const pad = (n) => String(n).padStart(2, '0');
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7)); // Monday
export const nowLocal = () => { const d = new Date(); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const todayStr = () => ymd(new Date());

export const fmtDayLong = (s) => { const d = parseDay(s); return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtDayShort = (s) => { const d = parseDay(s); return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
export const fmtMonth = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
export const timeOf = (s) => s.slice(11, 16);
export const fmtRange = (s) => `${fmtDayShort(s.start)}, ${timeOf(s.start)}–${timeOf(s.end)}${s.end.slice(0, 10) !== s.start.slice(0, 10) ? ' (+1)' : ''}`;

export function hoursBetween(a, b) {
  const t = (x) => new Date(`${x}:00`).getTime();
  return (t(b) - t(a)) / 3600000;
}
export const fmtHours = (h) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;

/** Combine a date 'YYYY-MM-DD' with start/end times; an end time earlier than the start rolls to the next day. */
export function buildRange(date, startTime, endTime) {
  const start = `${date}T${startTime}`;
  const endDate = endTime <= startTime ? ymd(addDays(parseDay(date), 1)) : date;
  return { start, end: `${endDate}T${endTime}` };
}

export function timeAgo(sqlUtc) {
  const t = new Date(sqlUtc.replace(' ', 'T') + 'Z').getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const clockOf = (sqlUtc) => {
  const d = new Date(sqlUtc.replace(' ', 'T') + 'Z');
  return `${ymd(d) === todayStr() ? '' : fmtDayShort(ymd(d)) + ' '}${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
