(function () {
  const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const TILE_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

  function createRouteMap(containerId) {
    const map = L.map(containerId, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
    }).setView([20, 0], 2);

    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: TILE_ATTRIBUTION,
    }).addTo(map);

    const polyline = L.polyline([], {
      color: "#146c5f",
      weight: 4,
      opacity: 0.85,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(map);

    const startIcon = L.divIcon({
      className: "route-marker route-marker-start",
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    const liveIcon = L.divIcon({
      className: "route-marker route-marker-live",
      html: '<span class="route-marker-pulse"></span><span class="route-marker-dot"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    let startMarker = null;
    let liveMarker = null;
    let following = true;
    let hasFit = false;

    map.on("dragstart", () => {
      following = false;
    });

    function update(points) {
      if (!points.length) {
        polyline.setLatLngs([]);
        removeMarkers();
        return;
      }

      const latlngs = points.map((point) => [point.latitude, point.longitude]);
      polyline.setLatLngs(latlngs);

      const start = latlngs[0];
      const last = latlngs[latlngs.length - 1];

      if (!startMarker) {
        startMarker = L.marker(start, { icon: startIcon, keyboard: false }).addTo(map);
      } else {
        startMarker.setLatLng(start);
      }

      if (latlngs.length > 1) {
        if (!liveMarker) {
          liveMarker = L.marker(last, { icon: liveIcon, keyboard: false }).addTo(map);
        } else {
          liveMarker.setLatLng(last);
        }
      }

      if (!hasFit || following) {
        fitToRoute(latlngs);
        hasFit = true;
      }
    }

    function fitToRoute(latlngs) {
      if (latlngs.length === 1) {
        map.setView(latlngs[0], 16);
        return;
      }

      map.fitBounds(polyline.getBounds(), { padding: [28, 28], maxZoom: 17 });
    }

    function removeMarkers() {
      if (startMarker) {
        map.removeLayer(startMarker);
        startMarker = null;
      }

      if (liveMarker) {
        map.removeLayer(liveMarker);
        liveMarker = null;
      }
    }

    function recenter() {
      following = true;
      const latlngs = polyline.getLatLngs();
      if (latlngs.length) {
        fitToRoute(latlngs);
      }
    }

    function invalidateSize() {
      map.invalidateSize();
    }

    return { update, recenter, invalidateSize };
  }

  window.RouteMap = { create: createRouteMap };
})();
