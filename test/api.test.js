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

// Monday of the week `weeksAhead` from now, as 'YYYY-MM-DD'.
function monday(weeksAhead) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * weeksAhead);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const plus = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };

test('co-managers, repeating shifts, copy week, open shift pick-up', async () => {
  const own = (await call(null, 'POST', '/auth/enter', { name: 'Olu', phone: '5552000001', password: 'pass1' })).body.token;
  const g = (await call(own, 'POST', '/groups', { name: 'Bakery' })).body;
  const gp = `/groups/${g.id}`;
  const join = async (name, phone) => {
    const t = (await call(null, 'POST', '/auth/enter', { name, phone, password: 'pass1' })).body.token;
    await call(t, 'POST', '/groups/join', { code: g.code });
    return t;
  };
  const cm = await join('Cam', '5552000002');
  const wk = await join('Wes', '5552000003');
  const wk2 = await join('Vi', '5552000004');
  const members = (await call(own, 'GET', gp)).body.members;
  const id = (n) => members.find((m) => m.name === n).id;
  assert.equal(members.find((m) => m.name === 'Olu').isOwner, true);

  // Only the owner can promote; promoting Cam gives them manager powers.
  assert.equal((await call(wk, 'PUT', `${gp}/members/${id('Cam')}/role`, { role: 'manager' })).status, 403);
  assert.equal((await call(own, 'PUT', `${gp}/members/${id('Cam')}/role`, { role: 'manager' })).status, 200);
  const camMe = (await call(cm, 'GET', gp)).body;
  assert.equal(camMe.me.role, 'manager');
  assert.ok(camMe.group.code, 'co-manager sees the join code');
  assert.equal((await call(cm, 'POST', `${gp}/messages`, { conv: 'team', body: 'hi' })).status, 403, 'co-manager is read-only in chat');
  assert.equal((await call(cm, 'DELETE', `${gp}/members/${id('Olu')}`)).status, 400, 'owner cannot be removed');

  // Co-manager schedules Wes every Monday for 3 weeks; one of those Mondays is already taken -> skipped.
  const m1 = monday(1);
  await call(own, 'POST', `${gp}/shifts`, { memberId: id('Wes'), start: `${plus(m1, 14)}T10:00`, end: `${plus(m1, 14)}T12:00` });
  const rep = (await call(cm, 'POST', `${gp}/shifts`, { memberId: id('Wes'), start: `${m1}T09:00`, end: `${m1}T17:00`, repeatWeeks: 3 })).body;
  assert.equal(rep.created, 2);
  assert.equal(rep.skipped.length, 1);
  assert.match(rep.skipped[0], /overlaps/);

  // Copy week 1 into week 4: the Monday shift is copied; copying again is a no-op.
  const copy = (await call(own, 'POST', `${gp}/shifts/copy-week`, { from: m1, to: monday(4) })).body;
  assert.equal(copy.created, 1);
  const again = (await call(own, 'POST', `${gp}/shifts/copy-week`, { from: m1, to: monday(4) })).body;
  assert.equal(again.created, 0);
  assert.match(again.skipped[0], /already on the schedule/);
  assert.equal((await call(wk, 'POST', `${gp}/shifts/copy-week`, { from: m1, to: monday(5) })).status, 403);

  // Open shift: Vi asks to pick it up; the co-manager approves.
  const d = plus(m1, 2);
  const open = (await call(own, 'POST', `${gp}/shifts`, { memberId: null, start: `${d}T08:00`, end: `${d}T12:00` })).body;
  assert.equal(open.status, 'open');
  assert.equal((await call(wk2, 'POST', `${gp}/requests`, { type: 'pickup', shiftId: open.id })).status, 200);
  assert.equal((await call(wk, 'POST', `${gp}/requests`, { type: 'pickup', shiftId: open.id })).status, 200);
  const pickups = (await call(cm, 'GET', `${gp}/requests`)).body.filter((r) => r.type === 'pickup');
  const vis = pickups.find((r) => r.fromMemberId === id('Vi'));
  assert.equal((await call(cm, 'POST', `${gp}/requests/${vis.id}/respond`, { action: 'approve' })).status, 200);
  const filled = (await call(own, 'GET', `${gp}/shifts`)).body.find((s) => s.id === open.id);
  assert.equal(filled.memberId, id('Vi'));
  assert.equal(filled.status, 'assigned');
  const wesReq = (await call(wk, 'GET', `${gp}/requests`)).body.find((r) => r.type === 'pickup');
  assert.equal(wesReq.status, 'cancelled', "the other pick-up request is closed once it's filled");
  // Both managers were notified of the pick-up requests.
  assert.ok((await call(own, 'GET', `${gp}/notifications`)).body.some((n) => /pick up/.test(n.text)));
  assert.ok((await call(cm, 'GET', `${gp}/notifications`)).body.some((n) => /pick up/.test(n.text)));

  // Demoting back to worker.
  assert.equal((await call(own, 'PUT', `${gp}/members/${id('Cam')}/role`, { role: 'worker' })).status, 200);
  assert.equal((await call(cm, 'POST', `${gp}/shifts`, { memberId: null, start: `${d}T13:00`, end: `${d}T14:00` })).status, 403);
});
