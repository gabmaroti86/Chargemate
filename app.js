const state = {
  map: null,
  markerLayer: null,
  userMarker: null,
  position: null,
  stations: [],
  radius: 15000,
  theme: localStorage.getItem("chargefinder-theme") || "system",
  saved: new Set(JSON.parse(localStorage.getItem("chargefinder-saved") || "[]")),
  requestController: null,
  requestToken: 0
};

const els = {
  locationLabel: document.querySelector("#locationLabel"),
  stationCount: document.querySelector("#stationCount"),
  connectorCount: document.querySelector("#connectorCount"),
  inUseCount: document.querySelector("#inUseCount"),
  stationRadius: document.querySelector("#stationRadius"),
  chargerList: document.querySelector("#chargerList"),
  radiusSelect: document.querySelector("#radiusSelect"),
  themeButton: document.querySelector("#themeButton"),
  themeSelect: document.querySelector("#themeSelect"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  detailsDialog: document.querySelector("#detailsDialog"),
  detailsContent: document.querySelector("#detailsContent"),
  feedbackDialog: document.querySelector("#feedbackDialog"),
  feedbackText: document.querySelector("#feedbackText"),
  toast: document.querySelector("#toast"),
  mapLoading: document.querySelector("#mapLoading")
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function applyTheme() {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const actual = state.theme === "system" ? (dark ? "dark" : "light") : state.theme;
  document.documentElement.dataset.theme = actual;
  els.themeSelect.value = state.theme;
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

function initMap() {
  state.map = L.map("map", {
    zoomControl: true,
    preferCanvas: true,
    fadeAnimation: false,
    markerZoomAnimation: false
  }).setView([-37.8136, 144.9631], 11);

  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 3,
    attribution: '&copy; OpenStreetMap contributors'
  });

  tiles.on("load", () => els.mapLoading?.classList.add("hidden"));
  tiles.on("tileerror", () => {
    if (els.mapLoading) els.mapLoading.textContent = "Map tiles are slow — retrying…";
  });

  tiles.addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);

  setTimeout(() => {
    state.map.invalidateSize();
    els.mapLoading?.classList.add("hidden");
  }, 500);
}

function getPosition() {
  if (!navigator.geolocation) {
    showToast("Location is not supported on this device.");
    return;
  }
  els.locationLabel.textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      state.position = { lat: coords.latitude, lon: coords.longitude };
      updateUserMarker();
      reverseGeocode();
      loadStations();
    },
    err => {
      els.locationLabel.textContent = "Location permission needed";
      showToast(err.code === 1 ? "Allow location access to find nearby chargers." : "Could not determine your location.");
      renderEmpty("Location access is required to search around you.");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

function updateUserMarker() {
  const p = state.position;
  if (!p) return;
  if (state.userMarker) state.userMarker.remove();
  state.userMarker = L.circleMarker([p.lat, p.lon], {
    radius: 9, fillOpacity: 1, weight: 4, color: "#ffffff", fillColor: "#1677ff"
  }).addTo(state.map).bindPopup("Your location");
  state.map.setView([p.lat, p.lon], 13);
}

async function reverseGeocode() {
  try {
    const {lat, lon} = state.position;
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14`, {
      headers: { "Accept-Language": "en" }
    });
    if (!response.ok) throw new Error("Geocoder error");
    const data = await response.json();
    els.locationLabel.textContent = data.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } catch {
    const {lat, lon} = state.position;
    els.locationLabel.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}

function overpassQuery(lat, lon, radius) {
  return `[out:json][timeout:14];
  (
    node["amenity"="charging_station"](around:${radius},${lat},${lon});
    way["amenity"="charging_station"](around:${radius},${lat},${lon});
  );
  out center tags qt;`;
}

async function loadStations() {
  if (!state.position) return;

  const token = ++state.requestToken;
  if (state.requestController) state.requestController.abort();
  state.requestController = new AbortController();

  renderEmpty("Loading nearby charging stations…");
  const {lat, lon} = state.position;
  const body = new URLSearchParams({ data: overpassQuery(lat, lon, state.radius) });
  const endpoints = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];

  let lastError;
  for (const endpoint of endpoints) {
    try {
      const timeout = setTimeout(() => state.requestController.abort(), 12000);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
        signal: state.requestController.signal
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`Station service returned ${response.status}`);
      const data = await response.json();
      if (token !== state.requestToken) return;

      state.stations = data.elements
        .map(normalizeStation)
        .filter(Boolean)
        .sort((a,b) => a.distanceKm - b.distanceKm);

      renderStations();
      return;
    } catch (error) {
      lastError = error;
      if (error.name === "AbortError" && token !== state.requestToken) return;
      state.requestController = new AbortController();
    }
  }

  console.error(lastError);
  if (token !== state.requestToken) return;
  renderEmpty("The live charger service is busy. Tap Use my location to retry.");
  showToast("Charger data is taking too long. Please retry.");
}

function normalizeStation(element) {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const tags = element.tags || {};
  const name = tags.name || tags.operator || "EV charging station";
  const connectors = connectorSummary(tags);
  return {
    id: `${element.type}-${element.id}`,
    osmType: element.type,
    osmId: element.id,
    lat, lon, name, tags, connectors,
    distanceKm: haversine(state.position.lat, state.position.lon, lat, lon)
  };
}

function connectorSummary(tags) {
  const connectorKeys = Object.keys(tags).filter(k => k.startsWith("socket:") && !k.endsWith(":output"));
  const types = [];
  let knownCount = 0;
  for (const key of connectorKeys) {
    const label = key.replace("socket:", "").replaceAll("_", " ").toUpperCase();
    const value = String(tags[key]).toLowerCase();
    if (!["no","0","false"].includes(value)) {
      types.push(label);
      const n = Number(value);
      if (Number.isFinite(n)) knownCount += n;
    }
  }
  const capacity = Number(tags.capacity);
  const count = Number.isFinite(capacity) ? capacity : knownCount;
  return { types: [...new Set(types)], count };
}

function haversine(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function renderStations() {
  state.markerLayer.clearLayers();
  els.stationCount.textContent = state.stations.length;
  const totalConnectors = state.stations.reduce((sum, s) => sum + (s.connectors.count || 0), 0);
  els.connectorCount.textContent = totalConnectors || "—";
  els.inUseCount.textContent = "N/A";
  els.stationRadius.textContent = `Within ${state.radius/1000} km`;

  if (!state.stations.length) {
    renderEmpty(`No mapped charging stations were found within ${state.radius/1000} km.`);
    return;
  }

  els.chargerList.innerHTML = state.stations.slice(0, 100).map(stationCard).join("");
  for (const station of state.stations.slice(0, 120)) {
    const marker = L.marker([station.lat, station.lon]).addTo(state.markerLayer);
    marker.bindPopup(`<strong>${escapeHtml(station.name)}</strong><br>${station.distanceKm.toFixed(1)} km away`);
    marker.on("click", () => openDetails(station.id));
  }
  if (state.position) state.map.setView([state.position.lat, state.position.lon], state.radius <= 5000 ? 14 : state.radius <= 15000 ? 12 : 10, { animate: false });
}

function stationCard(s) {
  const connectorText = s.connectors.types.length ? s.connectors.types.slice(0,3).join(" · ") : "Connector details not mapped";
  const saved = state.saved.has(s.id);
  return `<article class="charger-card">
    <div>
      <h3>${escapeHtml(s.name)}</h3>
      <p class="charger-meta"><span class="distance">${s.distanceKm.toFixed(1)} km</span> · ${escapeHtml(connectorText)}</p>
      <div class="card-actions">
        <button class="small-button" data-details="${s.id}">Details</button>
        <button class="small-button" data-navigate="${s.id}">Navigate</button>
        <button class="small-button" data-save="${s.id}">${saved ? "Saved" : "Save"}</button>
      </div>
    </div>
    <span aria-label="Charging station" style="font-size:30px">⚡</span>
  </article>`;
}

function renderEmpty(message) {
  els.chargerList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  els.stationCount.textContent = "—";
  els.connectorCount.textContent = "—";
  els.inUseCount.textContent = "—";
}

function openDetails(id) {
  const s = state.stations.find(x => x.id === id);
  if (!s) return;
  const address = [s.tags["addr:housenumber"], s.tags["addr:street"], s.tags["addr:suburb"], s.tags["addr:city"]].filter(Boolean).join(" ");
  els.detailsContent.innerHTML = `
    <p class="eyebrow">Station details</p>
    <h2>${escapeHtml(s.name)}</h2>
    <p>${s.distanceKm.toFixed(1)} km from your current location</p>
    <p><strong>Address:</strong> ${escapeHtml(address || "Not mapped")}</p>
    <p><strong>Operator:</strong> ${escapeHtml(s.tags.operator || "Not mapped")}</p>
    <p><strong>Access:</strong> ${escapeHtml(s.tags.access || "Not mapped")}</p>
    <p><strong>Opening hours:</strong> ${escapeHtml(s.tags.opening_hours || "Not mapped")}</p>
    <p><strong>Connectors:</strong> ${escapeHtml(s.connectors.types.join(", ") || "Not mapped")}</p>
    <p><strong>Live occupancy:</strong> Not supplied by OpenStreetMap.</p>
    <button class="primary-button" data-navigate="${s.id}">Open navigation</button>`;
  els.detailsDialog.showModal();
}

function navigateTo(id) {
  const s = state.stations.find(x => x.id === id);
  if (!s) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.lat},${s.lon}`)}&travelmode=driving`;
  window.open(url, "_blank", "noopener");
}

function toggleSave(id) {
  if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
  localStorage.setItem("chargefinder-saved", JSON.stringify([...state.saved]));
  renderStations();
}

function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

document.querySelector("#locateButton").addEventListener("click", getPosition);
document.querySelector("#fullscreenButton").addEventListener("click", async () => {
  const map = document.querySelector("#map");
  if (!document.fullscreenElement) await map.requestFullscreen(); else await document.exitFullscreen();
  setTimeout(() => state.map.invalidateSize(), 250);
});
document.addEventListener("fullscreenchange", () => setTimeout(() => state.map.invalidateSize(), 250));
els.radiusSelect.addEventListener("change", e => {
  state.radius = Number(e.target.value);
  if (state.position) loadStations();
});
els.settingsButton.addEventListener("click", () => els.settingsDialog.showModal());
els.themeButton.addEventListener("click", () => {
  const order = ["system","light","dark"];
  state.theme = order[(order.indexOf(state.theme)+1)%order.length];
  localStorage.setItem("chargefinder-theme", state.theme);
  applyTheme();
  showToast(`Theme: ${state.theme}`);
});
els.themeSelect.addEventListener("change", e => {
  state.theme = e.target.value;
  localStorage.setItem("chargefinder-theme", state.theme);
  applyTheme();
});
document.querySelectorAll("[data-close-dialog]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
document.addEventListener("click", e => {
  const details = e.target.closest("[data-details]");
  const navigate = e.target.closest("[data-navigate]");
  const save = e.target.closest("[data-save]");
  if (details) openDetails(details.dataset.details);
  if (navigate) navigateTo(navigate.dataset.navigate);
  if (save) toggleSave(save.dataset.save);
});
document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  button.classList.add("active");
  const view = button.dataset.view;
  document.body.classList.toggle("drive-mode", view === "drive");
  if (view === "feedback") els.feedbackDialog.showModal();
  if (view === "saved") {
    const savedStations = state.stations.filter(s => state.saved.has(s.id));
    els.chargerList.innerHTML = savedStations.length ? savedStations.map(stationCard).join("") : '<div class="empty-state">No saved stations yet.</div>';
    document.querySelector(".nearby-section").scrollIntoView({behavior:"smooth"});
  }
  if (view === "map") renderStations();
  setTimeout(() => state.map.invalidateSize(), 200);
}));
document.querySelector("#sendFeedbackButton").addEventListener("click", () => {
  const body = els.feedbackText.value.trim();
  if (!body) return showToast("Please enter your feedback.");
  location.href = `mailto:?subject=${encodeURIComponent("ChargeFinder beta feedback")}&body=${encodeURIComponent(body)}`;
});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
initMap();
getPosition();
