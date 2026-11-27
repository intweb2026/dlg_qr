# Feedback API

Node.js (Express) API for the event site, the feedback form, the admin panel and the lucky draw. One copy of the code serves every event. Each event has its own settings file and its own MySQL database, and each database can have its own server and login.

## Events

Every event is one entry in `events.json`, keyed by its code. The code is the first part of every address, `/<code>/feedback-form` on the site and `/api/events/<code>/...` on the API.

- The key is the event code, lower case letters, digits and dashes.
- `database` is the event's own MySQL database. Every event needs a different one. Its login is in `databases.json`, see below.
- `active` set to `false` hides the event without deleting anything.
- `media.successIcon` is the tick shown after feedback is sent.
- The feedback form opens by itself at 12:00 AM of the event's first day where the event is held, and then never closes. The first day is the earliest day heading in the website's agenda and the time zone comes from the website's `event_Location`, the same as the CRM sync below. Before then the form says when it opens and the API refuses the attendee list and submissions with code `not_open`. Set `"eventStartDate": "YYYY-MM-DD"` or `"timeZone": "Area/City"` (an IANA time zone name) on the event to give them yourself. When the first day cannot be told, the form is open. The admin Feedback submissions page has an "Open automatically when the event starts" switch (`form_open_auto` in `form_settings`, off by default, so the form is open unless an admin closes it). Turn it off and the form is open right away with no condition, the fallback if the automatic opening ever goes wrong. Any error while working out the opening time also leaves the form open. The same panel has Open form and Close form. Close form (`form_closed` in `form_settings`) shuts the form whatever the date, attendees see that it is closed and the API refuses with code `closed`, until an admin opens it again. Open form undoes a close, or before the event starts turns the automatic opening off. The raffle draw never closes the form. Run `npm run migrate` once to add the columns to existing databases.
- The day after an event's last day, at 12:00 AM where it is held, the server emails one PDF with every submission (the attendee's details and their answers to every question, suspended ones marked) to the addresses in `FEEDBACK_REPORT_TO`, a comma separated list set in the environment, with no default. The server looks every hour, sends it once per event (`form_settings.report_sent_at`), tries again an hour later when the send fails, and only sends by itself within 7 days of that time, so an old event is not emailed after a late deploy. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`, see `.env.example`. The email body and the first page of the PDF give the total, registered and not registered attendee counts (the not registered are walk-ins added on the feedback form), the submission count and the number not submitted, and the raffle draw winners in the order they were drawn, with their entry number and draw time. The email text is written in `emailBody()` in `src/feedbackReport.js`. The admin Feedback submissions page shows when it goes out, downloads the PDF and has Send now as the backup. Only active events are sent.
- `speakerReviews` is optional, `{ "maxReviews": 3, "titleMaxWords": 7 }` by default. `maxReviews` is how many speaker sessions an attendee can review in all, whatever the day (1 to 50), checked by the form and again on submit. `titleMaxWords` is the most words in the AI shortened session titles (3 to 20). The agenda is read from `links.agendaApi`, or `<website link>/api/agenda` when that is not set.
- `event_code` is the event's code in the CRM, for example `"ABC - XY"`. The registered attendee list is copied from the CRM's registered delegates API for this code, using `CRM_DATA_API_KEY` from `.env`. See "Attendees from the CRM" below.
- The name, tagline, colour, media, links and Wi-Fi are set on the admin Event Details page, see below. They can still be written here for a new event, and are then copied to the page the first time.
- The entry, with the Event Details in place, is sent to the site by `GET /api/events/<code>/`. The database name is never sent. Do not put passwords or private keys in an event entry, the site shows its contents.

```json
{
  "event1": { "database": "feedback_event1", "active": true, "media": { "successIcon": "/common/images/checked.png" } },
  "event2": { "database": "feedback_event2", "media": { "successIcon": "/common/images/checked.png" } }
}
```

Copy the first entry as a starting point.

## Event Details in the admin panel

The name, tagline, theme colour (`theme.secondary`), media (`logo`, `favicon`, `heroVideoMp4`, `heroVideoWebm`, `heroPoster`, `background`, `venueLogo`, `wifiQr`), the website link (`links.website`) and Wi-Fi (`network`, `password`, `security`, `hidden`) are edited on the admin **Event Details** page, `/<code>/admin/event-details`. They are kept in the `event_details` table of the event's own database. The first time an event is read, or on `npm run migrate`, that row is copied from the event's entry in `events.json`. After that the admin page decides, and changing those keys in `events.json` has no effect. Keys the page does not manage, such as `media.successIcon` and `links.agendaApi`, still come from `events.json`.

The same page manages the home page menu, the `menu_items` table. Each item has a label, an icon, a sort no. (lowest first), a visible switch and what it opens, a page of the event such as `/feedback-form` or a full URL. New events start with the six standard items. The agenda and LinkedIn items take their address from `links.agenda` and `links.linkedin` in `events.json` and are left out when those are not set. The website item follows the Website link until its address is changed. Databases made before the agenda and LinkedIn links left the page are moved over by `npm run migrate`, which writes each address into its menu item.

Images and videos uploaded on the page are saved in `UPLOADS_DIR`, `backend/uploads` by default, one folder per event, and served at `/api/uploads/<code>/<file>`. Images can be up to 10 MB and videos up to 100 MB. On a host that wipes its disk on redeploy, point `UPLOADS_DIR` at a persistent volume. Every upload gets a new name, and a file that no media field or menu icon holds any more is deleted when the change is saved, so replacing or removing a file, or deleting a menu item, leaves no copy behind. This includes the Wi-Fi QR code. A file uploaded but never saved is deleted by the next save once it is an hour old (`timing.uploads.orphanGrace` in `src/config.js`). Only plain file names in the event's own folder are ever deleted.

## Attendees from the CRM

The attendee list is no longer imported from a CSV; it comes from the CRM. The delegates are copied into the event's `attendees` table, because the feedback form, the submissions and the lucky draw all point at an attendee row.

- The first visitor to the site starts the first sync, and the Registered Attendees page and the feedback form wait for it. The time and count are saved in `form_settings` (`crm_synced_at`, `crm_synced_count`), so restarts and redeploys do not fetch it again straight away.
- After that the list is fetched again every 24 hours until the event's last day is over, so late registrations reach the form. A visit starts it in the background once the last sync is 24 hours old. The last day is the latest day heading in the website's agenda (the same `/api/agenda` the session question uses). The sync stops at 11:59 PM of that day where the event is held: the time zone comes from the website's `event_Location`, so a location such as "City, State, Country" stops at 11:59 PM in that place's time zone, not the server's. Set `"eventEndDate": "YYYY-MM-DD"` or `"timeZone": "Area/City"` on the event in `events.json` to give them yourself. With no time zone known, the sync runs until 36 hours after the last day starts in UTC. When the last day cannot be told, there is no daily sync.
- If the CRM fails, or has no delegates for the code yet, nothing is saved and a visit at least a minute later tries again.
- To fetch the list again, an admin presses **Sync now** on the admin **Attendees** page.

### Event dates

Several things depend on the event's dates, the feedback form opening, when the daily sync stops and the day the report is emailed. The dates are read from the event website (its agenda for the first and last day, its page data for the location and so the time zone), not from the CRM, and a value set in `events.json` (`eventStartDate`, `eventEndDate`, `timeZone`) wins over the website. They are read once a day, together with the delegates, every time the CRM sync runs, the first one, the daily one and Sync now. The admin panel shows them in an **Event dates** panel at the top of the Event Details page, with where each value came from, the times that follow from them, when they were last read and when they are read again, and **Refresh now** reads them at once. A read that fails keeps the dates last read and tries again in 10 minutes, and shows why. Saving a different website link there reads the dates from the new site at once. Every read is in the Logbook. The dates are held in the API's memory, so a restart reads them again.
- Run `npm run migrate` after deploying this change, it adds the two `form_settings` columns.
- A delegate is matched by email, or by name and company when the CRM has no email. A matched attendee takes the CRM's name and company.
- An attendee the CRM no longer lists is removed, unless they have submitted feedback. Walk-ins added on the feedback form are never removed.
- If the CRM fails, or returns an empty list, the saved list is left as it is.

## Database logins

`databases.json` holds the login for every event database, keyed by the database name from `events.json`. Each database can sit on a different server with a different user.

```json
{
  "feedback_event1": { "host": "127.0.0.1", "port": 3306, "user": "root", "password": "..." },
  "feedback_event2": { "host": "db2.your-domain.com", "port": 3306, "user": "event2_user", "password": "..." }
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
| `npm run admin-user -- --event <code> set <username> --password <pw> [--name <name>] [--role admin\|support]` | Creates an account or changes its password, name or role. A new role signs the account out |
| `npm run admin-user -- --event <code> disable <username>` | Blocks sign in and signs the account out everywhere, `enable` undoes it |
| `npm test` | Runs the API tests on temporary databases for the test events in `test/events.json`, with the login of the first entry in `databases.json` |

Admin accounts belong to one event, because each event has its own database. A new event database gets the admin accounts listed in `DEFAULT_ADMINS`, one list in `src/config.js` that `npm run migrate` reads, set it in the environment to use your own. Change the passwords with `admin-user set` before the event.

## Logbook

Everything the app sends out or asks of another service is logged, one row per attempt, in the event's own database (`logbook`) and shown on the admin **Logbook** page, `/<code>/admin/logbook`, to admins only.

| Type | What | Started by |
| --- | --- | --- |
| `crm_webhook` | The feedback responses posted to `CRM_WEBHOOK_URL` | A lucky draw spin |
| `crm_sync` | The registered delegates read from the CRM | The first visit, the daily sync, or an admin pressing Sync now |
| `email` | The feedback submissions report | The automatic send, or an admin pressing Send now |
| `gemini` | The AI suggestions on the feedback form | The feedback form |
| `event_dates` | The event's dates and location read from its website | The CRM sync, or an admin pressing Refresh now |

Each row has the time (UTC in the database), the address or the people it went to, the HTTP status, how long it took, a short summary, the other side's reply cut to 1000 characters, the error when it failed, and what started it. The API keys, the attendees' answers, the text typed by attendees and the delegates themselves are never stored. A row that cannot be written is only reported in the server log, it never stops the call it describes. Rows older than 90 days (`timing.logbook.keepFor` in `src/config.js`) are deleted. Reading the website's agenda is not logged. `GET /api/events/<code>/admin/logbook/` takes `kind`, `ok` (1 or 0), `limit` and `before` (a row id, to page back). `npm run migrate` makes the table.

## Time zones

Every time in the database and in the API is UTC. Every time a person reads is in the event's time zone, the one the event dates use (see "Event dates" above): the admin panel shows each time as `Nov 25, 2026, 2:08 PM PST`, the feedback submissions PDF states its zone in the header, and the PDF's file name carries its date and time in that zone too. The zone is sent to the site as `event_time_zone` in `GET /api/events/<code>/`. When the zone is not known the browser's zone is used in the panel and UTC in the PDF and its file name.

## Users and roles

Every admin account has one role, kept in `admin_users.role` (run `npm run migrate` to add the column, existing accounts become `admin`). Admins manage accounts on the admin **Users** page, `/<code>/admin/users`.

| Role | Can do |
| --- | --- |
| `admin` | Every admin screen, including Users |
| `support` | For the person on the floor. Only reads and changes the Wi-Fi network and password, on `/<code>/admin/wifi` |

The roles are enforced by the API, not only hidden in the menu. An admin route answers 403 to a support user unless it is the Wi-Fi route (`GET` and `PATCH /admin/wifi/`, which only reads the `network` and `password` keys). A new route is closed to the support user unless it uses `requireStaff` in `src/routes.js`. The roles are listed in `src/roles.js`.

- When the network name, the password, the security type or the hidden setting is saved, on the Event Details page or on the Wi-Fi screen, the server makes the Wi-Fi QR code again and saves it in `UPLOADS_DIR/<code>/wifi-qr-<hash>.png`. There is no button for it and a page cannot set it. The admin chooses Security, WPA (also for WPA2 and WPA3, the default), WEP or None for an open network, and a Hidden network tick, on the Event Details page, stored in `event_details.wifi_security` and `wifi_hidden` (run `npm run migrate` to add them). A blank password is always an open network. The Wi-Fi screen of a support user changes the network and password only. The earlier code made by the server is deleted, files an admin uploaded are never touched. Keep `UPLOADS_DIR` on a persistent volume or the picture is lost on redeploy.
- Changing a user's role or password, or disabling them, signs them out at once. Deleting a user does too.
- An admin cannot change their own role, disable or delete themselves, so the panel always has an admin.
- Passwords are at least 8 characters. Usernames are letters, digits, dots, dashes and underscores, 3 to 150 characters.
- The raffle draw page at `/<code>/raffle-draw` needs no sign in and is not part of the admin panel.

## Production

Run `npm start` under a process manager such as pm2 or systemd, behind a reverse proxy that serves HTTPS. Set `DEBUG=False`, `ALLOWED_HOSTS` to the API's host name, and `CORS_ALLOWED_ORIGINS` to the site that serves the React app.
