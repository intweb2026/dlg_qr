# Feedback API

Node.js (Express) API for the event site, the feedback form, the admin panel and the lucky draw. One copy of the code serves every event. Each event has its own settings file and its own MySQL database, and each database can have its own server and login.

## Events

Every event is one entry in `events.json`, keyed by its code. The code is the first part of every address, `/dle26/feedback-form` on the site and `/api/events/dle26/...` on the API.

- The key is the event code, lower case letters, digits and dashes.
- `database` is the event's own MySQL database. Every event needs a different one. Its login is in `databases.json`, see below.
- `active` set to `false` hides the event without deleting anything.
- Everything else, name, media, links and Wi-Fi, is sent to the site by `GET /api/events/<code>/`. The database name is never sent. Do not put passwords or private keys in an event entry, the site shows its contents.

```json
{
  "dle26": { "database": "feedback_db", "name": "Direct Lithium Extraction 2026", "media": { ... } },
  "afs26": { "database": "feedback_afs26", "name": "...", "media": { ... } }
}
```

Copy the `dle26` entry as a starting point.

## Database logins

`databases.json` holds the login for every event database, keyed by the database name from `events.json`. Each database can sit on a different server with a different user.

```json
{
  "feedback_db": { "host": "127.0.0.1", "port": 3306, "user": "root", "password": "..." },
  "feedback_afs26": { "host": "db2.your-domain.com", "port": 3306, "user": "afs26_user", "password": "..." }
}
```

The file is ignored by git, so passwords never reach GitHub. Copy `databases.example.json` to start one on a new server. The API stops at start up when an active event has no login. The user needs rights to create its database for `npm run migrate`, or create the database first.

## Run it

Node 24.2 or newer and MySQL 8.

```
cp .env.example .env
cp databases.example.json databases.json   # then fill in each database's login
npm install
npm run migrate           # creates each event's database, tables, settings row and default admins
npm start                 # http://localhost:8000/api/events/<code>/
```

Use `npm run dev` to restart on file changes. Restart the API after changing `events.json`.

## Add an event

1. Add an entry to `events.json` with a new code as its key and a new `database`, and add that database's login to `databases.json`.
2. Put its media in `public/images/<code>/` and `public/videos/<code>/` in the site, and point `media` at them.
3. Run `npm run migrate -- --event <code>`, then restart the API.
4. Open `/<code>` on the site.

## Commands

Every command except `migrate` needs `--event <code>`.

| Command | What it does |
| --- | --- |
| `npm run migrate` | Creates missing databases and tables for every event, safe to run again. Add `-- --event <code>` for one event |
| `npm run seed:attendees -- --event <code> --count 50` | Adds sample attendees |
| `npm run seed:demo -- --event <code> --attendees 100 --feedback 50` | Adds demo attendees and feedback |
| `npm run admin-user -- --event <code> list` | Lists the event's admin accounts |
| `npm run admin-user -- --event <code> set <username> --password <pw> [--name <name>]` | Creates an account or changes its password or name |
| `npm run admin-user -- --event <code> disable <username>` | Blocks sign in and signs the account out everywhere, `enable` undoes it |
| `npm test` | Runs the API tests on temporary databases for the test events in `test/events.json`, with the login of the first entry in `databases.json` |

Admin accounts belong to one event, because each event has its own database. A new event database gets four admin accounts, benny, maxwell, nolan and ramon, with the password `<username>123`. Change them with `admin-user set` before the event.

## Production

Run `npm start` under a process manager such as pm2 or systemd, behind a reverse proxy that serves HTTPS. Set `DEBUG=False`, `ALLOWED_HOSTS` to the API's host name, and `CORS_ALLOWED_ORIGINS` to the site that serves the React app.
