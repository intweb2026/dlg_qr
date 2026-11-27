# Event site

React site for events, with its Node.js API in `backend/`. One copy of the code runs every event. The event is chosen by the code at the start of the address.

## Pages

For an event with the code `aiu26`.

| Address | Page |
| --- | --- |
| `/aiu26` | Event home menu |
| `/aiu26/registered-attendees` | Registered attendees |
| `/aiu26/wifipassword` | Wi-Fi details |
| `/aiu26/feedback-form` | Feedback form |
| `/aiu26/raffle-draw` | Lucky draw for the screen at the venue |
| `/aiu26/admin/login` | Admin sign in, then submissions, attendees and the lucky draw |

The bare home page `/` shows a "500 Internal Server Error" page. An unknown code shows "Event not found".

## Events

Each event is one entry in `backend/events.json`, keyed by its code, with its name, media, links and Wi-Fi, and the name of its own MySQL database. See `backend/README.md` to add an event.

The home menu and the feedback questions are the same for every event. Change them in `src/EventMobileMenu.jsx` and `src/feedback/config/feedbackQuestions.js`.

Media lives in one folder per event, `public/events/<code>/images/` and `public/events/<code>/videos/`. Images shared by every event are in `public/common/images/`.

## Run it

Run the API and the site in two terminals. Both reload by themselves when you change the code.

Terminal 1, the API in `backend/`. Set it up once with `backend/README.md`, then:

```
cd backend
npm install
npm run dev
```

`npm run dev` is `node --watch`, it restarts the API whenever a file in `backend/` changes. Restart it by hand after changing `events.json`, `databases.json` or `.env`. Use `npm start` instead on a server.

Terminal 2, the site in the project root:

```
npm install
npm start
```

The site opens at http://localhost:3000, open http://localhost:3000/aiu26 for the current event. During `npm start` it calls the API set in `.env.development`. A production build uses `REACT_APP_API_URL` from `.env`, the only setting the site needs.

### The WebSocket in the browser

In the browser's Network tab you will see a WebSocket to `ws://localhost:3000/ws` while `npm start` runs. It belongs to the React development server, which uses it to tell the page to refresh after you save a file. It is not part of this app, the API has no WebSocket, and it does not exist in a production build (`npm run build`), so nothing needs changing for deployment.

## Code

- `src/event/EventContext.js` reads the event code from the address, loads the event's settings, and gives every page `useEvent()` and `useEventPath()`.
- The event pages are in `src/*.jsx`.
- The feedback form, admin and lucky draw are in `src/feedback`. Their styles are plain CSS in `base.css` and `styles.css`, every class starts with `dlgfb-`.
- Browser storage, the admin sign in, the "already submitted" flag and the lucky draw state, is kept per event.
