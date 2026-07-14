# ChargeMate

ChargeMate is a GitHub-ready progressive web app for finding nearby EV chargers and estimating basic EV trip range.

## Included

- Live nearby charger search using Open Charge Map
- Demo charger mode
- Leaflet/OpenStreetMap map
- Power filtering and station search
- Basic trip-range estimator
- Installable PWA manifest and service worker
- Responsive dark-blue interface

## Run locally

Because browsers restrict location and service workers on plain files, use a local web server.

### Python

```bash
python -m http.server 8080
```

Open `http://localhost:8080`.

## GitHub Pages

1. Create a new GitHub repository.
2. Upload all files from this folder.
3. Open **Settings → Pages**.
4. Select **Deploy from a branch**, then choose `main` and `/root`.
5. Save. GitHub will provide the public website address.

## Live charger data

Open the app settings and add an Open Charge Map API key. The app falls back to demo data if live lookup is unavailable.

## Important development notes

This is a web/PWA release, not a signed Android APK. NFC credential cloning, protected charging-card emulation and payment processing are not included. Production authentication, payment, secure vehicle APIs and Android Auto require separate secure backend/native implementation.
