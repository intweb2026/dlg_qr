# Feedback API

Node.js (Express) API for the feedback form, admin panel and lucky draw in `src/feedback`. It replaces the old Django backend and keeps the same `/api/...` routes, responses and MySQL tables, so an existing database works as it is.

## Run it

Node 20 or newer and MySQL 8.

```
cp .env.example .env      # then fill in the MySQL details
npm install
npm run migrate           # creates missing tables, the settings row and the default admins
npm start                 # http://localhost:8000/api
```

Use `npm run dev` to restart on file changes.

## Commands

| Command | What it does |
| --- | --- |
| `npm run migrate` | Creates missing tables from `db/schema.sql`, safe to run again |
| `npm run seed:attendees -- --count 50` | Adds sample attendees |
| `npm run seed:demo -- --attendees 100 --feedback 50` | Adds demo attendees and feedback |
| `npm run admin-user -- list` | Lists admin accounts |
| `npm run admin-user -- set <username> --password <pw> [--name <name>]` | Creates an account or changes its password or name |
| `npm run admin-user -- disable <username>` | Blocks sign in and signs the account out everywhere, `enable` undoes it |
| `npm test` | Runs the API tests on a temporary `<DB_NAME>_test` database |

A fresh database gets four admin accounts, benny, maxwell, nolan and ramon, with the password `<username>123`. Change them with `admin-user set` before the event.

## Production

Run `npm start` under a process manager such as pm2 or systemd, behind a reverse proxy that serves HTTPS. Set `DEBUG=False`, `ALLOWED_HOSTS` to the API's host name, and `CORS_ALLOWED_ORIGINS` to the site that serves the React app.
