import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, timeAgo } from './lib.js';
import { Badge, Modal } from './ui.jsx';
import Calendar from './Calendar.jsx';
import Requests from './Requests.jsx';
import Messages from './Messages.jsx';
import History from './History.jsx';
import Team from './Team.jsx';

const TABS = [
  { id: 'calendar', label: 'Calendar', icon: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg> },
  { id: 'requests', label: 'Requests', icon: <svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg> },
  { id: 'messages', label: 'Messages', icon: <svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" /></svg> },
  { id: 'history', label: 'History', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg> },
  { id: 'team', label: 'Team', icon: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-4 3.2-6 6.5-6s6 2 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .6 3.3 2.5 3.5 6" /></svg> },
];

// Keyed by member so two people sharing a device don't clear each other's badge.
const seenKey = (memberId) => `sm.seenMsg.${memberId}`;
const readSeen = (memberId) => { try { return Number(localStorage.getItem(seenKey(memberId))) || 0; } catch { return 0; } };

export default function Shell({ me, group, welcome, clearWelcome, onSwitchGroup, onAddGroup, onLogout }) {
  const gid = group.id;
  const [tab, setTab] = useState(welcome ? 'team' : 'calendar');
  const [info, setInfo] = useState(null); // { group, me, members }
  const [pulse, setPulse] = useState({ unread: 0, actionable: 0, lastMessageId: 0 });
  const [version, setVersion] = useState(0);
  const [seenMsg, setSeenMsg] = useState(() => readSeen(group.memberId));
  const [panel, setPanel] = useState(null); // 'notifications' | 'menu'
  const lastPulse = useRef('');

  const loadInfo = useCallback(() => api('GET', `/groups/${gid}`).then(setInfo).catch(() => {}), [gid]);
  const bump = useCallback(() => { setVersion((v) => v + 1); loadPulse(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPulse = useCallback(async () => {
    try {
      const p = await api('GET', `/groups/${gid}/pulse`);
      setPulse(p);
      const sig = JSON.stringify(p);
      if (lastPulse.current && sig !== lastPulse.current) setVersion((v) => v + 1);
      lastPulse.current = sig;
    } catch { /* offline: keep last state */ }
  }, [gid]);

  useEffect(() => {
    loadInfo();
    loadPulse();
    const t = setInterval(() => { if (!document.hidden) loadPulse(); }, 5000);
    return () => clearInterval(t);
  }, [loadInfo, loadPulse]);

  // Members can change when people join or leave — refresh alongside data changes.
  useEffect(() => { if (version) loadInfo(); }, [version, loadInfo]);

  const markMessagesSeen = useCallback((id) => {
    setSeenMsg((prev) => {
      const next = Math.max(prev, id || 0);
      try { localStorage.setItem(seenKey(group.memberId), String(next)); } catch { /* ignore */ }
      return next;
    });
  }, [group.memberId]);

  if (!info) return <div className="center-screen"><div className="spinner" /></div>;

  const ctx = {
    gid,
    me: info.me,
    isManager: info.me.role === 'manager',
    isOwner: !!info.me.isOwner,
    members: info.members,
    workers: info.members.filter((m) => m.role === 'worker'),
    groupInfo: info.group,
    version,
    bump,
    reloadInfo: loadInfo,
    goTo: setTab,
  };
  const newMessages = pulse.lastMessageId > seenMsg && tab !== 'messages';
  const badges = { requests: pulse.actionable, messages: newMessages ? '•' : 0 };

  return (
    <div className="shell">
      <header className="topbar">
        <button className="group-switch" onClick={() => setPanel(panel === 'menu' ? null : 'menu')} aria-haspopup="menu">
          <span className="group-name">{group.name}</span>
          <span className="role-tag">{ctx.isOwner ? 'Owner' : ctx.isManager ? 'Manager' : info.me.name}</span>
          <span className="caret" aria-hidden>▾</span>
        </button>
        <button className="icon-btn bell" onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')} aria-label={`Notifications${pulse.unread ? `, ${pulse.unread} unread` : ''}`}>
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15zM10 21h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          <Badge n={pulse.unread} />
        </button>
        {panel === 'menu' && (
          <GroupMenu me={me} group={group} onClose={() => setPanel(null)} onSwitchGroup={onSwitchGroup} onAddGroup={onAddGroup} onLogout={onLogout} />
        )}
        {panel === 'notifications' && (
          <Notifications gid={gid} onClose={() => { setPanel(null); loadPulse(); }} goTo={(t) => { setTab(t); setPanel(null); loadPulse(); }} />
        )}
      </header>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <span className="tab-icon">{t.icon}{badges[t.id] ? <span className="badge">{badges[t.id]}</span> : null}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'calendar' && <Calendar ctx={ctx} />}
        {tab === 'requests' && <Requests ctx={ctx} />}
        {tab === 'messages' && <Messages ctx={ctx} onSeen={markMessagesSeen} />}
        {tab === 'history' && <History ctx={ctx} />}
        {tab === 'team' && <Team ctx={ctx} />}
      </main>

      {welcome && (
        <Modal title={`${welcome.name} is ready`} onClose={clearWelcome} footer={<button className="btn btn-primary" onClick={clearWelcome}>Got it</button>}>
          <p>Share this code so your team can join:</p>
          <div className="big-code">{welcome.code}</div>
          <p className="muted small">
            {welcome.invited
              ? `You added ${welcome.invited} ${welcome.invited === 1 ? 'person' : 'people'}. When they join using the same phone number, they'll be matched to their spot.`
              : 'You can add people by phone number from the Team tab at any time.'}
          </p>
        </Modal>
      )}
    </div>
  );
}

function GroupMenu({ me, group, onClose, onSwitchGroup, onAddGroup, onLogout }) {
  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover menu" role="menu">
        <div className="popover-label">Signed in as {me.user.name}</div>
        {me.groups.map((g) => (
          <button key={g.id} role="menuitem" className={`menu-item ${g.id === group.id ? 'current' : ''}`} onClick={() => { onSwitchGroup(g.id); onClose(); }}>
            <span>{g.name}</span><span className="pill">{g.role}</span>
          </button>
        ))}
        <button role="menuitem" className="menu-item" onClick={() => { onAddGroup(); onClose(); }}>＋ Create or join another group</button>
        <button role="menuitem" className="menu-item danger" onClick={onLogout}>Log out</button>
      </div>
    </>
  );
}

function Notifications({ gid, onClose, goTo }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    api('GET', `/groups/${gid}/notifications`).then((n) => {
      setItems(n);
      if (n.some((x) => !x.read)) api('POST', `/groups/${gid}/notifications/read`).catch(() => {});
    }).catch(() => setItems([]));
  }, [gid]);
  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover notifications" role="dialog" aria-label="Notifications">
        <div className="popover-label">Notifications</div>
        {!items && <div className="spinner small" />}
        {items?.length === 0 && <p className="muted small pad">You're all caught up.</p>}
        {items?.map((n) => (
          <button key={n.id} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => goTo(n.tab)}>
            <span>{n.text}</span>
            <span className="muted small">{timeAgo(n.createdAt)}</span>
          </button>
        ))}
      </div>
    </>
  );
}
