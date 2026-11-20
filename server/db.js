import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_FILE || path.resolve('data/shift-manager.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- A member is a seat in a group. Invited people have a phone but no user yet;
-- the seat is claimed when someone joins with that phone number.
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager','worker')),
  color TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, phone)
);
-- start/end are local wall-clock times: 'YYYY-MM-DDTHH:MM'
-- status: assigned | pending (waiting for worker to accept) | open (no worker)
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id),
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'assigned',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS shifts_group_start ON shifts(group_id, start);
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start TEXT NOT NULL,
  end TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS availability_notes (
  member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT ''
);
-- type: change | drop | trade | accept_shift
-- status: pending | approved | declined | cancelled
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
  offer_shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  from_member_id INTEGER REFERENCES members(id),
  to_member_id INTEGER REFERENCES members(id),
  proposed_start TEXT,
  proposed_end TEXT,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  tab TEXT NOT NULL DEFAULT 'requests',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- conv: 'team' or 'dm:<memberIdLow>:<memberIdHigh>'
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  conv TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(group_id, conv, id);
`);

// ---- migrations for databases created by earlier versions ----
const memberCols = db.prepare('PRAGMA table_info(members)').all().map((c) => c.name);
if (!memberCols.includes('is_owner')) {
  // The owner is the person who created the group; other managers are co-managers.
  db.exec("ALTER TABLE members ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE members SET is_owner = 1 WHERE role = 'manager'");
}

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
