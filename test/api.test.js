// End-to-end API test: starts the server on a throwaway in-memory database.
// Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3999;
const BASE = `http://localhost:${PORT}/api`;
let server;

before(async () => {
  server = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: ':memory:', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('running') && resolve()));
});
after(() => server.kill());

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

// Dates relative to today so shifts are always in the future.
const pad = (n) => String(n).padStart(2, '0');
function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const weekday = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getDay(); };

test('full workflow', async () => {
  // Manager creates a group and invites Ana by phone.
  const mgr = (await call(null, 'POST', '/auth/enter', { name: 'Maya', phone: '555-000-0001', password: 'pass1' })).body.token;
  const g = (await call(mgr, 'POST', '/groups', { name: 'Cafe', invites: [{ name: 'Ana', phone: '(555) 000-0002' }] })).body;
  const gp = `/groups/${g.id}`;
  assert.equal(g.code.length, 6);

  // Ana joins with the code and claims her invited seat; Ben joins uninvited.
  const ana = (await call(null, 'POST', '/auth/enter', { name: 'Ana P', phone: '5550000002', password: 'pass2' })).body.token;
  assert.equal((await call(ana, 'POST', '/groups/join', { code: g.code.toLowerCase() })).status, 200);
  const ben = (await call(null, 'POST', '/auth/enter', { name: 'Ben', phone: '5550000003', password: 'pass3' })).body.token;
  await call(ben, 'POST', '/groups/join', { code: g.code });

  const info = (await call(mgr, 'GET', gp)).body;
  assert.equal(info.members.length, 3);
  const anaM = info.members.find((m) => m.phone === '5550000002');
  const benM = info.members.find((m) => m.name === 'Ben');
  assert.equal(anaM.joined, true);
  assert.equal((await call(ana, 'GET', gp)).body.group.code, undefined, 'workers do not see the join code');

  // Wrong password on an existing phone is rejected.
  assert.equal((await call(null, 'POST', '/auth/enter', { phone: '5550000002', password: 'nope' })).status, 401);

  // Ana is available 09:00–13:00 on the weekday 3 days from now.
  const d3 = day(3), wd3 = weekday(3);
  await call(ana, 'PUT', `${gp}/availability`, { slots: [{ weekday: wd3, start: '09:00', end: '13:00' }] });

  // Inside availability: assigned directly.
  const s1 = (await call(mgr, 'POST', `${gp}/shifts`, { memberId: anaM.id, start: `${d3}T09:00`, end: `${d3}T12:00` })).body;
  assert.equal(s1.status, 'assigned');

  // Outside availability: warning first, then sent as a request Ana must accept.
  const warn = await call(mgr, 'POST', `${gp}/shifts`, { memberId: anaM.id, start: `${d3}T14:00`, end: `${d3}T18:00` });
  assert.equal(warn.status, 409);
  assert.match(warn.body.issue, /09:00–13:00/);
  const s2 = (await call(mgr, 'POST', `${gp}/shifts`, { memberId: anaM.id, start: `${d3}T14:00`, end: `${d3}T18:00`, sendAsRequest: true })).body;
  assert.equal(s2.status, 'pending');
  const acceptReq = (await call(ana, 'GET', `${gp}/requests`)).body.find((r) => r.type === 'accept_shift');
  assert.equal((await call(ana, 'POST', `${gp}/requests/${acceptReq.id}/respond`, { action: 'approve' })).status, 200);
  assert.equal((await call(mgr, 'GET', `${gp}/shifts`)).body.find((s) => s.id === s2.id).status, 'assigned');

  // Workers cannot create shifts.
  assert.equal((await call(ana, 'POST', `${gp}/shifts`, { memberId: anaM.id, start: `${d3}T09:00`, end: `${d3}T10:00` })).status, 403);

  // Ana requests a time change; manager approves.
  await call(ana, 'POST', `${gp}/requests`, { type: 'change', shiftId: s1.id, proposedStart: `${d3}T10:00`, proposedEnd: `${d3}T12:00` });
  const change = (await call(mgr, 'GET', `${gp}/requests`)).body.find((r) => r.type === 'change');
  await call(mgr, 'POST', `${gp}/requests/${change.id}/respond`, { action: 'approve' });
  assert.equal((await call(mgr, 'GET', `${gp}/shifts`)).body.find((s) => s.id === s1.id).start, `${d3}T10:00`);

  // Ben has a shift; Ben offers it to Ana in trade for s1. Ana accepts -> swapped, manager notified.
  const d5 = day(5);
  const sb = (await call(mgr, 'POST', `${gp}/shifts`, { memberId: benM.id, start: `${d5}T08:00`, end: `${d5}T16:00` })).body;
  assert.equal((await call(ben, 'POST', `${gp}/requests`, { type: 'trade', shiftId: s1.id, offerShiftId: sb.id })).status, 200);
  const trade = (await call(ana, 'GET', `${gp}/requests`)).body.find((r) => r.type === 'trade');
  assert.equal((await call(mgr, 'POST', `${gp}/requests/${trade.id}/respond`, { action: 'approve' })).status, 403, 'manager cannot answer a trade');
  assert.equal((await call(ana, 'POST', `${gp}/requests/${trade.id}/respond`, { action: 'approve' })).status, 200);
  const shifts = (await call(mgr, 'GET', `${gp}/shifts`)).body;
  assert.equal(shifts.find((s) => s.id === s1.id).memberId, benM.id);
  assert.equal(shifts.find((s) => s.id === sb.id).memberId, anaM.id);
  const mgrNotes = (await call(mgr, 'GET', `${gp}/notifications`)).body;
  assert.ok(mgrNotes.some((n) => n.text.startsWith('Shift change:')));

  // No double-booking: Ben now has s1 (d3 10:00–12:00), so an overlapping shift is refused.
  const dbl = await call(mgr, 'POST', `${gp}/shifts`, { memberId: benM.id, start: `${d3}T11:00`, end: `${d3}T13:00` });
  assert.equal(dbl.status, 409);
  assert.match(dbl.body.error, /overlaps/);
  assert.equal(dbl.body.conflict, undefined);

  // Drop request -> shift becomes open.
  await call(ana, 'POST', `${gp}/requests`, { type: 'drop', shiftId: sb.id, message: 'Exam' });
  const drop = (await call(mgr, 'GET', `${gp}/requests`)).body.find((r) => r.type === 'drop');
  await call(mgr, 'POST', `${gp}/requests/${drop.id}/respond`, { action: 'approve' });
  const dropped = (await call(mgr, 'GET', `${gp}/shifts`)).body.find((s) => s.id === sb.id);
  assert.equal(dropped.status, 'open');
  assert.equal(dropped.memberId, null);

  // Messages: workers chat, manager reads but cannot send.
  assert.equal((await call(ana, 'POST', `${gp}/messages`, { conv: 'team', body: 'Hi all' })).status, 200);
  const dm = `dm:${Math.min(anaM.id, benM.id)}:${Math.max(anaM.id, benM.id)}`;
  assert.equal((await call(ben, 'POST', `${gp}/messages`, { conv: dm, body: 'Hey Ana' })).status, 200);
  assert.equal((await call(mgr, 'POST', `${gp}/messages`, { conv: 'team', body: 'no' })).status, 403);
  assert.equal((await call(mgr, 'GET', `${gp}/messages?conv=${dm}`)).body[0].body, 'Hey Ana');
  const convs = (await call(mgr, 'GET', `${gp}/conversations`)).body;
  assert.ok(convs.some((c) => c.conv === dm));

  // History: a shift that already ended shows up.
  const past = day(-2);
  await call(mgr, 'POST', `${gp}/shifts`, { memberId: benM.id, start: `${past}T09:00`, end: `${past}T17:00` });
  const hist = (await call(ana, 'GET', `${gp}/history`)).body;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].memberName, 'Ben');
});
