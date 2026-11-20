import React, { useEffect, useMemo, useState } from 'react';
import {
  api, ymd, addDays, startOfWeek, parseDay, todayStr, nowLocal, fmtMonth, timeOf, SHORT_DAYS, fmtDayLong,
} from './lib.js';
import ShiftDialog from './ShiftDialog.jsx';

const VIEW_KEY = 'sm.calView';

export default function Calendar({ ctx }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) || 'week'; } catch { return 'week'; } });
  const [anchor, setAnchor] = useState(() => new Date());
  const [shifts, setShifts] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'mine' | memberId
  const [dialog, setDialog] = useState(null); // { shift } | { newOn: 'YYYY-MM-DD' }

  const range = useMemo(() => {
    if (view === 'week') {
      const s = startOfWeek(anchor);
      return { from: s, days: 7 };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const s = startOfWeek(first);
    return { from: s, days: 42 };
  }, [view, anchor]);

  const fromStr = ymd(range.from);
  const toStr = ymd(addDays(range.from, range.days));

  useEffect(() => {
    let live = true;
    api('GET', `/groups/${ctx.gid}/shifts?from=${fromStr}T00:00&to=${toStr}T00:00`)
      .then((s) => live && setShifts(s))
      .catch(() => live && setShifts([]));
    return () => { live = false; };
  }, [ctx.gid, fromStr, toStr, ctx.version]);

  const setViewSaved = (v) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  const step = (dir) => setAnchor(view === 'week' ? addDays(anchor, 7 * dir) : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));

  const visible = (shifts || []).filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'mine') return s.memberId === ctx.me.id;
    if (filter === 'open') return s.status === 'open';
    return String(s.memberId) === String(filter);
  });
  const byDay = {};
  for (const s of visible) (byDay[s.start.slice(0, 10)] ||= []).push(s);

  const title = view === 'week'
    ? `${parseDay(fromStr).getDate()} ${SHORT_MONTH(range.from)} – ${addDays(range.from, 6).getDate()} ${SHORT_MONTH(addDays(range.from, 6))}`
    : fmtMonth(anchor);

  const pendingForMe = (shifts || []).filter((s) => s.memberId === ctx.me.id && s.status === 'pending');

  return (
    <div className="calendar">
      <div className="toolbar">
        <div className="toolbar-group">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">‹</button>
          <h2 className="toolbar-title">{title}</h2>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next">›</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(new Date())}>Today</button>
        </div>
        <div className="toolbar-group">
          <select aria-label="Filter shifts" value={filter} onChange={(e) => setFilter(e.target.value)} className="select-sm">
            <option value="all">Everyone</option>
            {!ctx.isManager && <option value="mine">Only my shifts</option>}
            <option value="open">Open shifts</option>
            {ctx.workers.filter((w) => w.id !== ctx.me.id).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <div className="segmented" role="group" aria-label="Calendar view">
            <button className={view === 'week' ? 'on' : ''} onClick={() => setViewSaved('week')}>Week</button>
            <button className={view === 'month' ? 'on' : ''} onClick={() => setViewSaved('month')}>Month</button>
          </div>
          {ctx.isManager && <button className="btn btn-primary btn-sm" onClick={() => setDialog({ newOn: todayStr() })}>＋ Shift</button>}
        </div>
      </div>

      {pendingForMe.length > 0 && (
        <div className="alert alert-warn">
          You have {pendingForMe.length} shift{pendingForMe.length > 1 ? 's' : ''} outside your usual availability waiting for your answer.{' '}
          <button className="link" onClick={() => setDialog({ shift: pendingForMe[0] })}>Review</button>
        </div>
      )}

      {!shifts ? <div className="spinner" /> : view === 'week'
        ? <WeekView from={range.from} byDay={byDay} ctx={ctx} onShift={(s) => setDialog({ shift: s })} onAdd={(d) => setDialog({ newOn: d })} />
        : <MonthView from={range.from} month={anchor.getMonth()} byDay={byDay} ctx={ctx} onShift={(s) => setDialog({ shift: s })}
            onDay={(d) => { setAnchor(parseDay(d)); setViewSaved('week'); }} />}

      <Legend ctx={ctx} />

      {dialog && (
        <ShiftDialog
          ctx={ctx}
          shift={dialog.shift}
          newOn={dialog.newOn}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); ctx.bump(); }}
        />
      )}
    </div>
  );
}

const SHORT_MONTH = (d) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];

function WeekView({ from, byDay, ctx, onShift, onAdd }) {
  const today = todayStr();
  return (
    <div className="week">
      {Array.from({ length: 7 }, (_, i) => {
        const d = ymd(addDays(from, i));
        const list = byDay[d] || [];
        const past = d < today;
        return (
          <section key={d} className={`day ${d === today ? 'today' : ''} ${past ? 'past' : ''}`} aria-label={fmtDayLong(d)}>
            <header className="day-head">
              <span className="day-name">{SHORT_DAYS[parseDay(d).getDay()]}</span>
              <span className="day-num">{parseDay(d).getDate()}</span>
              {ctx.isManager && !past && <button className="icon-btn add-btn" onClick={() => onAdd(d)} aria-label={`Add shift on ${fmtDayLong(d)}`}>＋</button>}
            </header>
            <div className="day-shifts">
              {list.length === 0 && <span className="day-empty">No shifts</span>}
              {list.map((s) => <ShiftChip key={s.id} s={s} ctx={ctx} onClick={() => onShift(s)} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MonthView({ from, month, byDay, ctx, onShift, onDay }) {
  const today = todayStr();
  return (
    <div className="month">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="month-dow">{d}</div>)}
      {Array.from({ length: 42 }, (_, i) => {
        const date = addDays(from, i);
        const d = ymd(date);
        const list = byDay[d] || [];
        return (
          <div key={d} className={`month-cell ${date.getMonth() !== month ? 'other' : ''} ${d === today ? 'today' : ''}`}>
            <button className="month-num" onClick={() => onDay(d)} aria-label={`Open week of ${fmtDayLong(d)}`}>{date.getDate()}</button>
            {list.slice(0, 3).map((s) => <ShiftChip key={s.id} s={s} ctx={ctx} compact onClick={() => onShift(s)} />)}
            {list.length > 3 && <button className="more" onClick={() => onDay(d)}>+{list.length - 3} more</button>}
          </div>
        );
      })}
    </div>
  );
}

export function ShiftChip({ s, ctx, compact, onClick }) {
  const mine = s.memberId === ctx.me.id;
  const past = s.end <= nowLocal();
  const hasReq = s.pendingRequests?.some((r) => r.type !== 'accept_shift');
  const color = s.status === 'open' ? 'var(--muted)' : s.color;
  const label = s.status === 'open' ? 'Open shift' : s.memberName;
  return (
    <button
      className={`chip ${mine ? 'mine' : ''} ${past ? 'is-past' : ''} status-${s.status} ${compact ? 'compact' : ''}`}
      style={{ '--c': color }}
      onClick={onClick}
      title={`${timeOf(s.start)}–${timeOf(s.end)} · ${label}${s.note ? ` · ${s.note}` : ''}`}
    >
      <span className="chip-time">{timeOf(s.start)}{compact ? '' : `–${timeOf(s.end)}`}</span>
      <span className="chip-name">{compact ? label.split(' ')[0] : label}{mine && !compact ? ' (you)' : ''}</span>
      {!compact && s.note && <span className="chip-note">{s.note}</span>}
      {!compact && s.status === 'pending' && <span className="chip-flag warn">Awaiting reply</span>}
      {!compact && hasReq && <span className="chip-flag">Request pending</span>}
    </button>
  );
}

function Legend({ ctx }) {
  return (
    <div className="legend" aria-label="Workers">
      {ctx.workers.map((w) => (
        <span key={w.id} className="legend-item"><span className="dot" style={{ background: w.color }} />{w.name}{w.id === ctx.me.id ? ' (you)' : ''}{!w.joined ? ' · invited' : ''}</span>
      ))}
      <span className="legend-item"><span className="dot dashed" />Open shift</span>
    </div>
  );
}
