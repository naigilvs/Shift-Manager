import React, { useState } from 'react';
import { api, setToken } from './lib.js';
import { Field, ErrorBox } from './ui.jsx';

// Start page: Create / Join (and log in). Account details are collected inline
// so a new person never has to sign up separately.
export default function Start({ me, onAuthed, onOpenGroup, onBack, onLogout }) {
  const [mode, setMode] = useState(null); // null | 'create' | 'join' | 'login'

  return (
    <div className="start">
      <div className="start-card">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <svg viewBox="0 0 32 32" width="44" height="44"><rect width="32" height="32" rx="9" fill="var(--accent)" /><rect x="7" y="9" width="18" height="16" rx="2" fill="none" stroke="white" strokeWidth="2.5" /><path d="M7 14h18M12 6v5M20 6v5" stroke="white" strokeWidth="2.5" strokeLinecap="round" /></svg>
          </div>
          <h1>Shift Manager</h1>
          <p className="muted">Schedules, swaps and team chat for your workplace.</p>
        </div>

        {me && <p className="signed-in">Signed in as <b>{me.user.name}</b>{onLogout && <> · <button className="link" onClick={onLogout}>Log out</button></>}</p>}

        {!mode && (
          <>
            <div className="choice-grid">
              <button className="choice" onClick={() => setMode('create')}>
                <span className="choice-icon" aria-hidden>＋</span>
                <span className="choice-title">Create a group</span>
                <span className="choice-text">You'll be the manager and build the schedule.</span>
              </button>
              <button className="choice" onClick={() => setMode('join')}>
                <span className="choice-icon" aria-hidden>→</span>
                <span className="choice-title">Join a group</span>
                <span className="choice-text">Enter the code your manager gave you.</span>
              </button>
            </div>
            {me?.groups.length > 0 && (
              <div className="my-groups">
                <div className="section-label">Your groups</div>
                {me.groups.map((g) => (
                  <button key={g.id} className="group-row" onClick={() => onOpenGroup(g.id)}>
                    <span>{g.name}</span><span className="pill">{g.role}</span>
                  </button>
                ))}
              </div>
            )}
            {!me && <p className="center muted small">Already have an account? <button className="link" onClick={() => setMode('login')}>Log in</button></p>}
            {onBack && <p className="center"><button className="link" onClick={onBack}>← Back to my group</button></p>}
          </>
        )}

        {mode === 'create' && <CreateForm me={me} onAuthed={onAuthed} onOpenGroup={onOpenGroup} onCancel={() => setMode(null)} />}
        {mode === 'join' && <JoinForm me={me} onAuthed={onAuthed} onOpenGroup={onOpenGroup} onCancel={() => setMode(null)} />}
        {mode === 'login' && <LoginForm onAuthed={onAuthed} onOpenGroup={onOpenGroup} onCancel={() => setMode(null)} />}
      </div>
    </div>
  );
}

function AboutYou({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className="fieldset">
      <legend>About you</legend>
      <Field label="Your name"><input value={value.name} onChange={set('name')} autoComplete="name" required /></Field>
      <Field label="Phone number"><input type="tel" value={value.phone} onChange={set('phone')} autoComplete="tel" required /></Field>
      <Field label="Password" hint="Used to log in on other devices. If you already have an account, use your existing password.">
        <input type="password" value={value.password} onChange={set('password')} autoComplete="new-password" required minLength={4} />
      </Field>
    </fieldset>
  );
}

async function ensureAccount(me, who, onAuthed) {
  if (me) return;
  const r = await api('POST', '/auth/enter', who);
  setToken(r.token);
  await onAuthed();
}

function CreateForm({ me, onAuthed, onOpenGroup, onCancel }) {
  const [name, setName] = useState('');
  const [who, setWho] = useState({ name: '', phone: '', password: '' });
  const [people, setPeople] = useState([{ name: '', phone: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setPerson = (i, k, v) => setPeople(people.map((p, j) => (j === i ? { ...p, [k]: v } : p)));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await ensureAccount(me, who, onAuthed);
      const invites = people.filter((p) => p.phone.trim());
      const g = await api('POST', '/groups', { name, invites });
      await onOpenGroup(g.id, { welcome: { code: g.code, name: g.name, invited: invites.length } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      <h2>Create a group</h2>
      <Field label="Group name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Corner Café" required autoFocus /></Field>
      {!me && <AboutYou value={who} onChange={setWho} />}
      <fieldset className="fieldset">
        <legend>Add people <span className="muted">(optional — you can add more later)</span></legend>
        {people.map((p, i) => (
          <div className="person-row" key={i}>
            <input aria-label={`Person ${i + 1} name`} placeholder="Name" value={p.name} onChange={(e) => setPerson(i, 'name', e.target.value)} />
            <input aria-label={`Person ${i + 1} phone`} type="tel" placeholder="Phone number" value={p.phone} onChange={(e) => setPerson(i, 'phone', e.target.value)} />
            {people.length > 1 && <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setPeople(people.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPeople([...people, { name: '', phone: '' }])}>＋ Add another person</button>
        <p className="field-hint">When they join with the group code using this phone number, they're matched to their spot automatically — and you can schedule them before they join.</p>
      </fieldset>
      <ErrorBox error={error} />
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Back</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button>
      </div>
    </form>
  );
}

function JoinForm({ me, onAuthed, onOpenGroup, onCancel }) {
  const [code, setCode] = useState('');
  const [who, setWho] = useState({ name: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await ensureAccount(me, who, onAuthed);
      const g = await api('POST', '/groups/join', { code });
      await onOpenGroup(g.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      <h2>Join a group</h2>
      <Field label="Group code">
        <input className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={8} required autoFocus autoCapitalize="characters" autoComplete="off" />
      </Field>
      {!me && <AboutYou value={who} onChange={setWho} />}
      <ErrorBox error={error} />
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Back</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Joining…' : 'Join group'}</button>
      </div>
    </form>
  );
}

function LoginForm({ onAuthed, onOpenGroup, onCancel }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api('POST', '/auth/enter', { phone, password, login: true });
      setToken(r.token);
      const data = await onAuthed();
      if (data?.groups[0]) await onOpenGroup(data.groups[0].id);
      else onCancel();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      <h2>Log in</h2>
      <Field label="Phone number"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required autoFocus /></Field>
      <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
      <ErrorBox error={error} />
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Back</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </div>
    </form>
  );
}
