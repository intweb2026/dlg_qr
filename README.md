# Event site

React site for events, with its Node.js API. One copy of the code runs every event. The event is chosen by the code at the start of the address.

## Layout

| Folder | What it holds |
| --- | --- |
| `frontend/` | The React site, with its own `package.json`, `.env` and `public/` media |
| `backend/` | The Node.js (Express) API and its MySQL scripts, with its own `package.json` and `.env` |

Each folder is installed, run and deployed on its own. Run every `npm` command inside the folder it belongs to.

## Pages

For an event with the code `<code>`.

| Address | Page |
| --- | --- |
| `/<code>` | Event home menu |
| `/<code>/registered-attendees` | Registered attendees |
| `/<code>/wifipassword` | Wi-Fi details |
| `/<code>/feedback-form` | Feedback form |
| `/<code>/raffle-draw` | Lucky draw for the screen at the venue |
| `/<code>/admin/login` | Admin sign in, then submissions, attendees and the lucky draw |

The bare home page `/` shows a "500 Internal Server Error" page. An unknown code shows "Event not found".

## Events

Each event is one entry in `backend/events.json`, keyed by its code, with its name, media, links and Wi-Fi, and the name of its own MySQL database. See `backend/README.md` to add an event.

The home menu and the feedback questions are the same for every event. Change them in `frontend/src/EventMobileMenu.jsx` and `frontend/src/feedback/config/feedbackQuestions.js`.

Media lives in one folder per event, `frontend/public/events/<code>/images/` and `frontend/public/events/<code>/videos/`. Images shared by every event are in `frontend/public/common/images/`.

## Run it

Run the API and the site in two terminals. Both reload by themselves when you change the code.

Terminal 1, the API in `backend/`. Set it up once with `backend/README.md`, then:

```
cd backend
npm install
npm run dev
```

`npm run dev` is `node --watch`, it restarts the API whenever a file in `backend/` changes. Restart it by hand after changing `events.json`, `databases.json` or `.env`. Use `npm start` instead on a server.

Terminal 2, the site in `frontend/`:

```
cd frontend
npm install
npm start
```

The site opens at http://localhost:3000, open http://localhost:3000/<code> for an event. During `npm start` it calls the API set in `frontend/.env.development`. A production build uses `REACT_APP_API_URL` from `frontend/.env`, the only setting the site needs.

### The WebSocket in the browser

In the browser's Network tab you will see a WebSocket to `ws://localhost:3000/ws` while `npm start` runs. It belongs to the React development server, which uses it to tell the page to refresh after you save a file. It is not part of this app, the API has no WebSocket, and it does not exist in a production build (`npm run build`), so nothing needs changing for deployment.

## Code

- `frontend/src/event/EventContext.js` reads the event code from the address, loads the event's settings, and gives every page `useEvent()` and `useEventPath()`.
- The event pages are in `frontend/src/*.jsx`.
- The feedback form, admin and lucky draw are in `frontend/src/feedback`. Their styles are plain CSS in `base.css` and `styles.css`, every class starts with `dlgfb-`.
- Browser storage, the admin sign in, the "already submitted" flag and the lucky draw state, is kept per event.
