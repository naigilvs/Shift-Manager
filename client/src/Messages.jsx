import React, { useEffect, useRef, useState } from 'react';
import { api, clockOf } from './lib.js';
import { Avatar, Empty, ErrorBox } from './ui.jsx';

export default function Messages({ ctx, onSeen }) {
  const [convs, setConvs] = useState(null);
  const [active, setActive] = useState('team');
  const [mobileThread, setMobileThread] = useState(false);

  useEffect(() => {
    api('GET', `/groups/${ctx.gid}/conversations`).then((c) => {
      setConvs(c);
      const maxId = Math.max(0, ...c.map((x) => x.last?.id || 0));
      onSeen(maxId);
    }).catch(() => setConvs([]));
  }, [ctx.gid, ctx.version, onSeen]);

  if (!convs) return <div className="spinner" />;
  const current = convs.find((c) => c.conv === active) || convs[0];

  return (
    <div className={`messages ${mobileThread ? 'show-thread' : ''}`}>
      <aside className="conv-list" aria-label="Conversations">
        {ctx.isManager && <div className="alert alert-info small">You can read all team messages. Only workers can send them.</div>}
        {convs.map((c) => (
          <button key={c.conv} className={`conv ${c.conv === current?.conv ? 'active' : ''}`} onClick={() => { setActive(c.conv); setMobileThread(true); }}>
            {c.conv === 'team' ? <span className="avatar team-avatar">#</span> : <Avatar name={c.title} color={c.color} />}
            <span className="conv-main">
              <span className="conv-title">{c.title}</span>
              <span className="conv-last">{c.last ? `${c.last.name.split(' ')[0]}: ${c.last.body}` : 'No messages yet'}</span>
            </span>
          </button>
        ))}
        {!ctx.isManager && convs.length === 1 && <p className="muted small pad">Direct messages appear here once coworkers join.</p>}
      </aside>
      {current && <Thread key={current.conv} ctx={ctx} conv={current} onBack={() => setMobileThread(false)} />}
    </div>
  );
}

function Thread({ ctx, conv, onBack }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    api('GET', `/groups/${ctx.gid}/messages?conv=${encodeURIComponent(conv.conv)}`).then(setMsgs).catch((e) => setError(e.message));
  }, [ctx.gid, conv.conv, ctx.version]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError('');
    try {
      await api('POST', `/groups/${ctx.gid}/messages`, { conv: conv.conv, body: text });
      setText('');
      ctx.bump();
    } catch (err) { setError(err.message); }
  };

  return (
    <section className="thread" aria-label={conv.title}>
      <header className="thread-head">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="Back to conversations">‹</button>
        <h2>{conv.title}</h2>
        {ctx.isManager && <span className="pill">Read only</span>}
      </header>
      <div className="thread-body">
        {!msgs && !error && <div className="spinner" />}
        {msgs?.length === 0 && <Empty icon="💬" title="No messages yet">{ctx.isManager ? 'Messages your team sends will appear here.' : 'Say hello!'}</Empty>}
        {msgs?.map((m, i) => {
          const mine = m.memberId === ctx.me.id;
          const showName = !mine && (i === 0 || msgs[i - 1].memberId !== m.memberId);
          return (
            <div key={m.id} className={`msg ${mine ? 'mine' : ''}`}>
              {showName && <span className="msg-name" style={{ color: m.color }}>{m.name}</span>}
              <div className="bubble">{m.body}</div>
              <span className="msg-time">{clockOf(m.createdAt)}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <ErrorBox error={error} />
      {ctx.isManager ? (
        <div className="composer readonly">Managers can view messages but can't send or edit them.</div>
      ) : (
        <form className="composer" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${conv.title}`} aria-label="Message" maxLength={2000} />
          <button className="btn btn-primary" disabled={!text.trim()}>Send</button>
        </form>
      )}
    </section>
  );
}
