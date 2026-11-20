import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtDayLong, timeOf, hoursBetween, fmtHours, fmtMonth } from './lib.js';
import { Avatar, Empty } from './ui.jsx';

// Months for the filter: this month back 12 months.
function monthOptions() {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 13; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ value: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: fmtMonth(m) });
  }
  return out;
}

export default function History({ ctx }) {
  const [who, setWho] = useState(ctx.isManager ? '' : String(ctx.me.id));
  const [month, setMonth] = useState('');
  const [rows, setRows] = useState(null);
  const months = useMemo(monthOptions, []);

  useEffect(() => {
    const q = new URLSearchParams();
    if (who) q.set('memberId', who);
    if (month) q.set('month', month);
    api('GET', `/groups/${ctx.gid}/history?${q}`).then(setRows).catch(() => setRows([]));
  }, [ctx.gid, who, month, ctx.version]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const s of rows || []) {
      const d = s.start.slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(s);
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return [...map.entries()];
  }, [rows]);

  const totals = useMemo(() => {
    const per = new Map();
    let hours = 0;
    for (const s of rows || []) {
      const h = hoursBetween(s.start, s.end);
      hours += h;
      const p = per.get(s.memberId) || { name: s.memberName, color: s.color, hours: 0, count: 0 };
      p.hours += h;
      p.count += 1;
      per.set(s.memberId, p);
    }
    return { hours, per: [...per.values()].sort((a, b) => b.hours - a.hours) };
  }, [rows]);

  return (
    <div className="history">
      <div className="toolbar">
        <h2 className="toolbar-title">Shifts worked</h2>
        <div className="toolbar-group">
          <select className="select-sm" aria-label="Worker" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">All workers</option>
            {ctx.workers.map((w) => <option key={w.id} value={w.id}>{w.id === ctx.me.id ? `${w.name} (you)` : w.name}</option>)}
          </select>
          <select className="select-sm" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All time</option>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {!rows ? <div className="spinner" /> : rows.length === 0 ? (
        <Empty icon="🕑" title="No completed shifts">Shifts appear here automatically once they've ended.</Empty>
      ) : (
        <>
          <div className="stats">
            <div className="stat"><span className="stat-num">{rows.length}</span><span className="stat-label">shifts</span></div>
            <div className="stat"><span className="stat-num">{fmtHours(totals.hours)}</span><span className="stat-label">total hours</span></div>
            {totals.per.length > 1 && totals.per.map((p) => (
              <div className="stat person" key={p.name}><Avatar name={p.name} color={p.color} size={24} /><span>{p.name}</span><span className="muted">{p.count} · {fmtHours(p.hours)}</span></div>
            ))}
          </div>
          {groups.map(([day, list]) => (
            <section key={day} className="hist-day">
              <h3 className="hist-date">
                <span>{fmtDayLong(day)}</span>
                <span className="muted small">{fmtHours(list.reduce((a, s) => a + hoursBetween(s.start, s.end), 0))}</span>
              </h3>
              {list.map((s) => (
                <div key={s.id} className="hist-row" style={{ '--c': s.color }}>
                  <span className="hist-time">{timeOf(s.start)}–{timeOf(s.end)}</span>
                  <span className="hist-name">{s.memberName}</span>
                  <span className="hist-hours">{fmtHours(hoursBetween(s.start, s.end))}</span>
                  {s.note && <span className="muted small hist-note">{s.note}</span>}
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
