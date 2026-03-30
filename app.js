// ======================================================
// CONFIGURATION
// ======================================================

const PROXY = "https://eblg-proxy.onrender.com";

const ENDPOINTS = {
    metar: `${PROXY}/metar`,
    taf: `${PROXY}/taf`,
    fids: `${PROXY}/fids`,
    notam: `${PROXY}/notam`
};

const SONOS = [
  { id:"F017", lat:50.764883, lon:5.630606 },
  { id:"F001", lat:50.737, lon:5.608833 },
  { id:"F014", lat:50.718894, lon:5.573164 },
  { id:"F015", lat:50.688839, lon:5.526217 },
  { id:"F005", lat:50.639331, lon:5.323519 },
  { id:"F003", lat:50.601167, lon:5.3814 },
  { id:"F011", lat:50.601142, lon:5.356006 },
  { id:"F008", lat:50.594878, lon:5.35895 },
  { id:"F002", lat:50.588414, lon:5.370522 },
  { id:"F007", lat:50.590756, lon:5.345225 },
  { id:"F009", lat:50.580831, lon:5.355417 },
  { id:"F004", lat:50.605414, lon:5.321406 },
  { id:"F010", lat:50.599392, lon:5.313492 },
  { id:"F013", lat:50.586914, lon:5.308678 },
  { id:"F016", lat:50.619617, lon:5.295345 },
  { id:"F006", lat:50.609594, lon:5.271403 },
  { id:"F012", lat:50.621917, lon:5.254747 }
];

let sonometers = {};   // {id, lat, lon, marker, status}
let map;               // Leaflet map
let runwayLayer = null;
let corridorLayer = null;
let corridorArrows = null;

// ======================================================
// FETCH HELPER
// ======================================================

async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error("Erreur fetch :", err);
        return { fallback: true, error: err.message };
    }
}

// ======================================================
// PANEL D'ÉTAT GLOBAL
// ======================================================

function updateStatusPanel(service, data) {
    const panel = document.getElementById("status-panel");
    if (!panel) return;

    if (data.fallback) {
        panel.className = "status-fallback";
        panel.innerText = `${service} : fallback (source offline)`;
        return;
    }

    if (data.error) {
        panel.className = "status-offline";
        panel.innerText = `${service} : offline`;
        return;
    }

    panel.className = "status-ok";
    panel.innerText = `${service} : OK`;
}

// ======================================================
// RUNWAY / CROSSWIND / CORRIDORS
// ======================================================

const RUNWAYS = {
    "04": {
        start: [50.645900, 5.443300],
        end:   [50.637300, 5.463500],
        color: "blue",
        heading: 70
    },
    "22": {
        start: [50.637300, 5.463500],
        end:   [50.645900, 5.443300],
        color: "red",
        heading: 250
    }
};

const CORRIDORS = {
    "04": [
        [50.700000, 5.300000],
        [50.670000, 5.380000],
        [50.645900, 5.443300]
    ],
    "22": [
        [50.600000, 5.600000],
        [50.620000, 5.520000],
        [50.637300, 5.463500]
    ]
};

function drawRunway(runway) {
    if (!map) return;

    if (runwayLayer) {
        map.removeLayer(runwayLayer);
        runwayLayer = null;
    }

    const r = RUNWAYS[runway];
    if (!r) return;

    runwayLayer = L.polyline([r.start, r.end], {
        color: r.color,
        weight: 6,
        opacity: 0.9
    }).addTo(map);
}

function drawCorridor(runway) {
    if (!map) return;

    if (corridorLayer) {
        map.removeLayer(corridorLayer);
        corridorLayer = null;
    }
    if (corridorArrows) {
        map.removeLayer(corridorArrows);
        corridorArrows = null;
    }

    const points = CORRIDORS[runway];
    const r = RUNWAYS[runway];
    if (!points || !r) return;

    corridorLayer = L.polyline(points, {
        color: r.color,
        weight: 3,
        opacity: 0.7
    }).addTo(map);

    corridorArrows = L.polylineDecorator(corridorLayer, {
        patterns: [
            {
                offset: 20,
                repeat: 40,
                symbol: L.Symbol.arrowHead({
                    pixelSize: 10,
                    polygon: false,
                    pathOptions: {
                        stroke: true,
                        color: r.color,
                        weight: 2
                    }
                })
            }
        ]
    }).addTo(map);
}

function getRunwayFromWind(windDir) {
    if (windDir === undefined || windDir === null) return "UNKNOWN";

    if (windDir >= 240 && windDir <= 300) return "22";
    if (windDir >= 60 && windDir <= 120) return "04";

    return "UNKNOWN";
}

function computeCrosswind(runway, windDir, windSpeed) {
    if (!RUNWAYS[runway]) return null;
    if (windDir === undefined || windDir === null || !windSpeed) return null;

    const rwHeading = RUNWAYS[runway].heading;
    let diff = Math.abs(windDir - rwHeading);
    if (diff > 180) diff = 360 - diff;

    const rad = diff * Math.PI / 180;
    const cross = windSpeed * Math.sin(rad);

    return {
        crosswind: Math.round(cross),
        angleDiff: Math.round(diff)
    };
}

function updateRunwayPanel(runway, windDir, windSpeed) {
    const panel = document.getElementById("runway-panel");
    if (!panel) return;

    if (runway === "UNKNOWN") {
        panel.className = "runway-unknown";
        panel.innerText = "Piste active : inconnue";
        return;
    }

    const info = computeCrosswind(runway, windDir, windSpeed);
    const r = RUNWAYS[runway];

    panel.className = runway === "22" ? "runway-22" : "runway-04";

    if (!info) {
        panel.innerText = `Piste ${runway} (${r.heading}°) – vent: données insuffisantes`;
        return;
    }

    panel.innerText =
        `Piste ${runway} (${r.heading}°) – vent ${windDir}°/${windSpeed} kt – ` +
        `crosswind ≈ ${info.crosswind} kt (Δ${info.angleDiff}°)`;
}

// ======================================================
// SONOMÈTRES
// ======================================================

function getSonometerColor(runway) {
    if (runway === "22") return "red";
    if (runway === "04") return "blue";
    return "gray";
}

function initSonometers(mapInstance) {
    SONOS.forEach(s => {
        const marker = L.circleMarker([s.lat, s.lon], {
            radius: 6,
            color: "gray",
            fillColor: "gray",
            fillOpacity: 0.9
        }).addTo(mapInstance);

        sonometers[s.id] = {
            ...s,
            marker,
            status: "UNKNOWN"
        };
    });
}

function updateSonometers(runway) {
    const color = getSonometerColor(runway);

    Object.values(sonometers).forEach(s => {
        s.marker.setStyle({
            color,
            fillColor: color
        });
        s.status = runway;
    });
}
function updateSonometersAdvanced(runway, phase) {
    // Reset all to gray
    Object.values(sonometers).forEach(s => {
        s.marker.setStyle({ color: "gray", fillColor: "gray" });
    });

    if (runway === "UNKNOWN") return;

    let green = [];
    let red = [];

    if (runway === "22") {
        if (phase === "takeoff") {
            green = ["F002","F003","F004","F005","F006","F007","F008","F009","F010","F011","F012","F013","F016"];
        } else if (phase === "landing") {
            green = ["F001","F014","F015","F017"];
        }
    }

    if (runway === "04") {
        if (phase === "takeoff") {
            green = ["F002","F003","F007","F008","F009","F011","F013"];
            red   = ["F004","F005","F006","F010","F012","F016"];
        } else if (phase === "landing") {
            green = ["F014","F015"];
            red   = ["F001","F017"];
        }
    }

    // Apply colors
    green.forEach(id => {
        if (sonometers[id]) {
            sonometers[id].marker.setStyle({ color: "green", fillColor: "green" });
        }
    });

    red.forEach(id => {
        if (sonometers[id]) {
            sonometers[id].marker.setStyle({ color: "red", fillColor: "red" });
        }
    });
}

// ======================================================
// METAR
// ======================================================

async function loadMetar() {
    const data = await fetchJSON(ENDPOINTS.metar);
    updateMetarUI(data);
    updateStatusPanel("METAR", data);
}

function updateMetarUI(data) {
    const el = document.getElementById("metar");
    if (!el) return;

    if (data.fallback) {
        el.innerText = "METAR indisponible (fallback activé)";
        updateSonometers("UNKNOWN");
        drawRunway("UNKNOWN");
        drawCorridor("UNKNOWN");
        updateRunwayPanel("UNKNOWN", null, null);
        return;
    }

    el.innerText = data.raw;

    const windDir = data.wind_direction?.value;
    const windSpeed = data.wind_speed?.value;
    const runway = getRunwayFromWind(windDir);

    updateSonometers(runway);
    drawRunway(runway);
    drawCorridor(runway);
    updateRunwayPanel(panel.innerText =
    `Piste ${runway} (${r.heading}°) – ${phase === "landing" ? "Atterrissage" : "Décollage"} – ` +
    `vent ${windDir}°/${windSpeed} kt – crosswind ≈ ${info.crosswind} kt (Δ${info.angleDiff}°)`;
);
}
let phase = "takeoff";

if (runway === "22") {
    if (windDir >= 200 && windDir <= 260) phase = "landing";
}

if (runway === "04") {
    if (windDir >= 20 && windDir <= 80) phase = "landing";
}

updateSonometersAdvanced(runway, phase);

// ======================================================
// TAF
// ======================================================

async function loadTaf() {
    const data = await fetchJSON(ENDPOINTS.taf);
    updateTafUI(data);
}

function updateTafUI(data) {
    const el = document.getElementById("taf");
    if (!el) return;

    if (data.fallback) {
        el.innerText = "TAF indisponible (fallback activé)";
        return;
    }

    el.innerText = data.raw || "TAF disponible";
}

// ======================================================
// FIDS (UI compacte + colorée)
// ======================================================

async function loadFids() {
    const data = await fetchJSON(ENDPOINTS.fids);
    updateFidsUI(data);
}

function updateFidsUI(data) {
    const container = document.getElementById("fids");
    if (!container) return;

    if (data.fallback) {
        container.innerHTML = `<div class="fids-row fids-unknown">FIDS indisponible</div>`;
        return;
    }

    const flights = Array.isArray(data) ? data : [];
    container.innerHTML = "";

    if (!flights.length) {
        container.innerHTML = `<div class="fids-row fids-unknown">Aucun vol disponible</div>`;
        return;
    }

    flights.forEach(flight => {
        const statusText = (flight.status || "").toLowerCase();

        let cssClass = "fids-unknown";
        if (statusText.includes("on time")) cssClass = "fids-on-time";
        if (statusText.includes("delayed")) cssClass = "fids-delayed";
        if (statusText.includes("cancel")) cssClass = "fids-cancelled";
        if (statusText.includes("board")) cssClass = "fids-boarding";

        const row = document.createElement("div");
        row.className = `fids-row ${cssClass}`;
        row.innerHTML = `
            <span>${flight.flight || "-"}</span>
            <span>${flight.destination || "-"}</span>
            <span>${flight.time || "-"}</span>
            <span>${flight.status || "-"}</span>
        `;
        container.appendChild(row);
    });
}

// ======================================================
// CARTE
// ======================================================

function initMap() {
    map = L.map("map").setView([50.643, 5.443], 11);
document.getElementById("reset-map").onclick = () => {
    map.setView([50.643, 5.443], 11);
};

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18
    }).addTo(map);

    initSonometers(map);
}

// ======================================================
// INITIALISATION GLOBALE
// ======================================================

window.onload = () => {
    initMap();
    loadMetar();
    loadTaf();
    loadFids();
};
