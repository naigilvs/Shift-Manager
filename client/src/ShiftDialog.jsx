import React, { useEffect, useState } from 'react';
import { api, buildRange, fmtDayLong, fmtRange, timeOf, nowLocal, parseDay, DAYS, hoursBetween, fmtHours, ymd, addDays } from './lib.js';
import { Modal, Field, ErrorBox, Avatar } from './ui.jsx';

/** Opens the right dialog for who's looking at which shift. */
export default function ShiftDialog({ ctx, shift, newOn, onClose, onDone }) {
  if (ctx.isManager) return <ShiftEditor ctx={ctx} shift={shift} newOn={newOn} onClose={onClose} onDone={onDone} />;

  const past = shift.start <= nowLocal();
  const mine = shift.memberId === ctx.me.id;
  if (mine && shift.status === 'pending') return <AcceptDialog ctx={ctx} shift={shift} onClose={onClose} onDone={onDone} />;
  if (!past && mine && shift.status === 'assigned') return <MyShiftDialog ctx={ctx} shift={shift} onClose={onClose} onDone={onDone} />;
  if (!past && !mine && shift.status === 'assigned') return <TradeDialog ctx={ctx} shift={shift} onClose={onClose} onDone={onDone} />;
  return (
    <Modal title="Shift details" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <ShiftSummary shift={shift} />
      {past && <p className="muted small">This shift has already started, so it can't be changed.</p>}
      {shift.status === 'open' && <p className="muted small">This shift has no one assigned yet. Ask your manager if you'd like to pick it up.</p>}
    </Modal>
  );
}

function ShiftSummary({ shift }) {
  return (
    <div className="shift-summary">
      <Avatar name={shift.memberName || 'Open'} color={shift.status === 'open' ? '#94a3b8' : shift.color} size={40} />
      <div>
        <div className="strong">{shift.status === 'open' ? 'Open shift' : shift.memberName}</div>
        <div>{fmtDayLong(shift.start)}</div>
        <div className="muted">{timeOf(shift.start)}–{timeOf(shift.end)} · {fmtHours(hoursBetween(shift.start, shift.end))}</div>
        {shift.note && <div className="muted small">{shift.note}</div>}
      </div>
    </div>
  );
}

const myPending = (ctx, shift, type) => shift.pendingRequests?.find((r) => r.type === type && r.fromMemberId === ctx.me.id);

// ---------- worker: own shift → request change or drop ----------
function MyShiftDialog({ ctx, shift, onClose, onDone }) {
  const [mode, setMode] = useState(null); // 'change' | 'drop'
  const [date, setDate] = useState(shift.start.slice(0, 10));
  const [st, setSt] = useState(timeOf(shift.start));
  const [et, setEt] = useState(timeOf(shift.end));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingChange = myPending(ctx, shift, 'change');
  const pendingDrop = myPending(ctx, shift, 'drop');

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { type: mode, shiftId: shift.id, message };
      if (mode === 'change') Object.assign(body, (({ start, end }) => ({ proposedStart: start, proposedEnd: end }))(buildRange(date, st, et)));
      await api('POST', `/groups/${ctx.gid}/requests`, body);
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal
      title="Your shift"
      onClose={onClose}
      footer={mode ? (
        <>
          <button className="btn btn-ghost" onClick={() => setMode(null)}>Back</button>
          <button className={`btn ${mode === 'drop' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={send}>
            {mode === 'drop' ? 'Send drop request' : 'Send change request'}
          </button>
        </>
      ) : <button className="btn" onClick={onClose}>Close</button>}
    >
      <ShiftSummary shift={shift} />
      {!mode && (
        <>
          {(pendingChange || pendingDrop) && (
            <div className="alert alert-info">You already have a pending {pendingDrop ? 'drop' : 'change'} request for this shift. You can cancel it from the Requests tab.</div>
          )}
          <div className="action-list">
            <button className="action" disabled={!!pendingChange} onClick={() => setMode('change')}>
              <span className="action-title">Request a shift change</span>
              <span className="action-text">Suggest a different time. Your manager will approve or decline.</span>
            </button>
            <button className="action" disabled={!!pendingDrop} onClick={() => setMode('drop')}>
              <span className="action-title">Request to drop this shift</span>
              <span className="action-text">Ask your manager to take you off this shift.</span>
            </button>
          </div>
          <p className="muted small">Want to swap with a coworker? Tap their shift on the calendar to request a trade.</p>
        </>
      )}
      {mode === 'change' && (
        <div className="stack">
          <Field label="New date"><input type="date" value={date} min={ymd(new Date())} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="two-col">
            <Field label="Start"><input type="time" value={st} onChange={(e) => setSt(e.target.value)} /></Field>
            <Field label="End" hint={et <= st ? 'Ends the next day' : null}><input type="time" value={et} onChange={(e) => setEt(e.target.value)} /></Field>
          </div>
          <Field label="Message to your manager (optional)"><textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. I have a class until 10" /></Field>
        </div>
      )}
      {mode === 'drop' && (
        <Field label="Reason (optional)"><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Let your manager know why" /></Field>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}

// ---------- worker: someone else's shift → request trade ----------
function TradeDialog({ ctx, shift, onClose, onDone }) {
  const [mine, setMine] = useState(null);
  const [offer, setOffer] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const already = myPending(ctx, shift, 'trade');

  useEffect(() => {
    const from = nowLocal();
    const to = `${ymd(addDays(new Date(), 90))}T00:00`;
    api('GET', `/groups/${ctx.gid}/shifts?from=${from}&to=${to}`)
      .then((list) => {
        const own = list.filter((s) => s.memberId === ctx.me.id && s.status === 'assigned' && s.start > from);
        setMine(own);
        if (own[0]) setOffer(String(own[0].id));
      })
      .catch(() => setMine([]));
  }, [ctx.gid, ctx.me.id]);

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api('POST', `/groups/${ctx.gid}/requests`, { type: 'trade', shiftId: shift.id, offerShiftId: offer ? Number(offer) : null, message });
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const first = shift.memberName.split(' ')[0];
  return (
    <Modal
      title={`${first}'s shift`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !!already || !mine} onClick={send}>Send trade request</button>
      </>}
    >
      <ShiftSummary shift={shift} />
      {already ? <div className="alert alert-info">You've already asked {first} about this shift. You'll be notified when they answer.</div> : (
        <div className="stack">
          <p className="small">Request a shift trade with {first}. They'll get the request and can accept or decline. Your manager is notified if the shifts change.</p>
          <Field label="What do you offer in exchange?">
            {!mine ? <div className="spinner small" /> : (
              <select value={offer} onChange={(e) => setOffer(e.target.value)}>
                {mine.map((s) => <option key={s.id} value={s.id}>My shift: {fmtRange(s)}</option>)}
                <option value="">Nothing — I'd just like to take this shift</option>
              </select>
            )}
          </Field>
          <Field label={`Message to ${first} (optional)`}><textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        </div>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}

// ---------- worker: shift outside availability → accept/decline ----------
function AcceptDialog({ ctx, shift, onClose, onDone }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const req = shift.pendingRequests?.find((r) => r.type === 'accept_shift');
  const me = ctx.members.find((m) => m.id === ctx.me.id);
  const wd = parseDay(shift.start).getDay();
  const slots = (me?.availability || []).filter((s) => s.weekday === wd);

  const respond = async (action) => {
    setBusy(true);
    setError('');
    try {
      await api('POST', `/groups/${ctx.gid}/requests/${req.id}/respond`, { action });
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal
      title="Can you work this shift?"
      onClose={onClose}
      footer={<>
        <button className="btn btn-danger-ghost" disabled={busy || !req} onClick={() => respond('decline')}>Decline</button>
        <button className="btn btn-primary" disabled={busy || !req} onClick={() => respond('approve')}>Accept shift</button>
      </>}
    >
      <ShiftSummary shift={shift} />
      <div className="alert alert-warn">
        This is outside your general availability.{' '}
        {slots.length
          ? `On ${DAYS[wd]}s you're usually available ${slots.map((s) => `${s.start}–${s.end}`).join(', ')}.`
          : `You're not usually available on ${DAYS[wd]}s.`}{' '}
        Your manager is asking whether you'd like to take it anyway.
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

// ---------- manager: create / edit shifts ----------
function ShiftEditor({ ctx, shift, newOn, onClose, onDone }) {
  const [memberId, setMemberId] = useState(shift ? String(shift.memberId ?? '') : String(ctx.workers.find((w) => w.joined)?.id ?? ctx.workers[0]?.id ?? ''));
  const [date, setDate] = useState(shift ? shift.start.slice(0, 10) : newOn);
  const [st, setSt] = useState(shift ? timeOf(shift.start) : '09:00');
  const [et, setEt] = useState(shift ? timeOf(shift.end) : '17:00');
  const [note, setNote] = useState(shift?.note || '');
  const [conflict, setConflict] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const worker = ctx.workers.find((w) => String(w.id) === memberId);
  const wd = date ? parseDay(date).getDay() : 0;
  const daySlots = (worker?.availability || []).filter((s) => s.weekday === wd);

  const save = async (sendAsRequest = false) => {
    setBusy(true);
    setError('');
    try {
      const body = { memberId: memberId ? Number(memberId) : null, ...buildRange(date, st, et), note, sendAsRequest };
      if (shift) await api('PUT', `/groups/${ctx.gid}/shifts/${shift.id}`, body);
      else await api('POST', `/groups/${ctx.gid}/shifts`, body);
      onDone();
    } catch (e) {
      if (e.status === 409 && e.body.conflict) setConflict(e.body);
      else setError(e.message);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await api('DELETE', `/groups/${ctx.gid}/shifts/${shift.id}`); onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };

  if (conflict) {
    return (
      <Modal
        title="Outside their availability"
        onClose={onClose}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setConflict(null)}>Change shift</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>Ask {conflict.workerName.split(' ')[0]} to accept</button>
        </>}
      >
        <div className="alert alert-warn">{conflict.issue}</div>
        <p>You can send this shift as a request. {conflict.workerName} will be asked to accept or decline it, and the shift will show as <b>awaiting reply</b> until they answer. If they decline it becomes an open shift.</p>
        <ErrorBox error={error} />
      </Modal>
    );
  }

  const past = shift && shift.end <= nowLocal();
  return (
    <Modal
      title={shift ? 'Edit shift' : 'New shift'}
      onClose={onClose}
      footer={<>
        {shift && (confirmDelete
          ? <button className="btn btn-danger" disabled={busy} onClick={remove}>Confirm delete</button>
          : <button className="btn btn-danger-ghost" onClick={() => setConfirmDelete(true)}>Delete</button>)}
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !date} onClick={() => save(false)}>{shift ? 'Save' : 'Add shift'}</button>
      </>}
    >
      <div className="stack">
        {shift?.status === 'pending' && <div className="alert alert-info">Waiting for {shift.memberName} to accept this shift.</div>}
        {past && <div className="alert alert-info">This shift is in the past. Edits change the work history.</div>}
        <Field label="Worker">
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">— Open shift (no one yet) —</option>
            {ctx.workers.map((w) => <option key={w.id} value={w.id}>{w.name}{w.joined ? '' : ' (invited)'}</option>)}
          </select>
        </Field>
        {worker && (
          <p className={`avail-hint ${worker.availability.length && !daySlots.length ? 'warn' : ''}`}>
            {!worker.availability.length
              ? `${worker.name} hasn't set their availability.`
              : daySlots.length
                ? `${worker.name} is usually available on ${DAYS[wd]}s ${daySlots.map((s) => `${s.start}–${s.end}`).join(', ')}.`
                : `${worker.name} is not usually available on ${DAYS[wd]}s.`}
          </p>
        )}
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="two-col">
          <Field label="Start"><input type="time" value={st} onChange={(e) => setSt(e.target.value)} /></Field>
          <Field label="End" hint={et <= st ? 'Ends the next day' : null}><input type="time" value={et} onChange={(e) => setEt(e.target.value)} /></Field>
        </div>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Opening, register 2" maxLength={300} /></Field>
        {ctx.workers.length === 0 && <p className="muted small">No workers yet — add people from the Team tab. You can still create open shifts.</p>}
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
