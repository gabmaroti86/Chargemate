# ChargeFinder

A GitHub-ready progressive web app for finding nearby EV charging stations.

## What works now

- Uses the phone's real location.
- Loads real charging-station locations from OpenStreetMap through the Overpass API.
- Shows total nearby stations and mapped connector capacity.
- Full-screen map.
- Nearby list sorted by distance.
- Opens Google Maps navigation.
- Light, dark and system themes.
- Installable PWA with offline app-shell caching.
- Drive-mode layout.
- Saved chargers stored locally on the device.
- Beta-feedback form.
- GitHub Pages deployment workflow.

## Important capability limits

This build does **not** fabricate live availability. OpenStreetMap generally does not provide real-time connector occupancy, so “currently in use” is shown as unavailable.

The following require separate commercial/native integrations and cannot be delivered by static GitHub Pages alone:

- Real-time occupied/free connector status.
- Starting or paying for a charging session.
- ISO 15118 Plug & Charge.
- Native Apple CarPlay application support.
- Native Android Auto application support.
- Automatic launch when a vehicle is connected.

The code is structured so a charging-network API can be connected later.

## Publish on GitHub Pages from a phone

1. Create a new GitHub repository.
2. Upload **all files and folders from inside this project folder**.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, choose **GitHub Actions**.
5. The included workflow publishes the app automatically.
6. Open the URL shown in the completed **Actions** deployment.

## Local testing

The app must be served over HTTPS or localhost for location access and service workers. Opening `index.html` directly as a file will not provide all features.

A simple local server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Data and privacy

Location remains in the browser and is sent only to:

- OpenStreetMap Nominatim for the location label.
- Overpass API for nearby charger searches.
- Google Maps only after the user taps Navigate.

## License

MIT
