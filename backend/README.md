# Feedback API

Node.js (Express) API for the event site, the feedback form, the admin panel and the lucky draw. One copy of the code serves every event. Each event has its own settings file and its own MySQL database, and each database can have its own server and login.

## Events

Every event is one entry in `events.json`, keyed by its code. The code is the first part of every address, `/dle26/feedback-form` on the site and `/api/events/dle26/...` on the API.

- The key is the event code, lower case letters, digits and dashes.
- `database` is the event's own MySQL database. Every event needs a different one. Its login is in `databases.json`, see below.
- `active` set to `false` hides the event without deleting anything.
- `media.successIcon` is the tick shown after feedback is sent.
- `speakerReviews` is optional, `{ "maxPerDay": 3, "titleMaxWords": 7 }` by default. `maxPerDay` is how many speaker sessions an attendee can review on each day of the agenda (1 to 50), checked by the form and again on submit. `titleMaxWords` is the most words in the AI shortened session titles (3 to 20). The agenda is read from `links.agendaApi`, or `<website link>/api/agenda` when that is not set.
- `event_code` is the event's code in the iQ Hub CRM, such as `"AIU - AD"`. The registered attendee list is copied from the CRM's registered delegates API for this code, using `CRM_DATA_API_KEY` from `.env`. See "Attendees from the CRM" below.
- The name, tagline, colour, media, links and Wi-Fi are set on the admin Event Details page, see below. They can still be written here for a new event, and are then copied to the page the first time.
- The entry, with the Event Details in place, is sent to the site by `GET /api/events/<code>/`. The database name is never sent. Do not put passwords or private keys in an event entry, the site shows its contents.

```json
{
  "dle26": { "database": "feedback_db", "active": true, "media": { "successIcon": "/images/common/checked.png" } },
  "afs26": { "database": "feedback_afs26", "media": { "successIcon": "/images/common/checked.png" } }
}
```

Copy the `dle26` entry as a starting point.

## Event Details in the admin panel

The name, tagline, theme colour (`theme.secondary`), media (`logo`, `favicon`, `heroVideoMp4`, `heroVideoWebm`, `heroPoster`, `background`, `venueLogo`, `wifiQr`), the website link (`links.website`) and Wi-Fi (`network`, `password`) are edited on the admin **Event Details** page, `/<code>/admin/event-details`. They are kept in the `event_details` table of the event's own database. The first time an event is read, or on `npm run migrate`, that row is copied from the event's entry in `events.json`. After that the admin page decides, and changing those keys in `events.json` has no effect. Keys the page does not manage, such as `media.successIcon` and `links.agendaApi`, still come from `events.json`.

The same page manages the home page menu, the `menu_items` table. Each item has a label, an icon, a sort no. (lowest first), a visible switch and what it opens, a page of the event such as `/feedback-form` or a full URL. New events start with the six standard items. The agenda and LinkedIn items take their address from `links.agenda` and `links.linkedin` in `events.json` and are left out when those are not set. The website item follows the Website link until its address is changed. Databases made before the agenda and LinkedIn links left the page are moved over by `npm run migrate`, which writes each address into its menu item.

Images and videos uploaded on the page are saved in `UPLOADS_DIR`, `backend/uploads` by default, one folder per event, and served at `/api/uploads/<code>/<file>`. Images can be up to 10 MB and videos up to 100 MB. On a host that wipes its disk on redeploy, point `UPLOADS_DIR` at a persistent volume.

## Attendees from the CRM

The attendee list is no longer imported from a CSV; it comes from the CRM. The delegates are copied into the event's `attendees` table, because the feedback form, the submissions and the lucky draw all point at an attendee row.

- The CRM publishes the list once, so it is fetched once. The first visitor to the site starts the sync, and the Registered Attendees page and the feedback form wait for it. The time and count are saved in `form_settings` (`crm_synced_at`, `crm_synced_count`), so later visits, restarts and redeploys never call the CRM again.
- If the CRM fails, or has no delegates for the code yet, nothing is saved and a visit at least a minute later tries again.
- To fetch the list again, an admin presses **Sync now** on the admin **Attendees** page.
- Run `npm run migrate` after deploying this change, it adds the two `form_settings` columns.
- A delegate is matched by email, or by name and company when the CRM has no email. A matched attendee takes the CRM's name and company.
- An attendee the CRM no longer lists is removed, unless they have submitted feedback. Walk-ins added on the feedback form are never removed.
- If the CRM fails, or returns an empty list, the saved list is left as it is.

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
2. Run `npm run migrate -- --event <code>`, then restart the API.
3. Sign in at `/<code>/admin/login` and fill in **Event Details**, uploading the logo, videos and images there.
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
