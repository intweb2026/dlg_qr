# Deployment guide

From zero to live. The same steps work for any event; replace the placeholders in angle brackets with your own values.

| Placeholder | Meaning |
| --- | --- |
| `<code>` | The event code, the first part of every page address |
| `<site>` | The public address of the React site, for example `https://events.your-domain.com` |
| `<api>` | The public address of the API, for example `https://api.your-domain.com` |
| `<db>` | The MySQL database name of the event, for example `feedback_event1` |

## 1. Overview

The project has two applications and one MySQL server. Each application is built and deployed on its own.

| Part | Folder | Technology | Output |
| --- | --- | --- | --- |
| Front end | `frontend/` | React 18, built with react-scripts | Static files in `frontend/build/` |
| Back end | `backend/` | Node.js 24 and Express 5 | A running API, port set by `PORT` |
| Database | MySQL 8 server | One database per event | Nine tables per event |

Visitors open the static site. The site calls the API at the address in `REACT_APP_API_URL`. The API reads and writes the event's database. The event is chosen by the code at the start of the page address.

### Page addresses

| Page | Address |
| --- | --- |
| Event home menu | `<site>/<code>` |
| Feedback form | `<site>/<code>/feedback-form` |
| Raffle draw, for the venue screen | `<site>/<code>/raffle-draw` |
| Wi-Fi details | `<site>/<code>/wifipassword` |
| Admin sign in | `<site>/<code>/admin/login` |
| API | `<api>/api/events/<code>/` |
| Health check | `<api>/api/health` |

The bare address `<site>/` shows a 500 page by design. An unknown code shows "Event not found". The raffle draw page is open to anyone who has the link, by design.

### What lives where

| Thing | Where it is kept |
| --- | --- |
| Event name, colour, media paths, links, Wi-Fi, menu | The event database, edited on the admin Event Details page |
| Which events exist, their database names and CRM codes | `backend/events.json` |
| Database logins | `backend/databases.json`, or the `DATABASES_JSON` variable |
| API settings and secrets | `backend/.env`, or the host's environment |
| Media shipped with the site | `frontend/public/events/<code>/{images,videos}` and `frontend/public/common/images` |
| Media uploaded in the admin panel, and the Wi-Fi QR | `UPLOADS_DIR` on the API server, which must be a persistent disk |

The database holds the event content, so a new deployment needs the migration for the structure and either a database dump or a first fill in the admin panel for the content.

## 2. Prerequisites

| Item | Requirement |
| --- | --- |
| Node.js | 24 or newer, on the build machine and on the API server |
| MySQL | Version 8. The schema uses the `utf8mb4_0900_ai_ci` collation, so MySQL 5.7 and MariaDB do not work |
| MySQL user | Permission to create a database, or an empty database already made for it |
| Front end hosting | Any static host that can send every path to `index.html` |
| API hosting | A server that keeps a Node process running, with a persistent disk for uploads. A VM with pm2 or systemd, a container platform, Railway or Render all work. `backend/nixpacks.toml` pins Node 24 for Nixpacks platforms |
| Domains | One for the site and one for the API, both with HTTPS. A single domain with `/api` proxied to the API also works |
| Secrets to prepare | The MySQL password, an `EXPORT_ACCESS_TOKEN`, the CRM keys, optionally a Gemini key and SMTP details |

## 3. Prepare the code

Do these once, before the first deploy.

1. Get the project onto the build machine and the API server. Do not copy `node_modules`, `build` or log files. A clean copy from git is best, `git archive --format=zip --output handover.zip HEAD`.
2. Open `backend/events.json`. Each event is one entry, keyed by its code.

   ```json
   {
     "<code>": {
       "database": "<db>",
       "event_code": "<the event code used in the CRM>",
       "active": true,
       "media": { "successIcon": "/common/images/checked.png" }
     }
   }
   ```

   The file holds no secrets. The database name here must match the key in the login file (step 5).
3. Confirm the media shipped with the site exists under `frontend/public/events/<code>/` and `frontend/public/common/images/`.
4. Plan the files that hold secrets. They are made on the server only and never committed. `backend/databases.json` holds the database login, and `backend/.env` holds the API settings.

## 4. Database

Choose one path.

**Path A, let the migration create everything (recommended).** Make a MySQL user that is allowed to create databases, then go on to step 5. The migration in step 8 creates the database and tables.

**Path B, make the empty database first.** Run this as a MySQL admin.

```sql
CREATE DATABASE <db> CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'feedback_user'@'%' IDENTIFIED BY 'a-strong-password';
GRANT ALL PRIVILEGES ON <db>.* TO 'feedback_user'@'%';
FLUSH PRIVILEGES;
```

The tables are still made by the migration. A managed MySQL service can make the database and user for you, copy its host name, port, user and password into the login file.

### The tables

`backend/db/schema.sql` holds all nine tables.

| Table | Holds |
| --- | --- |
| `admin_users` | Admin panel accounts and their role, `admin` or `support` |
| `admin_tokens` | Signed in sessions |
| `attendees` | The registered delegates |
| `feedback_submissions` | The feedback answers |
| `form_settings` | The form status, schedule and questions settings |
| `lucky_draw_winners` | Raffle winners |
| `event_details` | The event name, colour, media paths, links and Wi-Fi |
| `menu_items` | The home page menu |
| `logbook` | The log of everything sent to the CRM, email and Gemini |

## 5. Back end

Work inside `backend/`.

1. Install the packages.

   ```
   cd backend
   npm ci --omit=dev
   ```

2. Give the API its database login. The key must be exactly the `database` value from `events.json`. Use either a file, `backend/databases.json`, or the `DATABASES_JSON` variable with the same JSON on one line. The variable wins when both exist.

   ```json
   {
     "<db>": {
       "host": "your-mysql-host",
       "port": 3306,
       "user": "feedback_user",
       "password": "a-strong-password"
     }
   }
   ```

   See `backend/databases.example.json`. The path of the file can be changed with `DATABASES_FILE`.
3. Make `backend/.env` from the template and fill it in (step 7), or set the same variables in the host's dashboard.

   ```
   cp .env.example .env
   ```

4. Make a persistent folder for uploads and point `UPLOADS_DIR` at it (step 7). Without it, files uploaded in the admin panel and every Wi-Fi QR image are lost on each redeploy.
5. Run the migration (step 8), then start the API. The start command is `npm start`, which runs `node src/server.js`.

   With a process manager.

   ```
   npm install -g pm2
   pm2 start src/server.js --name feedback-api
   pm2 save
   pm2 startup
   ```

6. Put the API behind a reverse proxy with HTTPS. The proxy must pass the `Host` header, because the API refuses hosts that are not in `ALLOWED_HOSTS`, and it must allow uploads up to 100 MB, which is the video limit. Nginx example.

   ```
   server {
     listen 443 ssl;
     server_name api.your-domain.com;
     # ssl_certificate and ssl_certificate_key lines go here
     location / {
       proxy_pass http://127.0.0.1:8000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       client_max_body_size 100m;
     }
   }
   ```

### On a managed platform

The same steps apply on a container or build platform such as Coolify, Railway, Render, Heroku style hosts or Kubernetes. Whatever the platform calls them, set these.

1. Make an application from the repository and set its root, base or context directory to `backend`. The repository root has no `package.json`.
2. Build with `npm ci` and start with `npm start`. Node 24 is needed, `backend/nixpacks.toml` pins it for Nixpacks builds, and a Dockerfile must use a Node 24 image.
3. Make the port the platform exposes the same number as `PORT`.
4. Add the environment variables from step 7. Where only the environment can be set, give the login as `DATABASES_JSON`. Where files can be mounted, mount `databases.json` into `backend/`.
5. Attach a persistent volume and set `UPLOADS_DIR` to its path. A container disk that is wiped on redeploy loses uploads and Wi-Fi QR images.
6. Set the health check path to `/api/health`.
7. Add the API domain with HTTPS, and set `TRUST_PROXY` to the number of proxies in front of the API.
8. Run the migration (step 8) from the platform's terminal or a one off job, before the first start.

## 6. Front end

Work inside `frontend/`.

1. Set the API address for the build. It must be the public HTTPS address of the API and must end in `/api`.

   ```
   REACT_APP_API_URL=<api>/api
   ```

   It can be set in `frontend/.env`, or in the host's build settings, where it overrides the file. It is stored inside the built files when `npm run build` runs, so after any change, build and upload again. `frontend/.env.development` is used only by `npm start` on a developer machine.
2. Build.

   ```
   npm ci
   npm run build
   ```

3. Upload the contents of `frontend/build/` to the static host.
4. Send every path to `index.html`. The pages are routes inside the React app, so without this rule a refresh or a scanned QR code returns a 404.

   Nginx.

   ```
   server {
     listen 443 ssl;
     server_name events.your-domain.com;
     root /var/www/site/build;
     location / { try_files $uri /index.html; }
   }
   ```

   Netlify, add `frontend/public/_redirects` with this line and build again.

   ```
   /* /index.html 200
   ```

   Vercel, add `frontend/vercel.json`.

   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```

5. Redirect the `www` address to the main address and force HTTPS, so every QR code lands on one address.

### On a managed platform

Make a second application from the same repository. Set its root, base or context directory to `frontend`, which is the most common mistake, since the repository root has no `package.json`. Set `REACT_APP_API_URL` as a build time variable, build with `npm ci && npm run build`, publish the `build` folder as a static site, and turn on the single page application fallback so every path serves `index.html`.

### Single domain alternative

To avoid a separate API domain, proxy `<site>/api` to the API server. Use `REACT_APP_API_URL=<site>/api` and set `ALLOWED_HOSTS` to the site's host name. Cross origin settings are then not needed.

## 7. Environment variables

Set these for the API in `backend/.env`, or in the hosting dashboard. `backend/.env.example` has every one with a comment.

| Variable | Production value | Notes |
| --- | --- | --- |
| `PORT` | Any free port | Match the exposed port on the host |
| `DEBUG` | `False` | `True` shows error details |
| `TRUST_PROXY` | `1` behind one reverse proxy, `0` when reached directly, `2` with a CDN such as Cloudflare in front too | Used by the sign in lockout and the rate limit |
| `ALLOWED_HOSTS` | The API host name | Comma separated. Other host names are refused |
| `CORS_ALLOWED_ORIGINS` | `<site>` | Exact origin, with scheme and no trailing slash. Comma separated for more than one |
| `DATABASES_JSON` | The login JSON on one line | Optional, instead of `databases.json` |
| `DEFAULT_ADMINS` | `user:password:Full Name,...` | The accounts made by the first migration. Use strong passwords |
| `UPLOADS_DIR` | A persistent folder | Admin uploads and Wi-Fi QR images |
| `EXPORT_ACCESS_TOKEN` | 32 or more random characters | Lets the CRM read attendees and responses. Without it those routes return 503 |
| `SEND_FEEDBACK_SUBMISSION_TO_CRM` | `true` or `false` | Switches the CRM post on or off |
| `CRM_WEBHOOK_URL`, `CRM_API_KEY` | From the CRM team | The key is sent in the `X-CRM-API-KEY` header |
| `CRM_DATA_API_URL`, `CRM_DATA_API_KEY` | From the CRM team | The registered delegates sync. Without a key the attendee list is left as it is |
| `GEMINI_API_KEY` | Optional | Without it the Polish button does nothing and the form still works |
| `GEMINI_MODEL`, `GEMINI_API_URL` | Optional | Preferred model and API address |
| `FEEDBACK_REPORT_TO` | Comma separated emails | Who receives the feedback report PDF. No default |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Your mail server | Without `SMTP_HOST` nothing is emailed, the PDF can still be downloaded in admin |
| `EVENTS_FILE`, `DATABASES_FILE` | Optional | Custom paths for the two files |

Generate the export token with this command.

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Restart the API after changing `.env`, `databases.json` or `events.json`.

## 8. Migrate

The migration works on every event in `events.json`, or on one.

```
cd backend
npm run migrate
npm run migrate -- --event <code>
```

It creates the database if it is missing, creates every table, adds the form settings and event details rows, and adds the accounts from `DEFAULT_ADMINS`. On an older database it also adds the newer columns (`role`, `wifi_security`, `wifi_hidden`), changes the old role word `technician` to `support`, and rewrites old media paths to the `events/<code>` layout. It never deletes data, and it is safe to run on every release.

Run it on the API server, or in the platform's terminal for the backend application. The database must be reachable from there, and the login file or `DATABASES_JSON` must be right, or the migration and the API both stop with "No login in databases.json".

## 9. Admin accounts and roles

There are two roles.

| Role | Can do |
| --- | --- |
| `admin` | Everything in the admin panel |
| `support` | Only the Wi-Fi screen, to correct the network name and password. Every other admin route is refused by the API |

The first migration makes the accounts from `DEFAULT_ADMINS`. Change those passwords before the site goes public. Manage accounts in the admin panel, or from the command line.

```
cd backend
npm run admin-user -- --event <code> list
npm run admin-user -- --event <code> set <username> --password "a-strong-password"
npm run admin-user -- --event <code> set <username> --password "a-strong-password" --name "Full Name" --role support
npm run admin-user -- --event <code> disable <username>
npm run admin-user -- --event <code> enable <username>
```

`set` makes the account when it does not exist. Disabling an account signs it out everywhere. Admin sessions last 12 hours, and a restart of the API signs everyone out. Five wrong passwords for one name lock that sign in for 15 minutes.

## 10. Fill the event

1. Sign in at `<site>/<code>/admin/login`.
2. Open Event Details and fill in the event name, tagline, colour, links and Wi-Fi. Save.
3. Upload the media if it is not shipped with the site. Images accept image files, the MP4 video field accepts only `.mp4`, and the WebM field only `.webm`. Replacing a file deletes the old one.
4. Wi-Fi QR. It is made by the server each time the network name, password, security or hidden setting changes, so a save is enough. There is nothing to click. After restoring a database from another server, save Event Details once so the QR is made again on this server's disk.
5. Open the Attendees page and import the attendee list as a CSV, or press Sync now when the CRM sync is configured.
6. Set the form status to active, or set its opening schedule, when the event opens.

## 11. Restore content from another deployment

To copy a running event to a new server, take a dump on the old one and import it on the new one, after the new database exists.

```
mysqldump -h <host> -u <user> -p <db> > <db>_backup.sql
mysql -h <host> -u <user> -p <db> < <db>_backup.sql
cd backend
npm run migrate
```

Run the migration after the import so an older dump gets the newer columns. Uploaded files are not in the dump. Copy the old `UPLOADS_DIR` folder as well, or upload the media again and save Event Details.

## 12. Go live checks

1. Open `<api>/api/health`. It answers when the API and database are up.
2. Open `<api>/api/events/<code>/`. It returns JSON with the event name and no database name.
3. On the database, run `SHOW TABLES;` and confirm nine tables, and `SELECT * FROM form_settings;` for one row with `id` 1.
4. Open `<site>/<code>`, then `<site>/<code>/feedback-form` and refresh it. There must be no 404.
5. Open `<site>/<code>/raffle-draw` and confirm the page loads on the venue screen.
6. Open the browser console on those pages. There must be no CORS errors and no mixed content warnings.
7. Sign in to the admin panel with the new password and confirm the submissions and attendees pages load.
8. Sign in as a support user and confirm only the Wi-Fi screen is available. Change the password there and confirm the QR changes.
9. Upload an image in Event Details, save, redeploy the API, and confirm the image is still there. This proves the uploads volume.
10. Submit a test response from a phone, confirm it appears in admin, then suspend or delete it.
11. Call a CRM export route with the bearer token and confirm a 200 answer. Confirm a wrong token is refused.
12. Open the Wi-Fi page and confirm the images and hero video load on mobile data.
13. Open Logbook in the admin panel. Press Sync now on Attendees, and confirm a CRM delegates row appears with the result and how long it took. Failed rows show the reason.

## 13. Later releases

1. Pull the new code on the API server, run `npm ci --omit=dev` and `npm run migrate` in `backend/`, then restart the API.
2. If anything in `frontend/` changed, build the front end again and upload `build/`.
3. Take a database backup first. Most migration steps only add things, but the role rename and the media path rewrite are one way.

## 14. Adding another event

1. Add an entry to `backend/events.json` with a new code and a new unique database name.
2. Add the matching login to `databases.json` or `DATABASES_JSON`.
3. Put shipped media in `frontend/public/events/<code>/images/` and `frontend/public/events/<code>/videos/`.
4. Run `npm run migrate -- --event <code>`, restart the API, build and upload the front end.
5. Fill the event as in step 10.

## 15. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| API restarts in a loop with "No login in databases.json for" | The login key does not match the `database` value in `events.json` | Rename the key, in the file mount or `DATABASES_JSON`, then restart |
| API exits with "Cannot read" and `events.json` | The file is not in `backend/` | Place it there |
| Migration fails with access denied | The MySQL user lacks rights | Grant rights, or make the database first (Path B) |
| Migration fails on the collation `utf8mb4_0900_ai_ci` | The server is MySQL 5.7 or MariaDB | Use MySQL 8 |
| Front end build fails or finds no `package.json` | The build directory is not set to `frontend` | Set it and deploy again |
| CORS error in the browser | `CORS_ALLOWED_ORIGINS` does not exactly match the site address | Correct it and restart the API |
| API refuses requests by host name | `ALLOWED_HOSTS` is missing the API domain, or the proxy changes the `Host` header | Add the domain and pass the header |
| The site calls `localhost` | The build used the wrong `REACT_APP_API_URL` | Fix it, build and upload again |
| Mixed content blocked | The API address starts with `http` while the site uses `https` | Put the API behind HTTPS and build again |
| 404 when refreshing a page | No rule sending every path to `index.html` | Add the rule from step 6 |
| "Event not found" | Wrong code in the address, or `active` is false in `events.json` | Use the correct code, restart the API after any edit |
| Uploaded files or the Wi-Fi QR vanish after a redeploy | `UPLOADS_DIR` is not on a persistent volume | Add the volume, then save Event Details to make the QR again |
| Video upload fails with 413 | The proxy body limit is too small | Raise `client_max_body_size` to 100m |
| Support user gets "Your role does not allow this." | The page needs the admin role | Use an admin account, this is by design |
| Everyone is signed out after a deploy | Sessions end when the API starts | By design, sign in again |
| Sign in is locked | Too many wrong passwords | Wait 15 minutes, or check `TRUST_PROXY` if every visitor looks like one address |
| CRM export routes return 503 | `EXPORT_ACCESS_TOKEN` is not set | Set it and restart |
| Responses do not reach the CRM | The switch is off, or the URL or key is empty | Set `SEND_FEEDBACK_SUBMISSION_TO_CRM=true`, the URL and the key |
| Polish does nothing on the form | No `GEMINI_API_KEY`, or the model is busy | Optional. The form works and nothing is shown to the attendee. The server log has the reason |
| The form says it is not open | The form status is not active | Change it in the admin settings |
| No report email | `SMTP_HOST` or `FEEDBACK_REPORT_TO` is empty | Set them, or download the PDF in admin |

## 16. Backup and rollback

Take a database backup before any change to a live event.

```
mysqldump -u feedback_user -p <db> > <db>_backup.sql
```

Also keep a copy of the `UPLOADS_DIR` folder. To roll back the front end, upload the previous build. To roll back the API, deploy the previous code and restart it. Take care when going back to code older than the `support` role, because the migration changes the stored role word.
