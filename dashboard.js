(function () {
  const SESSION_KEY = "movement-dashboard-session-v1";
  const MAX_RECENT_POINTS = 12;
  const POLL_MS = 2500;

  const statusPill = document.querySelector("#statusPill");
  const statusText = document.querySelector("#statusText");
  const sessionInput = document.querySelector("#sessionInput");
  const loadButton = document.querySelector("#loadButton");
  const clearButton = document.querySelector("#clearButton");
  const exportButton = document.querySelector("#exportButton");
  const trackerLink = document.querySelector("#trackerLink");
  const message = document.querySelector("#message");
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

  const routeMap = RouteMap.create("map");

  const state = {
    sessionId: getInitialSessionId(),
    points: [],
    active: false,
    updatedAt: null,
    pollTimer: null,
  };

  function getInitialSessionId() {
    const params = new URLSearchParams(window.location.search);
    return sanitizeSessionId(params.get("code") || localStorage.getItem(SESSION_KEY) || "");
  }

  function sanitizeSessionId(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 24);
  }

  function setStatus(mode, text) {
    statusPill.classList.remove("idle", "live", "error");
    statusPill.classList.add(mode);
    statusText.textContent = text;
  }

  function setMessage(text) {
    message.textContent = text;
  }

  function loadSession() {
    const sessionId = sanitizeSessionId(sessionInput.value);

    if (!sessionId) {
      setStatus("error", "Code");
      setMessage("Enter a session code.");
      return;
    }

    state.sessionId = sessionId;
    localStorage.setItem(SESSION_KEY, sessionId);
    sessionInput.value = sessionId;
    trackerLink.href = `index.html?code=${encodeURIComponent(sessionId)}`;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("code", sessionId);
    window.history.replaceState(null, "", nextUrl);

    startPolling();
  }

  function startPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
    }

    fetchTrack();
    state.pollTimer = window.setInterval(fetchTrack, POLL_MS);
  }

  async function fetchTrack() {
    if (!state.sessionId) {
      render();
      return;
    }

    try {
      const response = await fetch(`/api/tracks/${encodeURIComponent(state.sessionId)}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Fetch failed");
      }

      const track = await response.json();
      state.points = Array.isArray(track.points) ? track.points.filter(isValidPoint) : [];
      state.active = Boolean(track.active);
      state.updatedAt = Number(track.updatedAt || 0) || null;
      setStatus(state.active ? "live" : "idle", state.active ? "Live" : "Waiting");
      setMessage(state.points.length ? "Dashboard connected." : "Waiting for tracker points.");
      render();
    } catch {
      setStatus("error", "Offline");
      setMessage("Dashboard cannot reach the live server.");
      render();
    }
  }

  function isValidPoint(point) {
    return (
      point &&
      Number.isFinite(Number(point.latitude)) &&
      Number.isFinite(Number(point.longitude)) &&
      Number.isFinite(Number(point.timestamp))
    );
  }

  async function clearTrack() {
    if (!state.sessionId || !state.points.length) {
      return;
    }

    const confirmed = window.confirm("Clear this live track from the server?");
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/tracks/${encodeURIComponent(state.sessionId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Clear failed");
      }

      state.points = [];
      state.active = false;
      state.updatedAt = null;
      setStatus("idle", "Waiting");
      setMessage("Live track cleared.");
      render();
    } catch {
      setStatus("error", "Offline");
      setMessage("Could not clear the live track.");
    }
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
      Number(point.latitude).toFixed(7),
      Number(point.longitude).toFixed(7),
      point.accuracy ?? "",
      point.speed === null ? "" : (Number(point.speed) * 3.6).toFixed(2),
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
    link.download = `live-track-${state.sessionId}-${new Date().toISOString().slice(0, 10)}.csv`;
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
    clearButton.disabled = state.points.length === 0;
    exportButton.disabled = state.points.length === 0;
    updateCurrentReadout(latest);
    renderRecentPoints();
    mapEmpty.hidden = state.points.length > 0;
    routeMap.update(state.points);
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
    speedValue.textContent = point.speed === null ? "--" : `${(Number(point.speed) * 3.6).toFixed(1)} km/h`;
    locationValue.textContent = `${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`;
    updatedValue.textContent = formatTime(point.timestamp);
    mapsLink.href = mapUrl(point);
    mapsLink.classList.remove("is-disabled");
  }

  function renderRecentPoints() {
    pointsList.innerHTML = "";

    if (!state.points.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No live locations yet.";
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
        coords.textContent = `${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)} ${
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
    const latA = toRadians(Number(a.latitude));
    const latB = toRadians(Number(b.latitude));
    const deltaLat = toRadians(Number(b.latitude) - Number(a.latitude));
    const deltaLng = toRadians(Number(b.longitude) - Number(a.longitude));
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

  loadButton.addEventListener("click", loadSession);
  clearButton.addEventListener("click", clearTrack);
  exportButton.addEventListener("click", exportCsv);
  sessionInput.addEventListener("change", loadSession);
  window.addEventListener("resize", () => routeMap.invalidateSize());
  recenterButton.addEventListener("click", () => routeMap.recenter());

  sessionInput.value = state.sessionId;
  trackerLink.href = state.sessionId
    ? `index.html?code=${encodeURIComponent(state.sessionId)}`
    : "index.html";

  if (state.sessionId) {
    startPolling();
  } else {
    setStatus("idle", "Waiting");
    render();
  }
})();
