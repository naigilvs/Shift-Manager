import React, { useEffect, useState } from 'react';
import { api, fmtRange, timeAgo } from './lib.js';
import { Empty, ErrorBox } from './ui.jsx';

const TYPE_LABEL = { change: 'Shift change', drop: 'Drop shift', trade: 'Shift trade', accept_shift: 'Shift outside availability', pickup: 'Pick up open shift' };
const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };

export default function Requests({ ctx }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api('GET', `/groups/${ctx.gid}/requests`).then(setList).catch((e) => setError(e.message));
  }, [ctx.gid, ctx.version]);

  if (!list) return error ? <ErrorBox error={error} /> : <div className="spinner" />;

  const mine = ctx.me.id;
  const needsMe = (r) => r.status === 'pending' && (ctx.isManager ? ['change', 'drop', 'pickup'].includes(r.type) : r.toMemberId === mine);
  const answer = list.filter(needsMe);
  const sent = list.filter((r) => r.status === 'pending' && r.fromMemberId === mine && r.type !== 'accept_shift');
  const watching = list.filter((r) => r.status === 'pending' && !needsMe(r) && r.fromMemberId !== mine);
  const done = list.filter((r) => r.status !== 'pending').slice(0, 40);

  const act = async (r, path, body) => {
    setBusyId(r.id);
    setError('');
    try {
      await api('POST', `/groups/${ctx.gid}/requests/${r.id}/${path}`, body);
      ctx.bump();
    } catch (e) { setError(e.message); ctx.bump(); } finally { setBusyId(null); }
  };

  return (
    <div className="requests">
      <ErrorBox error={error} />
      <Section title="Needs your answer" empty={ctx.isManager ? 'No change, drop or pick-up requests waiting.' : 'Nothing waiting on you.'}>
        {answer.map((r) => (
          <RequestCard key={r.id} r={r} ctx={ctx}>
            <button className="btn btn-danger-ghost btn-sm" disabled={busyId === r.id} onClick={() => act(r, 'respond', { action: 'decline' })}>Decline</button>
            <button className="btn btn-primary btn-sm" disabled={busyId === r.id} onClick={() => act(r, 'respond', { action: 'approve' })}>
              {r.type === 'accept_shift' ? 'Accept shift' : r.type === 'trade' ? 'Accept trade' : 'Approve'}
            </button>
          </RequestCard>
        ))}
      </Section>

      {!ctx.isManager && (
        <Section title="Sent by you" empty="You have no open requests. Tap a shift on the calendar to make one.">
          {sent.map((r) => (
            <RequestCard key={r.id} r={r} ctx={ctx}>
              <button className="btn btn-ghost btn-sm" disabled={busyId === r.id} onClick={() => act(r, 'cancel')}>Cancel request</button>
            </RequestCard>
          ))}
        </Section>
      )}

      {ctx.isManager && watching.length > 0 && (
        <Section title="Waiting on workers">
          {watching.map((r) => <RequestCard key={r.id} r={r} ctx={ctx} />)}
        </Section>
      )}

      <Section title="Recent" empty="No past requests yet.">
        {done.map((r) => <RequestCard key={r.id} r={r} ctx={ctx} />)}
      </Section>

      {list.length === 0 && (
        <Empty icon="⇄" title="No requests yet">
          {ctx.isManager
            ? 'When workers ask to change or drop a shift, it shows up here for you to approve.'
            : 'Tap your own shift to request a change or drop, or a coworker’s shift to request a trade.'}
        </Empty>
      )}
    </div>
  );
}

function Section({ title, empty, children }) {
  const has = React.Children.count(children) > 0;
  if (!has && !empty) return null;
  return (
    <section className="req-section">
      <h3 className="section-label">{title}</h3>
      {has ? <div className="card-list">{children}</div> : <p className="muted small">{empty}</p>}
    </section>
  );
}

function RequestCard({ r, ctx, children }) {
  const you = (id, name) => (id === ctx.me.id ? 'You' : name);
  let text;
  if (r.type === 'change') {
    text = <>{you(r.fromMemberId, r.fromName)} asked to move {r.shift ? <b>{fmtRange(r.shift)}</b> : 'a shift'} to <b>{fmtRange({ start: r.proposedStart, end: r.proposedEnd })}</b>.</>;
  } else if (r.type === 'drop') {
    text = <>{you(r.fromMemberId, r.fromName)} asked to drop {r.shift ? <b>{fmtRange(r.shift)}</b> : 'a shift'}.</>;
  } else if (r.type === 'pickup') {
    text = <>{you(r.fromMemberId, r.fromName)} asked to pick up the open shift {r.shift ? <b>{fmtRange(r.shift)}</b> : ''}.</>;
  } else if (r.type === 'trade') {
    text = r.offerShift
      ? <>{you(r.fromMemberId, r.fromName)} offered <b>{fmtRange(r.offerShift)}</b> in exchange for {r.toMemberId === ctx.me.id ? 'your' : `${r.toName}'s`} shift <b>{r.shift ? fmtRange(r.shift) : ''}</b>.</>
      : <>{you(r.fromMemberId, r.fromName)} asked to take {r.toMemberId === ctx.me.id ? 'your' : `${r.toName}'s`} shift <b>{r.shift ? fmtRange(r.shift) : ''}</b>.</>;
  } else {
    text = <>{you(r.fromMemberId, r.fromName)} asked {r.toMemberId === ctx.me.id ? 'you' : r.toName} to work <b>{r.shift ? fmtRange(r.shift) : 'a shift'}</b>, which is outside {r.toMemberId === ctx.me.id ? 'your' : 'their'} usual availability.</>;
  }
  return (
    <article className={`req-card status-${r.status}`}>
      <div className="req-top">
        <span className={`req-type type-${r.type}`}>{TYPE_LABEL[r.type]}</span>
        <span className={`status-pill ${r.status}`}>
          {r.status === 'approved' && (r.type === 'trade' || r.type === 'accept_shift') ? 'Accepted' : STATUS_LABEL[r.status]}
        </span>
      </div>
      <p className="req-text">{text}</p>
      {r.message && <p className="req-msg">“{r.message}”</p>}
      <div className="req-foot">
        <span className="muted small">{timeAgo(r.status === 'pending' ? r.createdAt : r.resolvedAt || r.createdAt)}</span>
        {children && <div className="req-actions">{children}</div>}
      </div>
    </article>
  );
}
