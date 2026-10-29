# Event site

React site for events, with its Node.js API in `backend/`. One copy of the code runs every event. The event is chosen by the code at the start of the address.

## Pages

For an event with the code `dle26`.

| Address | Page |
| --- | --- |
| `/dle26` | Event home menu |
| `/dle26/registered-attendees` | Registered attendees |
| `/dle26/wifipassword` | Wi-Fi details |
| `/dle26/feedback-form` | Feedback form |
| `/dle26/lucky-draw` | Lucky draw for the screen at the venue |
| `/dle26/admin/login` | Admin sign in, then submissions, attendees and the lucky draw |

The bare home page `/` shows a "500 Internal Server Error" page. An unknown code shows "Event not found".

## Events

Each event is one entry in `backend/events.json`, keyed by its code, with its name, media, links and Wi-Fi, and the name of its own MySQL database. See `backend/README.md` to add an event.

The home menu and the feedback questions are the same for every event. Change them in `src/EventMobileMenu.jsx` and `src/feedback/config/feedbackQuestions.js`.

Media lives in folders per event, `public/images/<code>/` and `public/videos/<code>/`. Icons shared by every event are in `public/images/common/`.

## Run it

Start the API first, see `backend/README.md`.

```
npm install
npm start
```

The site opens at http://localhost:3000, open http://localhost:3000/dle26 for the current event. During `npm start` it calls the API set in `.env.development`. A production build uses `REACT_APP_API_URL` from `.env`, the only setting the site needs.

## Code

- `src/event/EventContext.js` reads the event code from the address, loads the event's settings, and gives every page `useEvent()` and `useEventPath()`.
- The event pages are in `src/*.jsx`.
- The feedback form, admin and lucky draw are in `src/feedback`. Their styles are plain CSS in `base.css` and `styles.css`, every class starts with `dlgfb-`.
- Browser storage, the admin sign in, the "already submitted" flag and the lucky draw state, is kept per event.
