// Live map of every active technician's last known position.
//
// "Last known" is deliberate wording: the technician app only streams GPS while
// it is in the foreground (see technician-app/src/lib/location.js), so a marker
// can be minutes or hours old. Freshness is therefore part of the UI, not a
// detail — markers and the side list are colour-coded by how stale the fix is,
// so a manager never reads an 09:00 position as "where they are now".
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api/client.js";
import { Alert, Card, EmptyState, Icon, timeAgo } from "../components/ui.jsx";

// How often we re-poll. The device itself only sends every 30s at best
// (MIN_INTERVAL in the app), so polling faster just burns requests.
const POLL_MS = 30000;

// Freshness buckets, in minutes.
const LIVE_MAX = 5;
const RECENT_MAX = 60;

// Fallback view when nobody has a location yet — Pune/PCMC, the service area.
const FALLBACK_CENTER = [18.5913, 73.7389];
const FALLBACK_ZOOM = 11;

function freshness(iso) {
  if (!iso) return "stale";
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins <= LIVE_MAX) return "live";
  if (mins <= RECENT_MAX) return "recent";
  return "stale";
}

const TONE = {
  live: { dot: "#16a34a", ring: "rgba(22,163,74,.25)", label: "Live", chip: "bg-green-50 text-green-700 ring-green-600/20" },
  recent: { dot: "#d97706", ring: "rgba(217,119,6,.25)", label: "Recent", chip: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  stale: { dot: "#64748b", ring: "rgba(100,116,139,.2)", label: "Stale", chip: "bg-slate-100 text-slate-600 ring-slate-500/20" },
};

// Leaflet's default marker images break under bundlers (the CSS points at files
// Vite rewrites). A divIcon sidesteps that entirely and lets the pin carry the
// technician's initials + freshness colour.
function pinIcon(tech, tone) {
  const initials = (tech.full_name || "?")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
    html:
      `<div style="width:34px;height:34px;border-radius:9999px;background:${tone.dot};` +
      `box-shadow:0 0 0 6px ${tone.ring},0 1px 3px rgba(0,0,0,.35);color:#fff;` +
      `display:flex;align-items:center;justify-content:center;font:600 12px/1 system-ui,sans-serif;">` +
      `${initials}</div>`,
  });
}

export default function LiveMap() {
  const navigate = useNavigate();
  const [techs, setTechs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // technician id -> L.Marker
  // Only auto-fit the first time we get positions; refitting on every poll would
  // yank the map out from under a manager who has panned or zoomed.
  const fittedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const { technicians } = await api.listTechnicians();
      setTechs(technicians || []);
      setUpdatedAt(new Date());
      setErr("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const located = useMemo(
    () => techs.filter((t) => t.last_lat != null && t.last_lng != null),
    [techs]
  );
  const unlocated = useMemo(
    () => techs.filter((t) => t.last_lat == null || t.last_lng == null),
    [techs]
  );

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: true }).setView(FALLBACK_CENTER, FALLBACK_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    // Leaflet caches the container size at init. Ours sits in a responsive grid
    // that settles after the first paint, so the cached width is short and the
    // map renders with a grey band where tiles were never requested. A
    // ResizeObserver alone does not fix it — on mount it fires within the same
    // stale layout pass, and no further resize follows. Re-measure explicitly on
    // the next frame, then keep the observer for real resizes afterwards.
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(mapEl.current);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers to the latest positions: move the ones we already have rather
  // than clearing the layer, so an open popup survives a poll.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set();

    for (const t of located) {
      seen.add(t.id);
      const tone = TONE[freshness(t.location_at)];
      const pos = [Number(t.last_lat), Number(t.last_lng)];
      const popup =
        `<div style="font:500 13px system-ui,sans-serif">` +
        `<div style="font-weight:700">${t.full_name || "Technician"}</div>` +
        `<div style="color:#64748b">${tone.label} · ${t.location_at ? timeAgo(t.location_at) : "never"}</div>` +
        `<div style="color:#64748b;font-family:ui-monospace,monospace;font-size:11px">${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}</div>` +
        `<a href="https://maps.google.com/?q=${pos[0]},${pos[1]}" target="_blank" rel="noreferrer">Open in Google Maps</a>` +
        `</div>`;

      let m = markersRef.current.get(t.id);
      if (m) {
        m.setLatLng(pos);
        m.setIcon(pinIcon(t, tone));
        m.setPopupContent(popup);
      } else {
        m = L.marker(pos, { icon: pinIcon(t, tone), title: t.full_name }).addTo(map).bindPopup(popup);
        markersRef.current.set(t.id, m);
      }
    }

    // Drop technicians that disappeared (deactivated between polls).
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) { m.remove(); markersRef.current.delete(id); }
    }

    if (!fittedRef.current && located.length) {
      fittedRef.current = true;
      const bounds = L.latLngBounds(located.map((t) => [Number(t.last_lat), Number(t.last_lng)]));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    }
  }, [located]);

  function focus(t) {
    const map = mapRef.current;
    const m = markersRef.current.get(t.id);
    if (!map || !m) return;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
    m.openPopup();
  }

  const counts = useMemo(() => {
    const c = { live: 0, recent: 0, stale: 0 };
    for (const t of located) c[freshness(t.location_at)]++;
    return c;
  }, [located]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Live Map</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Last known position of every active technician
            {updatedAt && <> · refreshed {updatedAt.toLocaleTimeString("en-IN")}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {["live", "recent", "stale"].map((k) => (
            <span key={k} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${TONE[k].chip}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: TONE[k].dot }} />
              {TONE[k].label} {counts[k]}
            </span>
          ))}
        </div>
      </div>

      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden p-0">
          <div ref={mapEl} className="h-[32rem] w-full lg:h-[38rem]" />
        </Card>

        <div className="space-y-3">
          {!loaded ? (
            <div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-slate-400">Loading…</div>
          ) : techs.length === 0 ? (
            <EmptyState icon="users" title="No technicians" hint="Add a technician to see them here." />
          ) : (
            <>
              {located.map((t) => {
                const tone = TONE[freshness(t.location_at)];
                return (
                  <Card key={t.id} className="p-3">
                    <button type="button" onClick={() => focus(t)} className="flex w-full items-start gap-2.5 text-left">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{t.full_name}</span>
                        <span className="block text-xs text-slate-400">
                          {tone.label} · {t.location_at ? timeAgo(t.location_at) : "never"}
                          {t.is_online ? " · on duty" : ""}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/technicians/${t.id}`)}
                      className="mt-2 text-xs font-medium text-brand hover:underline"
                    >
                      Open profile →
                    </button>
                  </Card>
                );
              })}

              {unlocated.length > 0 && (
                <Card className="p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    No location ({unlocated.length})
                  </h3>
                  <ul className="mt-2 space-y-1">
                    {unlocated.map((t) => (
                      <li key={t.id} className="truncate text-sm text-slate-500">{t.full_name}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-slate-400">
                    Shows once they open the app with location enabled.
                  </p>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
        <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          The technician app only reports GPS while it is open. Positions freeze when the app is
          backgrounded or the screen locks, so treat anything but a “Live” pin as historical.
        </span>
      </p>
    </div>
  );
}
