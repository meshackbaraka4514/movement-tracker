(function () {
  const STORAGE_KEY = "movement-tracker-points-v1";
  const SESSION_KEY = "movement-tracker-session-v1";
  const MAX_RECENT_POINTS = 12;

  const startButton = document.querySelector("#startButton");
  const stopButton = document.querySelector("#stopButton");
  const exportButton = document.querySelector("#exportButton");
  const clearButton = document.querySelector("#clearButton");
  const message = document.querySelector("#message");
  const statusPill = document.querySelector("#statusPill");
  const statusText = document.querySelector("#statusText");
  const distanceValue = document.querySelector("#distanceValue");
  const pointsValue = document.querySelector("#pointsValue");
  const accuracyValue = document.querySelector("#accuracyValue");
  const speedValue = document.querySelector("#speedValue");
  const locationValue = document.querySelector("#locationValue");
  const updatedValue = document.querySelector("#updatedValue");
  const pointsList = document.querySelector("#pointsList");
  const mapsLink = document.querySelector("#mapsLink");
  const mapEmpty = document.querySelector("#mapEmpty");
  const recenterButton = document.querySelector("#recenterButton");
  const sessionInput = document.querySelector("#sessionInput");
  const dashboardLink = document.querySelector("#dashboardLink");
  const copyLinkButton = document.querySelector("#copyLinkButton");
  const newCodeButton = document.querySelector("#newCodeButton");
  const syncValue = document.querySelector("#syncValue");

  const routeMap = RouteMap.create("map");

  const state = {
    watchId: null,
    wakeLock: null,
    points: loadPoints(),
    isTracking: false,
    sessionId: loadSessionId(),
    syncStatus: "Ready",
  };

  function loadPoints() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter(isValidPoint) : [];
    } catch {
      return [];
    }
  }

  function savePoints() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.points));
  }

  function loadSessionId() {
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = sanitizeSessionId(params.get("code") || "");
    if (codeFromUrl) {
      localStorage.setItem(SESSION_KEY, codeFromUrl);
      return codeFromUrl;
    }

    const saved = sanitizeSessionId(localStorage.getItem(SESSION_KEY) || "");
    if (saved) {
      return saved;
    }

    const next = createSessionId();
    localStorage.setItem(SESSION_KEY, next);
    return next;
  }

  function saveSessionId(value) {
    const sessionId = sanitizeSessionId(value) || createSessionId();
    state.sessionId = sessionId;
    localStorage.setItem(SESSION_KEY, sessionId);
    renderSession();
    return sessionId;
  }

  function createSessionId() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(8);

    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      bytes.forEach((_, index) => {
        bytes[index] = Math.floor(Math.random() * 255);
      });
    }

    const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  }

  function sanitizeSessionId(value) {
    return String(value)
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 24);
  }

  function isValidPoint(point) {
    return (
      point &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      Number.isFinite(point.timestamp)
    );
  }

  function setStatus(mode, text) {
    statusPill.classList.remove("idle", "live", "error");
    statusPill.classList.add(mode);
    statusText.textContent = text;
  }

  function setMessage(text) {
    message.textContent = text;
  }

  function startTracking() {
    if (!navigator.geolocation) {
      setStatus("error", "Blocked");
      setMessage("This browser does not support location tracking.");
      return;
    }

    if (!window.isSecureContext) {
      setStatus("error", "HTTPS");
      setMessage("Open this app through HTTPS or localhost before starting.");
      return;
    }

    setStatus("live", "Starting");
    setMessage("Waiting for location permission.");
    startButton.disabled = true;

    state.watchId = navigator.geolocation.watchPosition(handlePosition, handleLocationError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });

    state.isTracking = true;
    stopButton.disabled = false;
    sendLiveStatus(true);
    requestWakeLock();
    render();
  }

  function stopTracking() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
    }

    state.watchId = null;
    state.isTracking = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    releaseWakeLock();
    setStatus("idle", "Idle");
    setMessage(state.points.length ? "Tracking stopped." : "Tracking is off.");
    sendLiveStatus(false);
    render();
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      return;
    }

    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
    } catch {
      state.wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    if (!state.wakeLock) {
      return;
    }

    try {
      await state.wakeLock.release();
    } catch {
      state.wakeLock = null;
    }
  }

  function handlePosition(position) {
    const point = normalizePosition(position);
    const previous = state.points[state.points.length - 1];

    if (previous && shouldSkipPoint(previous, point)) {
      updateCurrentReadout(point);
      return;
    }

    state.points.push(point);
    savePoints();
    setStatus("live", "Live");
    setMessage("Tracking is active.");
    uploadPoint(point);
    render();
  }

  function normalizePosition(position) {
    const coords = position.coords;

    return {
      id: getPointId(),
      latitude: Number(coords.latitude),
      longitude: Number(coords.longitude),
      accuracy: numberOrNull(coords.accuracy),
      altitude: numberOrNull(coords.altitude),
      heading: numberOrNull(coords.heading),
      speed: numberOrNull(coords.speed),
      timestamp: Number(position.timestamp || Date.now()),
    };
  }

  function getPointId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function numberOrNull(value) {
    return Number.isFinite(value) ? Number(value) : null;
  }

  function shouldSkipPoint(previous, next) {
    const secondsApart = Math.abs(next.timestamp - previous.timestamp) / 1000;
    const metersApart = distanceBetween(previous, next);
    return secondsApart < 8 && metersApart < 3;
  }

  function handleLocationError(error) {
    state.isTracking = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus("error", "Error");

    const messages = {
      1: "Location permission was denied.",
      2: "The device could not determine its location.",
      3: "Location lookup timed out.",
    };

    setMessage(messages[error.code] || "Location tracking failed.");
    releaseWakeLock();
    render();
  }

  function clearPoints() {
    if (!state.points.length) {
      return;
    }

    const confirmed = window.confirm("Clear saved locations from this browser?");
    if (!confirmed) {
      return;
    }

    state.points = [];
    savePoints();
    clearLiveTrack();
    setMessage(state.isTracking ? "Tracking is active." : "Saved locations cleared.");
    render();
  }

  async function uploadPoint(point) {
    try {
      setSyncStatus("Sending");
      const response = await fetch(apiUrl(`/points`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ point }),
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      setSyncStatus("Live");
    } catch {
      setSyncStatus("Offline");
    }
  }

  async function sendLiveStatus(active) {
    try {
      const response = await fetch(apiUrl(`/status`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });

      if (!response.ok) {
        throw new Error("Status failed");
      }

      setSyncStatus(active ? "Live" : "Stopped");
    } catch {
      setSyncStatus("Offline");
    }
  }

  async function clearLiveTrack() {
    try {
      await fetch(apiUrl(""), { method: "DELETE" });
      setSyncStatus(state.isTracking ? "Live" : "Ready");
    } catch {
      setSyncStatus("Offline");
    }
  }

  function apiUrl(path) {
    return `/api/tracks/${encodeURIComponent(state.sessionId)}${path}`;
  }

  function setSyncStatus(text) {
    state.syncStatus = text;
    syncValue.textContent = text;
  }

  function exportCsv() {
    if (!state.points.length) {
      return;
    }

    const header = [
      "time_iso",
      "latitude",
      "longitude",
      "accuracy_m",
      "speed_kmh",
      "heading_deg",
      "altitude_m",
      "maps_url",
    ];

    const rows = state.points.map((point) => [
      new Date(point.timestamp).toISOString(),
      point.latitude.toFixed(7),
      point.longitude.toFixed(7),
      point.accuracy ?? "",
      point.speed === null ? "" : (point.speed * 3.6).toFixed(2),
      point.heading ?? "",
      point.altitude ?? "",
      mapUrl(point),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `movement-track-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function render() {
    const totalDistance = getTotalDistance(state.points);
    const latest = state.points[state.points.length - 1];

    pointsValue.textContent = String(state.points.length);
    distanceValue.textContent = formatDistance(totalDistance);
    updateCurrentReadout(latest);
    exportButton.disabled = state.points.length === 0;
    clearButton.disabled = state.points.length === 0;
    renderRecentPoints();
    renderSession();
    mapEmpty.hidden = state.points.length > 0;
    routeMap.update(state.points);
  }

  function renderSession() {
    sessionInput.value = state.sessionId;
    dashboardLink.href = `dashboard.html?code=${encodeURIComponent(state.sessionId)}`;
    syncValue.textContent = state.syncStatus;
  }

  function updateCurrentReadout(point) {
    if (!point) {
      accuracyValue.textContent = "--";
      speedValue.textContent = "--";
      locationValue.textContent = "--";
      updatedValue.textContent = "--";
      mapsLink.href = "#";
      mapsLink.classList.add("is-disabled");
      return;
    }

    accuracyValue.textContent = point.accuracy === null ? "--" : `${Math.round(point.accuracy)} m`;
    speedValue.textContent = point.speed === null ? "--" : `${(point.speed * 3.6).toFixed(1)} km/h`;
    locationValue.textContent = `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
    updatedValue.textContent = formatTime(point.timestamp);
    mapsLink.href = mapUrl(point);
    mapsLink.classList.remove("is-disabled");
  }

  function renderRecentPoints() {
    pointsList.innerHTML = "";

    if (!state.points.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No locations saved yet.";
      pointsList.append(empty);
      return;
    }

    state.points
      .slice(-MAX_RECENT_POINTS)
      .reverse()
      .forEach((point) => {
        const item = document.createElement("li");
        item.className = "point-item";

        const main = document.createElement("div");
        main.className = "point-main";

        const time = document.createElement("span");
        time.className = "point-time";
        time.textContent = formatTime(point.timestamp);

        const coords = document.createElement("span");
        coords.className = "point-coords";
        coords.textContent = `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)} ${
          point.accuracy === null ? "" : `- ${Math.round(point.accuracy)} m`
        }`;

        const link = document.createElement("a");
        link.href = mapUrl(point);
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "Map";

        main.append(time, coords);
        item.append(main, link);
        pointsList.append(item);
      });
  }

  function getTotalDistance(points) {
    return points.reduce((sum, point, index) => {
      if (index === 0) {
        return sum;
      }

      return sum + distanceBetween(points[index - 1], point);
    }, 0);
  }

  function distanceBetween(a, b) {
    const earthRadius = 6371000;
    const latA = toRadians(a.latitude);
    const latB = toRadians(b.latitude);
    const deltaLat = toRadians(b.latitude - a.latitude);
    const deltaLng = toRadians(b.longitude - a.longitude);
    const sinLat = Math.sin(deltaLat / 2);
    const sinLng = Math.sin(deltaLng / 2);
    const value =
      sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLng * sinLng;
    return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function formatDistance(meters) {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }

    return `${(meters / 1000).toFixed(2)} km`;
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      month: "short",
      day: "numeric",
    }).format(new Date(timestamp));
  }

  function mapUrl(point) {
    return `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=18/${point.latitude}/${point.longitude}`;
  }

  startButton.addEventListener("click", startTracking);
  stopButton.addEventListener("click", stopTracking);
  exportButton.addEventListener("click", exportCsv);
  clearButton.addEventListener("click", clearPoints);
  copyLinkButton.addEventListener("click", copyDashboardLink);
  newCodeButton.addEventListener("click", createNewCode);
  sessionInput.addEventListener("change", () => {
    saveSessionId(sessionInput.value);
    setSyncStatus("Ready");
  });
  sessionInput.addEventListener("blur", () => {
    sessionInput.value = state.sessionId;
  });
  window.addEventListener("resize", () => routeMap.invalidateSize());
  recenterButton.addEventListener("click", () => routeMap.recenter());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.isTracking) {
      requestWakeLock();
    }
  });

  if (!window.isSecureContext) {
    setStatus("error", "HTTPS");
    setMessage("Open this app through HTTPS or localhost before starting.");
  }

  render();

  async function copyDashboardLink() {
    const url = new URL(dashboardLink.getAttribute("href"), window.location.href).href;

    try {
      await navigator.clipboard.writeText(url);
      setSyncStatus("Link copied");
    } catch {
      setSyncStatus("Copy failed");
    }
  }

  function createNewCode() {
    const confirmed =
      !state.points.length || window.confirm("Create a new live session code for future points?");
    if (!confirmed) {
      return;
    }

    saveSessionId(createSessionId());
    setSyncStatus("Ready");
  }
})();
