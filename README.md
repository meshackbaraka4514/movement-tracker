# Movement Tracker

A small, visible web tracker for your own device. It starts only when you press
Start, uses the browser's normal location permission, saves points in this
browser, and exports a CSV file.

## Run With Live Dashboard

```powershell
node server.js
```

Then open the tracker:

```powershell
http://127.0.0.1:4173/
```

Open the dashboard from the tracker page, or go to:

```text
http://127.0.0.1:4173/dashboard.html
```

Use the same session code on both pages.

To bind to a different host:

```powershell
$env:HOST="0.0.0.0"; node server.js
```

## Deploy On Render

Use Render as a Web Service because this project has a Node backend. Static hosts
alone will not run `server.js`.

1. Create a GitHub repository and upload this folder.
2. In Render, choose New > Web Service.
3. Connect your GitHub repository.
4. Set the runtime/language to Node.
5. Use this build command:

```text
npm install
```

6. Use this start command:

```text
npm start
```

7. Create the service and wait for the deploy to finish.
8. Open the HTTPS `onrender.com` URL Render gives you.

After deploy:

- Phone tracker: `https://your-app.onrender.com/`
- Dashboard: `https://your-app.onrender.com/dashboard.html`

## Run Local Only

```powershell
python -m http.server 4173 -b 127.0.0.1
```

The tracker will still save points in the browser, but the live dashboard needs
`node server.js`.

## Use On A Phone

Phone browsers require a secure context for GPS access. Use one of these:

- Host the folder on HTTPS, such as GitHub Pages, Netlify, or Vercel.
- Run it on the phone itself at `localhost`.

Plain `http://computer-ip:4173/` usually will not allow location access on a
phone.

## Limits

Web apps cannot reliably track after the browser tab is closed or the phone
puts the page to sleep. Keep the tracker page open while tracking. The live
server stores points in memory, so restarting `server.js` clears the live
dashboard history.
