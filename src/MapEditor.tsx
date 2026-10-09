import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Search } from "lucide-react";
import { Circuit, GpsPoint, GpsZone, newId } from "./model";

type Mode = "none" | "start" | "pitEntry" | "pitExit" | "zone" | "point";

const MODES: { id: Mode; label: string; color: string }[] = [
  { id: "start", label: "Départ", color: "#49c998" },
  { id: "pitEntry", label: "Entrée stand", color: "#f08a3c" },
  { id: "pitExit", label: "Sortie stand", color: "#4c8dff" },
  { id: "zone", label: "Zone (ravito…)", color: "#f5c84b" },
  { id: "point", label: "Position", color: "#e6ecf5" },
];
const color = (m: Mode) => MODES.find((x) => x.id === m)!.color;

function valid(p: GpsPoint | null): p is GpsPoint {
  return (
    p !== null &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

function dot(c: string, label: string) {
  const el = document.createElement("div");
  el.className = "map-dot";
  el.style.setProperty("--c", c);
  el.textContent = label;
  return L.divIcon({ html: el, className: "", iconSize: [0, 0] });
}

const round = (n: number) => Number(n.toFixed(6));

export function MapEditor({
  circuit,
  onChange,
  disabled,
}: {
  circuit: Circuit;
  onChange: (patch: Partial<Circuit>) => void;
  disabled: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  // Map handlers are bound once, so they read latest values through this ref.
  const latest = useRef({ circuit, onChange, mode, disabled });
  latest.current = { circuit, onChange, mode, disabled };

  useEffect(() => {
    const m = L.map(box.current!, { center: [46.6, 2.4], zoom: 5 });
    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 20, maxNativeZoom: 19, attribution: "Imagery © Esri" },
    ).addTo(m);
    const plan = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: "© OpenStreetMap",
    });
    L.control.layers({ Satellite: satellite, Plan: plan }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      const { circuit: c, onChange: set, mode: md, disabled: off } =
        latest.current;
      if (off || md === "none") return;
      const p = { lat: round(e.latlng.lat), lng: round(e.latlng.lng) };
      if (md === "start") set({ start: p });
      else if (md === "pitEntry")
        set({ pitEntry: { ...p, radius: c.pitEntry?.radius ?? 15 } });
      else if (md === "pitExit")
        set({ pitExit: { ...p, radius: c.pitExit?.radius ?? 15 } });
      else if (md === "zone")
        set({
          zones: [
            ...c.zones,
            { id: newId(), name: `Ravito ${c.zones.length + 1}`, radius: 20, ...p },
          ],
        });
      else
        set({
          points: [
            ...c.points,
            { id: newId(), name: `Position ${c.points.length + 1}`, ...p },
          ],
        });
      setMode("none");
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const c = circuit;
    const draggable = !disabled;

    function marker(p: GpsPoint, col: string, label: string, move: (p: GpsPoint) => void) {
      const mk = L.marker([p.lat, p.lng], { icon: dot(col, label), draggable }).addTo(g!);
      mk.on("dragend", () => {
        const ll = mk.getLatLng();
        move({ lat: round(ll.lat), lng: round(ll.lng) });
      });
    }

    function zone<T extends GpsZone>(z: T, col: string, label: string, update: (z: T) => void) {
      const circle = L.circle([z.lat, z.lng], {
        radius: z.radius,
        color: col,
        weight: 2,
        fillOpacity: 0.2,
      }).addTo(g!);
      marker(z, col, label, (p) => update({ ...z, ...p }));
      if (!draggable) return;
      const south = circle.getBounds().getSouth();
      const handle = L.marker([south, z.lng], {
        icon: L.divIcon({ className: "map-handle", iconSize: [12, 12] }),
        draggable: true,
      }).addTo(g!);
      handle.on("drag", () => circle.setRadius(L.latLng(z.lat, z.lng).distanceTo(handle.getLatLng())));
      handle.on("dragend", () =>
        update({ ...z, radius: Math.max(1, Math.round(circle.getRadius())) }),
      );
    }

    if (valid(c.start)) marker(c.start, color("start"), "Départ", (p) => onChange({ start: p }));
    if (valid(c.pitEntry))
      zone(c.pitEntry, color("pitEntry"), "Entrée stand", (z) => onChange({ pitEntry: z }));
    if (valid(c.pitExit))
      zone(c.pitExit, color("pitExit"), "Sortie stand", (z) => onChange({ pitExit: z }));
    for (const z of c.zones)
      if (valid(z))
        zone(z, color("zone"), z.name || "Zone", (nz) =>
          onChange({ zones: c.zones.map((x) => (x.id === z.id ? nz : x)) }),
        );
    for (const p of c.points)
      if (valid(p))
        marker(p, color("point"), p.name || "Position", (np) =>
          onChange({ points: c.points.map((x) => (x.id === p.id ? { ...x, ...np } : x)) }),
        );
  }, [circuit, disabled]);

  // Re-center when another circuit is loaded.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = circuit;
    const all = [c.start, c.pitEntry, c.pitExit, ...c.zones, ...c.points].filter(valid);
    if (all.length)
      m.fitBounds(L.latLngBounds(all.map((p) => [p.lat, p.lng])), {
        padding: [40, 40],
        maxZoom: 18,
      });
  }, [circuit.id]);

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (pos) => map.current?.setView([pos.coords.latitude, pos.coords.longitude], 18),
      () => {},
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      );
      const [hit] = (await res.json()) as { lat: string; lon: string }[];
      if (hit) map.current?.setView([Number(hit.lat), Number(hit.lon)], 17);
    } catch {}
    setSearching(false);
  }

  return (
    <div className="map-editor">
      <form className="input-row" onSubmit={search}>
        <input
          placeholder="Chercher un circuit ou une adresse"
          value={query}
          maxLength={120}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="outline" type="submit" disabled={searching}>
          <Search size={15} />
        </button>
        <button className="outline" type="button" onClick={locate} title="Centrer sur ma position">
          <Crosshair size={15} />
        </button>
      </form>
      <div className="map-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            className={`map-mode${mode === m.id ? " map-mode-active" : ""}`}
            style={{ "--c": m.color } as React.CSSProperties}
            onClick={() => setMode(mode === m.id ? "none" : m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted tiny">
        {mode === "none"
          ? "Choisis un élément puis clique sur la carte. Glisse les points pour les déplacer, la poignée blanche pour changer le rayon d'une zone."
          : `Clique sur la carte pour placer : ${MODES.find((x) => x.id === mode)!.label}`}
      </p>
      <div ref={box} className={`map${mode !== "none" ? " map-placing" : ""}`} />
    </div>
  );
}
