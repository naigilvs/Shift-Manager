import React, { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from './lib.js';
import Start from './Start.jsx';
import Shell from './Shell.jsx';

const LAST_GROUP = 'sm.lastGroup';
const readLast = () => { try { return Number(localStorage.getItem(LAST_GROUP)) || null; } catch { return null; } };
const writeLast = (id) => { try { localStorage.setItem(LAST_GROUP, String(id)); } catch { /* ignore */ } };

export default function App() {
  const [me, setMe] = useState(null); // { user, groups }
  const [loading, setLoading] = useState(!!getToken());
  const [groupId, setGroupId] = useState(null);
  const [showStart, setShowStart] = useState(false);
  const [welcome, setWelcome] = useState(null); // shown once after creating a group

  const refreshMe = useCallback(async () => {
    if (!getToken()) { setMe(null); setLoading(false); return null; }
    try {
      const data = await api('GET', '/me');
      setMe(data);
      return data;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe().then((data) => {
      if (!data) return;
      const last = readLast();
      const g = data.groups.find((x) => x.id === last) || data.groups[0];
      if (g) setGroupId(g.id);
    });
    const onLogout = () => { setMe(null); setGroupId(null); };
    window.addEventListener('sm:logout', onLogout);
    return () => window.removeEventListener('sm:logout', onLogout);
  }, [refreshMe]);

  const openGroup = async (id, opts = {}) => {
    await refreshMe();
    writeLast(id);
    setGroupId(id);
    setShowStart(false);
    if (opts.welcome) setWelcome(opts.welcome);
  };

  const logout = async () => {
    try { await api('POST', '/auth/logout'); } catch { /* ignore */ }
    setToken(null);
    setMe(null);
    setGroupId(null);
  };

  if (loading) return <div className="center-screen"><div className="spinner" /></div>;

  const group = me?.groups.find((g) => g.id === groupId);
  if (!me || !group || showStart) {
    return (
      <Start
        me={me}
        onAuthed={refreshMe}
        onOpenGroup={openGroup}
        onBack={group ? () => setShowStart(false) : null}
        onLogout={me ? logout : null}
      />
    );
  }

  return (
    <Shell
      key={group.id}
      me={me}
      group={group}
      welcome={welcome}
      clearWelcome={() => setWelcome(null)}
      onSwitchGroup={(id) => { writeLast(id); setGroupId(id); }}
      onAddGroup={() => setShowStart(true)}
      onLogout={logout}
    />
  );
}
