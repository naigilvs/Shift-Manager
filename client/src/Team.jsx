import React, { useState } from 'react';
import { api, SHORT_DAYS } from './lib.js';
import { Avatar, ErrorBox, Field } from './ui.jsx';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon → Sun

export const summarizeAvailability = (slots) => {
  if (!slots.length) return 'Availability not set';
  return WEEK_ORDER.filter((d) => slots.some((s) => s.weekday === d))
    .map((d) => `${SHORT_DAYS[d]} ${slots.filter((s) => s.weekday === d).map((s) => `${s.start}–${s.end}`).join(', ')}`)
    .join(' · ');
};

export default function Team({ ctx }) {
  const me = ctx.members.find((m) => m.id === ctx.me.id);
  return (
    <div className="team">
      {ctx.isManager ? <InviteCard ctx={ctx} /> : <AvailabilityEditor ctx={ctx} me={me} />}
      <MemberList ctx={ctx} />
    </div>
  );
}

function InviteCard({ ctx }) {
  const [code, setCode] = useState(ctx.groupInfo.code);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [copied, setCopied] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    try {
      await api('POST', `/groups/${ctx.gid}/members`, { name, phone });
      setOk(`${name || phone} added. Share the code below so they can join.`);
      setName('');
      setPhone('');
      ctx.reloadInfo();
    } catch (err) { setError(err.message); }
  };

  const shareText = `Join ${ctx.groupInfo.name} on Shift Manager with code ${code} — ${window.location.origin}`;
  const copy = async () => {
    try {
      if (navigator.share && /Mobi/.test(navigator.userAgent)) await navigator.share({ text: shareText });
      else { await navigator.clipboard.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch { /* user cancelled */ }
  };
  const regen = async () => {
    if (!window.confirm('Make a new code? The old code will stop working.')) return;
    const r = await api('POST', `/groups/${ctx.gid}/code`);
    setCode(r.code);
  };

  return (
    <div className="card-grid">
      <section className="card">
        <h3>Group code</h3>
        <div className="big-code">{code}</div>
        <p className="muted small">People join by choosing <b>Join a group</b> and entering this code.</p>
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={copy}>{copied ? 'Copied!' : 'Copy invite message'}</button>
          <button className="btn btn-ghost btn-sm" onClick={regen}>New code</button>
        </div>
      </section>
      <section className="card">
        <h3>Add a person</h3>
        <form onSubmit={add} className="stack">
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Lee" /></Field>
          <Field label="Phone number"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></Field>
          <ErrorBox error={error} />
          {ok && <div className="alert alert-ok">{ok}</div>}
          <button className="btn btn-primary btn-sm">Add person</button>
        </form>
      </section>
    </div>
  );
}

function MemberList({ ctx }) {
  const [error, setError] = useState('');
  const remove = async (m) => {
    const extra = m.role === 'worker' ? ' Their upcoming shifts become open shifts.' : '';
    if (!window.confirm(`Remove ${m.name} from the group?${extra}`)) return;
    try { await api('DELETE', `/groups/${ctx.gid}/members/${m.id}`); ctx.bump(); } catch (e) { setError(e.message); }
  };
  const setRole = async (m, role) => {
    const msg = role === 'manager'
      ? `Make ${m.name} a co-manager? They'll be able to create and edit shifts, answer requests and read all messages. Managers don't work shifts, so their upcoming shifts become open shifts.`
      : `Make ${m.name} a worker again? They'll lose manager access.`;
    if (!window.confirm(msg)) return;
    setError('');
    try { await api('PUT', `/groups/${ctx.gid}/members/${m.id}/role`, { role }); ctx.bump(); } catch (e) { setError(e.message); }
  };
  const canRemove = (m) => ctx.isManager && !m.isOwner && (m.role === 'worker' || ctx.isOwner);
  return (
    <section className="card">
      <h3>People ({ctx.members.length})</h3>
      {ctx.isOwner && <p className="muted small">As the owner, you can make people co-managers. Co-managers can do everything you can except change who is a manager.</p>}
      <ErrorBox error={error} />
      <ul className="member-list">
        {ctx.members.map((m) => (
          <li key={m.id} className="member">
            <Avatar name={m.name} color={m.color} />
            <div className="member-main">
              <div className="member-name">
                {m.name}{m.id === ctx.me.id ? ' (you)' : ''}
                {m.isOwner ? <span className="pill pill-owner">Owner</span> : m.role === 'manager' && <span className="pill">Co-manager</span>}
                {!m.joined && <span className="pill pill-warn">Invited</span>}
              </div>
              {m.phone && <div className="muted small">{m.phone}</div>}
              {m.role === 'worker' && <div className="muted small">{summarizeAvailability(m.availability)}</div>}
              {m.availabilityNote && <div className="muted small">“{m.availabilityNote}”</div>}
            </div>
            <div className="member-actions">
              {ctx.isOwner && !m.isOwner && m.joined && (
                m.role === 'worker'
                  ? <button className="btn btn-ghost btn-sm" onClick={() => setRole(m, 'manager')}>Make co-manager</button>
                  : <button className="btn btn-ghost btn-sm" onClick={() => setRole(m, 'worker')}>Make worker</button>
              )}
              {canRemove(m) && <button className="btn btn-danger-ghost btn-sm" onClick={() => remove(m)}>Remove</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AvailabilityEditor({ ctx, me }) {
  const [slots, setSlots] = useState(() => (me?.availability || []).map((s) => ({ ...s })));
  const [note, setNote] = useState(me?.availabilityNote || '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const daySlots = (d) => slots.map((s, i) => ({ ...s, i })).filter((s) => s.weekday === d);
  const toggleDay = (d) => setSlots(daySlots(d).length ? slots.filter((s) => s.weekday !== d) : [...slots, { weekday: d, start: '09:00', end: '17:00' }]);
  const update = (i, k, v) => setSlots(slots.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const allDay = () => setSlots(WEEK_ORDER.map((d) => ({ weekday: d, start: '00:00', end: '23:59' })));

  const save = async () => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api('PUT', `/groups/${ctx.gid}/availability`, { slots, note });
      setSaved(true);
      ctx.reloadInfo();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="card">
      <h3>My general availability</h3>
      <p className="muted small">
        Tick the days you can usually work and the hours. If your manager schedules you outside these times,
        you'll be asked to accept or decline the shift. Leave every day unticked if you're flexible.
      </p>
      <div className="avail-grid">
        {WEEK_ORDER.map((d) => {
          const list = daySlots(d);
          return (
            <div key={d} className={`avail-day ${list.length ? 'on' : ''}`}>
              <label className="avail-toggle">
                <input type="checkbox" checked={list.length > 0} onChange={() => toggleDay(d)} />
                <span>{SHORT_DAYS[d]}</span>
              </label>
              <div className="avail-slots">
                {list.length === 0 && <span className="muted small">Not available</span>}
                {list.map((s) => (
                  <div key={s.i} className="avail-slot">
                    <input type="time" aria-label={`${SHORT_DAYS[d]} from`} value={s.start} onChange={(e) => update(s.i, 'start', e.target.value)} />
                    <span>–</span>
                    <input type="time" aria-label={`${SHORT_DAYS[d]} until`} value={s.end} onChange={(e) => update(s.i, 'end', e.target.value)} />
                    <button className="icon-btn" aria-label="Remove time range" onClick={() => setSlots(slots.filter((_, j) => j !== s.i))}>✕</button>
                  </div>
                ))}
                {list.length > 0 && <button className="link small" onClick={() => setSlots([...slots, { weekday: d, start: '17:00', end: '21:00' }])}>+ another time</button>}
              </div>
            </div>
          );
        })}
      </div>
      <Field label="Notes for your manager (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Max 25 hours a week" maxLength={500} /></Field>
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>Save availability</button>
        <button className="btn btn-ghost btn-sm" onClick={allDay}>Available any time</button>
        {saved && <span className="ok-text">Saved ✓</span>}
      </div>
    </section>
  );
}
