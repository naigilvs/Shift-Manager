# Shift-Manager

A shift scheduling app for workplaces. Managers build the schedule; workers see everyone's shifts, ask for changes, trade with each other and chat.

## Features

- **Create or join** – The start page offers *Create a group* or *Join a group*.
  - **Create**: name the group and optionally add people by phone number. You become the manager and get a 6‑character join code. You can add more people later from the Team tab.
  - **Join**: enter the code. If the manager added your phone number, you're matched to that spot automatically, along with any shifts already scheduled for you.
- **Calendar** – Week and month views of everyone's shifts, colour-coded per worker, with filters.
  - The **manager** adds, edits, reassigns and deletes shifts, or leaves them as *open shifts*.
  - Tap **your own shift** to *request a change* (new time) or *request to drop* it. These go to the manager.
  - Tap **a coworker's shift** to *request a trade*: offer one of your shifts in exchange, or ask to take theirs. The coworker accepts or declines. If shifts change, the manager is notified.
- **Availability** – Workers set their usual weekly hours. If the manager schedules someone outside them, the app warns first and can send the shift as a request. The worker then accepts or declines; a declined shift becomes open.
- **No double-booking** – Shifts, change requests and trades that would overlap a worker's other shifts are refused.
- **Messages** – A team chat plus direct messages between workers. The manager can read every conversation but can't send or edit messages.
- **History** – Every completed shift, grouped by date. Filter by worker and month, with shift counts and total hours.
- **Notifications** – A bell shows new requests, approvals, trades and schedule changes. Data refreshes every few seconds.

## Running it

Requires **Node.js 22.13+** (it uses Node's built-in SQLite).

```bash
npm install
npm run dev        # http://localhost:3000 (API + React app with hot reload)
```

Production:

```bash
npm run build
npm start          # serves the built app and API on PORT (default 3000)
```

Data is stored in `data/shift-manager.db`. Set `DB_FILE` to use a different path.

## Tests

```bash
npm test
```

This starts the server on an in-memory database and runs through the full workflow: create, join, availability warnings, accept, change, trade, drop, overlap checks, messages and history.

## Project layout

```
server/
  index.js   Express server (Vite middleware in dev, static files in prod)
  api.js     REST API: auth, groups, shifts, requests, messages, history
  logic.js   Availability checks, date helpers, password hashing
  db.js      SQLite schema
client/src/
  Start.jsx        Create / Join / Log in
  Shell.jsx        Header, tabs, notifications, polling
  Calendar.jsx     Week & month calendar
  ShiftDialog.jsx  Shift editor (manager) and change/drop/trade/accept dialogs (workers)
  Requests.jsx     Request inbox
  Messages.jsx     Team chat and DMs
  History.jsx      Completed shifts by date
  Team.jsx         Join code, people, availability
```

## Notes and limits

- Sign-in uses phone number + password. Phone numbers are **not verified by SMS**, and nobody is texted an invite: the manager shares the join code (the Team tab has a *Copy invite message* button).
- Updates arrive by polling every 5 seconds, not push notifications.
- All times are in the workplace's local time.
