import express from 'express';
import { one, all, run, tx } from './db.js';
import {
  COLORS, normPhone, hashPassword, checkPassword, newToken, newCode, nowLocal,
  validateShiftTimes, fmtShift, availabilityIssue, isTime,
} from './logic.js';

export const api = express.Router();
api.use(express.json({ limit: '100kb' }));

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
// Wrap handlers so thrown HttpErrors become JSON responses.
const h = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) res.status(e.status).json({ error: e.message, ...e.extra });
    else {
      console.error(e);
      res.status(500).json({ error: 'Something went wrong on the server.' });
    }
  }
};
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// ---------- auth ----------

function auth(req, _res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const user = token && one(
    'SELECT u.id, u.name, u.phone FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', token,
  );
  if (!user) return _res.status(401).json({ error: 'Please log in again.' });
  req.user = user;
  req.token = token;
  next();
}

function startSession(user) {
  const token = newToken();
  run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', token, user.id);
  return { token, user: { id: user.id, name: user.name, phone: user.phone } };
}

// One endpoint for both sign-up and log-in: if the phone is known the password must match.
api.post('/auth/enter', h((req) => {
  const phone = normPhone(req.body.phone);
  const password = String(req.body.password || '');
  const name = str(req.body.name, 60);
  if (phone.length < 7) fail(400, 'Enter a valid phone number.');
  if (password.length < 4) fail(400, 'Password must be at least 4 characters.');
  const existing = one('SELECT * FROM users WHERE phone = ?', phone);
  if (existing) {
    if (!checkPassword(password, existing.password_hash)) fail(401, 'That phone number already has an account and the password is wrong.');
    return startSession(existing);
  }
  if (req.body.login) fail(404, 'No account found with that phone number.');
  if (!name) fail(400, 'Enter your name.');
  const r = run('INSERT INTO users (name, phone, password_hash) VALUES (?, ?, ?)', name, phone, hashPassword(password));
  return startSession({ id: Number(r.lastInsertRowid), name, phone });
}));

api.post('/auth/logout', auth, h((req) => {
  run('DELETE FROM sessions WHERE token = ?', req.token);
}));

api.get('/me', auth, h((req) => ({
  user: req.user,
  groups: all(
    `SELECT g.id, g.name, m.role, m.id AS memberId FROM members m JOIN groups g ON g.id = m.group_id
     WHERE m.user_id = ? AND m.active = 1 ORDER BY g.name`, req.user.id,
  ),
})));

// ---------- groups ----------

function nextColor(groupId) {
  const n = one('SELECT COUNT(*) AS n FROM members WHERE group_id = ?', groupId).n;
  return COLORS[n % COLORS.length];
}

function addInvite(groupId, name, phoneRaw) {
  const phone = normPhone(phoneRaw);
  if (phone.length < 7) fail(400, `"${phoneRaw}" is not a valid phone number.`);
  const nm = str(name, 60) || phone;
  const existing = one('SELECT * FROM members WHERE group_id = ? AND phone = ?', groupId, phone);
  if (existing) {
    if (existing.active) fail(409, `${existing.name} is already in this group.`);
    run('UPDATE members SET active = 1 WHERE id = ?', existing.id);
    return existing.id;
  }
  // If this phone already has an account, link the seat straight away.
  const user = one('SELECT id, name FROM users WHERE phone = ?', phone);
  const r = run(
    `INSERT INTO members (group_id, user_id, name, phone, role, color, joined_at)
     VALUES (?, ?, ?, ?, 'worker', ?, ?)`,
    groupId, user?.id ?? null, user?.name ?? nm, phone, nextColor(groupId), user ? nowLocal() : null,
  );
  return Number(r.lastInsertRowid);
}

api.post('/groups', auth, h((req) => {
  const name = str(req.body.name, 80);
  if (!name) fail(400, 'Give your group a name.');
  const invites = Array.isArray(req.body.invites) ? req.body.invites : [];
  return tx(() => {
    let code;
    do code = newCode(); while (one('SELECT 1 FROM groups WHERE code = ?', code));
    const g = run('INSERT INTO groups (name, code) VALUES (?, ?)', name, code);
    const gid = Number(g.lastInsertRowid);
    run(
      `INSERT INTO members (group_id, user_id, name, phone, role, color, joined_at) VALUES (?, ?, ?, ?, 'manager', ?, ?)`,
      gid, req.user.id, req.user.name, req.user.phone, '#475569', nowLocal(),
    );
    for (const inv of invites) {
      if (!normPhone(inv.phone)) continue;
      if (normPhone(inv.phone) === req.user.phone) continue;
      addInvite(gid, inv.name, inv.phone);
    }
    return { id: gid, name, code };
  });
}));

api.post('/groups/join', auth, h((req) => {
  const code = str(req.body.code, 12).toUpperCase().replace(/\s/g, '');
  const g = one('SELECT * FROM groups WHERE code = ?', code);
  if (!g) fail(404, 'No group found with that code. Check it with your manager.');
  const mine = one('SELECT * FROM members WHERE group_id = ? AND user_id = ?', g.id, req.user.id);
  if (mine) {
    if (!mine.active) run('UPDATE members SET active = 1 WHERE id = ?', mine.id);
    return { id: g.id, name: g.name };
  }
  const invited = one('SELECT * FROM members WHERE group_id = ? AND phone = ? AND user_id IS NULL', g.id, req.user.phone);
  if (invited) {
    run('UPDATE members SET user_id = ?, name = ?, active = 1, joined_at = ? WHERE id = ?', req.user.id, req.user.name, nowLocal(), invited.id);
  } else {
    run(
      `INSERT INTO members (group_id, user_id, name, phone, role, color, joined_at) VALUES (?, ?, ?, ?, 'worker', ?, ?)`,
      g.id, req.user.id, req.user.name, req.user.phone, nextColor(g.id), nowLocal(),
    );
  }
  const joined = one('SELECT id FROM members WHERE group_id = ? AND user_id = ?', g.id, req.user.id);
  notifyManagers(g.id, `${req.user.name} joined ${g.name}.`, 'team', joined.id);
  return { id: g.id, name: g.name };
}));

// Everything below is scoped to a group the user belongs to.
const group = express.Router({ mergeParams: true });
api.use('/groups/:gid', auth, (req, res, next) => {
  const m = one('SELECT * FROM members WHERE group_id = ? AND user_id = ? AND active = 1', Number(req.params.gid), req.user.id);
  if (!m) return res.status(403).json({ error: 'You are not a member of this group.' });
  req.member = m;
  req.gid = m.group_id;
  req.isManager = m.role === 'manager';
  next();
}, group);

const requireManager = (req) => { if (!req.isManager) fail(403, 'Only the manager can do that.'); };

function notify(memberId, text, tab = 'requests') {
  if (memberId) run('INSERT INTO notifications (member_id, text, tab) VALUES (?, ?, ?)', memberId, text, tab);
}
function notifyManagers(gid, text, tab = 'requests', exceptMemberId = null) {
  for (const m of all("SELECT id FROM members WHERE group_id = ? AND role = 'manager' AND active = 1", gid)) {
    if (m.id !== exceptMemberId) notify(m.id, text, tab);
  }
}
const memberName = (id) => one('SELECT name FROM members WHERE id = ?', id)?.name ?? 'Someone';
const slotsFor = (memberId) => all('SELECT weekday, start, end FROM availability WHERE member_id = ?', memberId);

group.get('/', h((req) => {
  const g = one('SELECT id, name, code FROM groups WHERE id = ?', req.gid);
  const members = all(
    `SELECT id, name, phone, role, color, user_id IS NOT NULL AS joined FROM members
     WHERE group_id = ? AND active = 1 ORDER BY role = 'manager' DESC, name COLLATE NOCASE`, req.gid,
  ).map((m) => ({
    ...m,
    joined: !!m.joined,
    phone: req.isManager || m.id === req.member.id ? m.phone : undefined,
    availability: slotsFor(m.id),
    availabilityNote: one('SELECT note FROM availability_notes WHERE member_id = ?', m.id)?.note ?? '',
  }));
  return {
    group: { id: g.id, name: g.name, code: req.isManager ? g.code : undefined },
    me: { id: req.member.id, role: req.member.role, name: req.member.name },
    members,
  };
}));

group.post('/members', h((req) => {
  requireManager(req);
  const id = addInvite(req.gid, req.body.name, req.body.phone);
  return { id };
}));

group.delete('/members/:mid', h((req) => {
  requireManager(req);
  const m = one('SELECT * FROM members WHERE id = ? AND group_id = ?', Number(req.params.mid), req.gid);
  if (!m) fail(404, 'Member not found.');
  if (m.role === 'manager') fail(400, 'The manager cannot be removed.');
  tx(() => {
    run('UPDATE members SET active = 0 WHERE id = ?', m.id);
    // Their upcoming shifts become open so the manager can reassign them.
    run("UPDATE shifts SET member_id = NULL, status = 'open', updated_at = datetime('now') WHERE member_id = ? AND start > ?", m.id, nowLocal());
    run("UPDATE requests SET status = 'cancelled', resolved_at = datetime('now') WHERE status = 'pending' AND (from_member_id = ? OR to_member_id = ?)", m.id, m.id);
  });
}));

group.post('/code', h((req) => {
  requireManager(req);
  let code;
  do code = newCode(); while (one('SELECT 1 FROM groups WHERE code = ?', code));
  run('UPDATE groups SET code = ? WHERE id = ?', code, req.gid);
  return { code };
}));

// ---------- availability ----------

group.put('/availability', h((req) => {
  if (req.isManager) fail(400, 'Managers do not set availability.');
  const slots = Array.isArray(req.body.slots) ? req.body.slots : [];
  for (const s of slots) {
    if (!(Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6) || !isTime(s.start) || !(isTime(s.end) || s.end === '24:00')) {
      fail(400, 'Each availability slot needs a day and valid start and end times.');
    }
    if (s.end <= s.start) fail(400, 'Availability must end after it starts on the same day.');
  }
  tx(() => {
    run('DELETE FROM availability WHERE member_id = ?', req.member.id);
    for (const s of slots) run('INSERT INTO availability (member_id, weekday, start, end) VALUES (?, ?, ?, ?)', req.member.id, s.weekday, s.start, s.end === '24:00' ? '23:59' : s.end);
    run(
      'INSERT INTO availability_notes (member_id, note) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET note = excluded.note',
      req.member.id, str(req.body.note, 500),
    );
  });
}));

// ---------- shifts ----------

const SHIFT_COLS = `s.id, s.member_id AS memberId, s.start, s.end, s.note, s.status, m.name AS memberName, m.color`;

group.get('/shifts', h((req) => {
  const from = str(req.query.from, 16) || '0000';
  const to = str(req.query.to, 16) || '9999';
  return all(
    `SELECT ${SHIFT_COLS} FROM shifts s LEFT JOIN members m ON m.id = s.member_id
     WHERE s.group_id = ? AND s.end > ? AND s.start < ? ORDER BY s.start`, req.gid, from, to,
  ).map((s) => ({
    ...s,
    pendingRequests: all(
      "SELECT id, type, from_member_id AS fromMemberId FROM requests WHERE status = 'pending' AND (shift_id = ? OR offer_shift_id = ?)", s.id, s.id,
    ),
  }));
}));

function cancelPendingFor(shiftId, exceptRequestId = 0) {
  run(
    `UPDATE requests SET status = 'cancelled', resolved_at = datetime('now')
     WHERE status = 'pending' AND id != ? AND (shift_id = ? OR offer_shift_id = ?)`, exceptRequestId, shiftId, shiftId,
  );
}

/**
 * Assign a shift to a worker, honouring their availability. Returns the status to use.
 * If outside availability and the manager hasn't confirmed, throws a 409 the UI turns into a warning.
 */
/** A worker's other shift that overlaps [start, end), ignoring the given shift ids. */
function overlapping(memberId, start, end, ignoreIds = []) {
  return all("SELECT * FROM shifts WHERE member_id = ? AND status != 'open' AND start < ? AND end > ?", memberId, end, start)
    .find((s) => !ignoreIds.includes(s.id));
}
function assertFree(memberId, start, end, ignoreIds, who) {
  const o = overlapping(memberId, start, end, ignoreIds);
  if (o) fail(409, `${who} already ${who === 'You' ? 'have' : 'has'} a shift on ${fmtShift(o)} that overlaps.`);
}

function checkAssignment(req, memberId, start, end, shiftId = null) {
  if (memberId == null) return 'open';
  const m = one("SELECT * FROM members WHERE id = ? AND group_id = ? AND active = 1", memberId, req.gid);
  if (!m) fail(400, 'That worker is not in this group.');
  if (m.role !== 'worker') fail(400, 'Shifts can only be assigned to workers.');
  assertFree(m.id, start, end, [shiftId], m.name);
  const issue = availabilityIssue(slotsFor(m.id), m.name, start, end);
  if (!issue) return 'assigned';
  if (!req.body.sendAsRequest) fail(409, issue, { conflict: true, issue, workerName: m.name });
  return 'pending';
}

function createAcceptRequest(req, shiftId, memberId, start, end) {
  run(
    `INSERT INTO requests (group_id, type, shift_id, from_member_id, to_member_id, message) VALUES (?, 'accept_shift', ?, ?, ?, ?)`,
    req.gid, shiftId, req.member.id, memberId, str(req.body.message, 500),
  );
  notify(memberId, `${req.member.name} asked if you can work ${fmtShift({ start, end })}. It's outside your usual availability — please accept or decline.`);
}

group.post('/shifts', h((req) => {
  requireManager(req);
  const { start, end } = req.body;
  const memberId = req.body.memberId ? Number(req.body.memberId) : null;
  const err = validateShiftTimes(start, end);
  if (err) fail(400, err);
  const status = checkAssignment(req, memberId, start, end);
  return tx(() => {
    const r = run(
      'INSERT INTO shifts (group_id, member_id, start, end, note, status) VALUES (?, ?, ?, ?, ?, ?)',
      req.gid, memberId, start, end, str(req.body.note, 300), status,
    );
    const id = Number(r.lastInsertRowid);
    if (status === 'pending') createAcceptRequest(req, id, memberId, start, end);
    // Shifts entered after the fact (to record past work) don't need a notification.
    else if (status === 'assigned' && end > nowLocal()) notify(memberId, `New shift: ${fmtShift({ start, end })}.`, 'calendar');
    return { id, status };
  });
}));

group.put('/shifts/:sid', h((req) => {
  requireManager(req);
  const s = one('SELECT * FROM shifts WHERE id = ? AND group_id = ?', Number(req.params.sid), req.gid);
  if (!s) fail(404, 'Shift not found.');
  const start = req.body.start ?? s.start;
  const end = req.body.end ?? s.end;
  const memberId = 'memberId' in req.body ? (req.body.memberId ? Number(req.body.memberId) : null) : s.member_id;
  const err = validateShiftTimes(start, end);
  if (err) fail(400, err);
  const changedWho = memberId !== s.member_id;
  const changedTime = start !== s.start || end !== s.end;
  // Re-check availability only when the worker or the time changes (editing just the note keeps the status).
  let status = s.status;
  if (changedWho || changedTime) status = checkAssignment(req, memberId, start, end, s.id);
  tx(() => {
    run(
      "UPDATE shifts SET member_id = ?, start = ?, end = ?, note = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
      memberId, start, end, str(req.body.note ?? s.note, 300), status, s.id,
    );
    if (changedWho || changedTime || s.status !== status) cancelPendingFor(s.id);
    if (status === 'pending' && (changedWho || changedTime || s.status !== 'pending')) createAcceptRequest(req, s.id, memberId, start, end);
    if (changedWho && s.member_id) notify(s.member_id, `You were taken off the shift on ${fmtShift(s)}.`, 'calendar');
    if (status === 'assigned') {
      if (changedWho) notify(memberId, `New shift: ${fmtShift({ start, end })}.`, 'calendar');
      else if (changedTime) notify(memberId, `Your shift on ${fmtShift(s)} changed to ${fmtShift({ start, end })}.`, 'calendar');
    }
  });
  return { id: s.id, status };
}));

group.delete('/shifts/:sid', h((req) => {
  requireManager(req);
  const s = one('SELECT * FROM shifts WHERE id = ? AND group_id = ?', Number(req.params.sid), req.gid);
  if (!s) fail(404, 'Shift not found.');
  tx(() => {
    run('UPDATE requests SET offer_shift_id = NULL WHERE offer_shift_id = ?', s.id);
    run('DELETE FROM requests WHERE shift_id = ?', s.id);
    run('DELETE FROM shifts WHERE id = ?', s.id);
    if (s.member_id && s.end > nowLocal()) notify(s.member_id, `Your shift on ${fmtShift(s)} was removed.`, 'calendar');
  });
}));

// ---------- requests ----------

const loadShift = (id, gid) => id && one(`SELECT ${SHIFT_COLS} FROM shifts s LEFT JOIN members m ON m.id = s.member_id WHERE s.id = ? AND s.group_id = ?`, id, gid);

group.get('/requests', h((req) => {
  const rows = req.isManager
    ? all('SELECT * FROM requests WHERE group_id = ? ORDER BY id DESC LIMIT 200', req.gid)
    : all('SELECT * FROM requests WHERE group_id = ? AND (from_member_id = ? OR to_member_id = ?) ORDER BY id DESC LIMIT 200', req.gid, req.member.id, req.member.id);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    message: r.message,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    proposedStart: r.proposed_start,
    proposedEnd: r.proposed_end,
    fromMemberId: r.from_member_id,
    toMemberId: r.to_member_id,
    fromName: memberName(r.from_member_id),
    toName: memberName(r.to_member_id),
    shift: loadShift(r.shift_id, req.gid) || null,
    offerShift: loadShift(r.offer_shift_id, req.gid) || null,
  }));
}));

group.post('/requests', h((req) => {
  if (req.isManager) fail(400, 'Managers edit shifts directly instead of sending requests.');
  const { type } = req.body;
  const s = one('SELECT * FROM shifts WHERE id = ? AND group_id = ?', Number(req.body.shiftId), req.gid);
  if (!s) fail(404, 'Shift not found.');
  if (s.start <= nowLocal()) fail(400, 'This shift has already started.');
  const dupe = one(
    "SELECT 1 FROM requests WHERE status = 'pending' AND shift_id = ? AND from_member_id = ? AND type = ?", s.id, req.member.id, type,
  );
  if (dupe) fail(409, 'You already have a pending request for this shift.');
  const message = str(req.body.message, 500);
  const manager = one("SELECT id FROM members WHERE group_id = ? AND role = 'manager' AND active = 1", req.gid);

  if (type === 'change' || type === 'drop') {
    if (s.member_id !== req.member.id || s.status !== 'assigned') fail(403, 'You can only request changes to your own shifts.');
    let ps = null, pe = null;
    if (type === 'change') {
      ps = req.body.proposedStart; pe = req.body.proposedEnd;
      const err = validateShiftTimes(ps, pe);
      if (err) fail(400, err);
      if (ps === s.start && pe === s.end) fail(400, 'Pick a different time from the current one.');
      if (ps <= nowLocal()) fail(400, 'The new time must be in the future.');
      assertFree(req.member.id, ps, pe, [s.id], 'You');
    }
    run(
      `INSERT INTO requests (group_id, type, shift_id, from_member_id, to_member_id, proposed_start, proposed_end, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, req.gid, type, s.id, req.member.id, manager?.id ?? null, ps, pe, message,
    );
    notify(manager?.id, type === 'drop'
      ? `${req.member.name} asked to drop their shift on ${fmtShift(s)}.`
      : `${req.member.name} asked to change their shift on ${fmtShift(s)} to ${fmtShift({ start: ps, end: pe })}.`);
    return;
  }

  if (type === 'trade') {
    if (s.status !== 'assigned' || !s.member_id || s.member_id === req.member.id) fail(400, "You can only request a trade for another worker's shift.");
    let offerId = null;
    if (req.body.offerShiftId) {
      const o = one('SELECT * FROM shifts WHERE id = ? AND group_id = ?', Number(req.body.offerShiftId), req.gid);
      if (!o || o.member_id !== req.member.id || o.status !== 'assigned') fail(400, 'You can only offer one of your own shifts.');
      if (o.start <= nowLocal()) fail(400, 'The shift you are offering has already started.');
      offerId = o.id;
    }
    assertTradeFits(s, offerId && one('SELECT * FROM shifts WHERE id = ?', offerId), req.member.id);
    run(
      `INSERT INTO requests (group_id, type, shift_id, offer_shift_id, from_member_id, to_member_id, message)
       VALUES (?, 'trade', ?, ?, ?, ?, ?)`, req.gid, s.id, offerId, req.member.id, s.member_id, message,
    );
    const o = offerId && one('SELECT * FROM shifts WHERE id = ?', offerId);
    notify(s.member_id, o
      ? `${req.member.name} wants to trade their ${fmtShift(o)} shift for your ${fmtShift(s)} shift.`
      : `${req.member.name} asked to take your shift on ${fmtShift(s)}.`);
    return;
  }
  fail(400, 'Unknown request type.');
}));

/** After a trade, neither worker may end up with overlapping shifts. */
function assertTradeFits(target, offer, requesterId) {
  const ignore = [target.id, offer?.id].filter(Boolean);
  const o1 = overlapping(requesterId, target.start, target.end, ignore);
  if (o1) fail(409, `${memberName(requesterId)} already has a shift on ${fmtShift(o1)} that overlaps this one.`);
  if (offer) {
    const o2 = overlapping(target.member_id, offer.start, offer.end, ignore);
    if (o2) fail(409, `${memberName(target.member_id)} already has a shift on ${fmtShift(o2)} that overlaps the offered shift.`);
  }
}

group.post('/requests/:rid/respond', h((req) => {
  const r = one('SELECT * FROM requests WHERE id = ? AND group_id = ?', Number(req.params.rid), req.gid);
  if (!r) fail(404, 'Request not found.');
  if (r.status !== 'pending') fail(409, 'This request has already been handled.');
  const approve = req.body.action === 'approve';
  const s = one('SELECT * FROM shifts WHERE id = ?', r.shift_id);
  if (!s) fail(410, 'The shift no longer exists.');

  const byManager = r.type === 'change' || r.type === 'drop';
  if (byManager ? !req.isManager : r.to_member_id !== req.member.id) fail(403, 'This request is not yours to answer.');

  const close = (status) => run("UPDATE requests SET status = ?, resolved_at = datetime('now') WHERE id = ?", status, r.id);
  const who = memberName(r.from_member_id);

  tx(() => {
    if (r.type === 'accept_shift') {
      close(approve ? 'approved' : 'declined');
      if (approve) {
        run("UPDATE shifts SET status = 'assigned', updated_at = datetime('now') WHERE id = ?", s.id);
        notifyManagers(req.gid, `${req.member.name} accepted the shift on ${fmtShift(s)}.`);
      } else {
        run("UPDATE shifts SET status = 'open', member_id = NULL, updated_at = datetime('now') WHERE id = ?", s.id);
        notifyManagers(req.gid, `${req.member.name} declined the shift on ${fmtShift(s)}. It is now an open shift.`);
      }
      return;
    }

    if (!approve) {
      close('declined');
      const label = r.type === 'trade' ? 'trade request' : r.type === 'drop' ? 'request to drop' : 'request to change';
      notify(r.from_member_id, `${req.member.name} declined your ${label} for ${fmtShift(s)}.`);
      return;
    }

    if (r.type === 'change') {
      if (s.member_id !== r.from_member_id) fail(409, 'This shift has been reassigned since the request was made.');
      assertFree(r.from_member_id, r.proposed_start, r.proposed_end, [s.id], who);
      run("UPDATE shifts SET start = ?, end = ?, updated_at = datetime('now') WHERE id = ?", r.proposed_start, r.proposed_end, s.id);
      close('approved');
      notify(r.from_member_id, `Approved: your shift on ${fmtShift(s)} is now ${fmtShift({ start: r.proposed_start, end: r.proposed_end })}.`, 'calendar');
    } else if (r.type === 'drop') {
      if (s.member_id !== r.from_member_id) fail(409, 'This shift has been reassigned since the request was made.');
      run("UPDATE shifts SET member_id = NULL, status = 'open', updated_at = datetime('now') WHERE id = ?", s.id);
      cancelPendingFor(s.id, r.id);
      close('approved');
      notify(r.from_member_id, `Approved: you are no longer on the shift on ${fmtShift(s)}.`, 'calendar');
    } else if (r.type === 'trade') {
      if (s.member_id !== req.member.id || s.status !== 'assigned') fail(409, 'This shift is no longer yours.');
      if (s.start <= nowLocal()) fail(409, 'This shift has already started.');
      const o = r.offer_shift_id && one('SELECT * FROM shifts WHERE id = ?', r.offer_shift_id);
      if (r.offer_shift_id && (!o || o.member_id !== r.from_member_id || o.status !== 'assigned' || o.start <= nowLocal())) {
        fail(409, 'The shift offered in exchange is no longer available.');
      }
      assertTradeFits(s, o, r.from_member_id);
      run("UPDATE shifts SET member_id = ?, updated_at = datetime('now') WHERE id = ?", r.from_member_id, s.id);
      if (o) run("UPDATE shifts SET member_id = ?, updated_at = datetime('now') WHERE id = ?", req.member.id, o.id);
      cancelPendingFor(s.id, r.id);
      if (o) cancelPendingFor(o.id, r.id);
      close('approved');
      const summary = o
        ? `${who} and ${req.member.name} traded shifts: ${who} now works ${fmtShift(s)} and ${req.member.name} works ${fmtShift(o)}.`
        : `${req.member.name} gave their shift on ${fmtShift(s)} to ${who}.`;
      notify(r.from_member_id, `${req.member.name} accepted your trade. ${summary}`, 'calendar');
      notifyManagers(req.gid, `Shift change: ${summary}`, 'calendar');
    }
  });
}));

group.post('/requests/:rid/cancel', h((req) => {
  const r = one('SELECT * FROM requests WHERE id = ? AND group_id = ?', Number(req.params.rid), req.gid);
  if (!r || r.from_member_id !== req.member.id || r.type === 'accept_shift') fail(404, 'Request not found.');
  if (r.status !== 'pending') fail(409, 'This request has already been handled.');
  run("UPDATE requests SET status = 'cancelled', resolved_at = datetime('now') WHERE id = ?", r.id);
}));

// ---------- notifications ----------

group.get('/notifications', h((req) => all(
  'SELECT id, text, tab, read, created_at AS createdAt FROM notifications WHERE member_id = ? ORDER BY id DESC LIMIT 50', req.member.id,
).map((n) => ({ ...n, read: !!n.read }))));

group.post('/notifications/read', h((req) => {
  run('UPDATE notifications SET read = 1 WHERE member_id = ?', req.member.id);
}));

// Small payload the client polls for badges.
group.get('/pulse', h((req) => ({
  unread: one('SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read = 0', req.member.id).n,
  actionable: req.isManager
    ? one("SELECT COUNT(*) AS n FROM requests WHERE group_id = ? AND status = 'pending' AND type IN ('change','drop')", req.gid).n
    : one("SELECT COUNT(*) AS n FROM requests WHERE group_id = ? AND status = 'pending' AND to_member_id = ?", req.gid, req.member.id).n,
  lastMessageId: visibleMessages(req, 'SELECT MAX(id) AS n FROM messages WHERE group_id = ?').n ?? 0,
})));

// ---------- messages ----------

function visibleMessages(req, sql) {
  if (req.isManager) return one(sql, req.gid);
  return one(`${sql} AND (conv = 'team' OR conv LIKE ? OR conv LIKE ?)`, req.gid, `dm:${req.member.id}:%`, `dm:%:${req.member.id}`);
}
const dmKey = (a, b) => `dm:${Math.min(a, b)}:${Math.max(a, b)}`;

function canRead(req, conv) {
  if (conv === 'team' || req.isManager) return true;
  const m = /^dm:(\d+):(\d+)$/.exec(conv);
  return !!m && (Number(m[1]) === req.member.id || Number(m[2]) === req.member.id);
}

group.get('/conversations', h((req) => {
  const last = (conv) => one(
    `SELECT m.body, m.created_at AS createdAt, m.id, mb.name FROM messages m JOIN members mb ON mb.id = m.member_id
     WHERE m.group_id = ? AND m.conv = ? ORDER BY m.id DESC LIMIT 1`, req.gid, conv,
  ) ?? null;
  const list = [{ conv: 'team', title: 'Team chat', last: last('team') }];
  if (req.isManager) {
    for (const { conv } of all("SELECT DISTINCT conv FROM messages WHERE group_id = ? AND conv LIKE 'dm:%'", req.gid)) {
      const [, a, b] = conv.split(':').map(Number);
      list.push({ conv, title: `${memberName(a)} & ${memberName(b)}`, last: last(conv) });
    }
  } else {
    const others = all(
      "SELECT id, name, color FROM members WHERE group_id = ? AND active = 1 AND role = 'worker' AND user_id IS NOT NULL AND id != ? ORDER BY name COLLATE NOCASE",
      req.gid, req.member.id,
    );
    for (const o of others) {
      const conv = dmKey(req.member.id, o.id);
      list.push({ conv, title: o.name, color: o.color, last: last(conv) });
    }
  }
  return list.sort((a, b) => (a.conv === 'team' ? -1 : b.conv === 'team' ? 1 : (b.last?.id ?? 0) - (a.last?.id ?? 0)));
}));

group.get('/messages', h((req) => {
  const conv = str(req.query.conv, 40);
  if (!canRead(req, conv)) fail(403, 'You cannot read this conversation.');
  return all(
    `SELECT m.id, m.body, m.created_at AS createdAt, m.member_id AS memberId, mb.name, mb.color
     FROM messages m JOIN members mb ON mb.id = m.member_id WHERE m.group_id = ? AND m.conv = ? ORDER BY m.id DESC LIMIT 300`,
    req.gid, conv,
  ).reverse();
}));

group.post('/messages', h((req) => {
  if (req.isManager) fail(403, 'Managers can read messages but not send them.');
  const conv = str(req.body.conv, 40);
  const body = str(req.body.body, 2000);
  if (!body) fail(400, 'Type a message first.');
  if (!canRead(req, conv)) fail(403, 'You cannot post in this conversation.');
  if (conv !== 'team') {
    const [, a, b] = conv.split(':').map(Number);
    const other = a === req.member.id ? b : a;
    if (!one("SELECT 1 FROM members WHERE id = ? AND group_id = ? AND active = 1 AND role = 'worker'", other, req.gid)) fail(400, 'That person is no longer in the group.');
  }
  run('INSERT INTO messages (group_id, conv, member_id, body) VALUES (?, ?, ?, ?)', req.gid, conv, req.member.id, body);
}));

// ---------- history ----------

group.get('/history', h((req) => {
  const params = [req.gid, nowLocal()];
  let where = "s.group_id = ? AND s.end <= ? AND s.status = 'assigned' AND s.member_id IS NOT NULL";
  if (req.query.memberId) { where += ' AND s.member_id = ?'; params.push(Number(req.query.memberId)); }
  if (/^\d{4}-\d{2}$/.test(req.query.month || '')) { where += ' AND substr(s.start, 1, 7) = ?'; params.push(req.query.month); }
  return all(`SELECT ${SHIFT_COLS} FROM shifts s JOIN members m ON m.id = s.member_id WHERE ${where} ORDER BY s.start DESC LIMIT 2000`, ...params);
}));

api.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
