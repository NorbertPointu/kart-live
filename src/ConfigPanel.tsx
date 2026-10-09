import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { Crosshair, MapPin, Plus, Save, Trash2, Users } from "lucide-react";
import { configured, db } from "./firebase";
import { MapEditor } from "./MapEditor";
import {
  Circuit,
  emptyCircuit,
  emptyLibrary,
  formatLap,
  GpsPoint,
  GpsZone,
  Library,
  newId,
  parseLap,
  RaceConfig,
} from "./model";

const LIB_KEY = "kart-live-library-v1";
const MAX_DRIVERS = 12;

function useLibrary(ready: boolean, setError: (e: string) => void) {
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  useEffect(() => {
    if (!configured) {
      try {
        const saved = localStorage.getItem(LIB_KEY);
        if (saved) setLibrary({ ...emptyLibrary, ...JSON.parse(saved) });
      } catch {}
      return;
    }
    if (!ready) return;
    return onSnapshot(
      doc(db!, "library", "default"),
      (snap) =>
        setLibrary(
          snap.exists()
            ? { ...emptyLibrary, ...(snap.data() as Library) }
            : emptyLibrary,
        ),
      (e) => setError(`Bibliothèque indisponible : ${e.code}`),
    );
  }, [ready]);
  async function saveLibrary(next: Library) {
    if (configured) {
      try {
        await setDoc(doc(db!, "library", "default"), next);
      } catch (e) {
        setError(`Bibliothèque : enregistrement impossible : ${String(e)}`);
      }
    } else {
      setLibrary(next);
      localStorage.setItem(LIB_KEY, JSON.stringify(next));
    }
  }
  return { library, saveLibrary };
}

function NumField({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  disabled: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    if (value === null ? text.trim() !== "" : Number(text) !== value)
      setText(value === null ? "" : String(value));
  }, [value]);
  return (
    <input
      inputMode="decimal"
      disabled={disabled}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim().replace(",", ".");
        const n = Number(t);
        if (t === "") onChange(null);
        else if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function LapField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(formatLap(value));
  useEffect(() => setText(formatLap(value)), [value]);
  const invalid = text.trim() !== "" && parseLap(text) === null;
  return (
    <div className="input-row">
      <label>{label}</label>
      <input
        disabled={disabled}
        placeholder="m:ss.mmm (ex. 0:48.512)"
        value={text}
        className={invalid ? "invalid" : ""}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const ms = parseLap(text);
          onChange(ms);
          setText(formatLap(ms));
        }}
      />
    </div>
  );
}

function validPoint(p: GpsPoint | null) {
  return (
    p !== null &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

function GpsEditor<T extends GpsPoint>({
  label,
  value,
  onChange,
  withRadius,
  disabled,
}: {
  label: string;
  value: T | null;
  onChange: (v: T | null) => void;
  withRadius?: boolean;
  disabled: boolean;
}) {
  const [locating, setLocating] = useState(false);
  const base = (value ?? {
    lat: 0,
    lng: 0,
    ...(withRadius ? { radius: 15 } : {}),
  }) as T;
  function set(patch: Partial<GpsZone>) {
    onChange({ ...base, ...patch } as T);
  }
  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        set({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
  const ok = validPoint(value);
  return (
    <div className="gps-editor">
      <strong>{label}</strong>
      <div className="input-row">
        <NumField
          disabled={disabled}
          placeholder="Latitude"
          value={value ? value.lat : null}
          onChange={(v) => set({ lat: v ?? 0 })}
        />
        <NumField
          disabled={disabled}
          placeholder="Longitude"
          value={value ? value.lng : null}
          onChange={(v) => set({ lng: v ?? 0 })}
        />
        {withRadius && (
          <NumField
            disabled={disabled}
            placeholder="Rayon (m)"
            value={value ? (value as unknown as GpsZone).radius : null}
            onChange={(v) => set({ radius: Math.max(1, v ?? 1) })}
          />
        )}
      </div>
      <div className="action-row">
        <button
          type="button"
          className="outline"
          disabled={disabled || locating}
          onClick={locate}
        >
          <Crosshair size={15} /> {locating ? "Localisation…" : "Ma position"}
        </button>
        {ok && (
          <a
            className="outline"
            target="_blank"
            rel="noreferrer noopener"
            href={`https://www.openstreetmap.org/?mlat=${value!.lat}&mlon=${value!.lng}#map=19/${value!.lat}/${value!.lng}`}
          >
            <MapPin size={15} /> Voir sur la carte
          </a>
        )}
        {value && (
          <button
            type="button"
            className="outline"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <Trash2 size={15} /> Effacer
          </button>
        )}
        {value && !ok && <span className="muted tiny">Coordonnées invalides</span>}
      </div>
    </div>
  );
}

export function ConfigPanel({
  config,
  canEdit,
  ready,
  activeDriver,
  onApply,
  setError,
}: {
  config: RaceConfig;
  canEdit: boolean;
  ready: boolean;
  activeDriver: string | null;
  onApply: (c: RaceConfig) => Promise<void>;
  setError: (e: string) => void;
}) {
  const [draft, setDraft] = useState<RaceConfig>(config);
  const [selected, setSelected] = useState("");
  const [saved, setSaved] = useState("");
  const { library, saveLibrary } = useLibrary(ready, setError);
  const configKey = JSON.stringify(config);
  useEffect(() => setDraft(config), [configKey]);
  const c = draft.circuit;
  const setCircuit = (patch: Partial<Circuit>) =>
    setDraft((d) => ({ ...d, circuit: { ...d.circuit, ...patch } }));
  const dirty = JSON.stringify(draft) !== configKey;

  function setCount(n: number) {
    const count = Math.min(MAX_DRIVERS, Math.max(1, Math.floor(n) || 1));
    const ds = draft.drivers.slice(0, count);
    if (activeDriver && draft.drivers.some((d) => d.id === activeDriver) && !ds.some((d) => d.id === activeDriver)) {
      setError("Impossible de retirer le pilote actuellement en piste.");
      return;
    }
    while (ds.length < count) ds.push({ id: newId(), name: "" });
    setDraft({ ...draft, drivers: ds });
  }

  function flash(text: string) {
    setSaved(text);
    setTimeout(() => setSaved(""), 2500);
  }

  async function apply() {
    const drivers = draft.drivers.map((d, i) => ({
      ...d,
      name: d.name.trim() || `Pilote ${i + 1}`,
    }));
    const circuit = { ...c, name: c.name.trim() };
    await onApply({ drivers, circuit });
    const names = Array.from(
      new Set([...library.driverNames, ...drivers.map((d) => d.name)]),
    ).sort((a, b) => a.localeCompare(b, "fr"));
    if (names.length !== library.driverNames.length)
      await saveLibrary({ ...library, driverNames: names });
    flash("Configuration appliquée à la course.");
  }

  async function saveCircuit() {
    if (!c.name.trim()) {
      setError("Donne un nom au circuit avant de l'enregistrer.");
      return;
    }
    const circuit = { ...c, name: c.name.trim() };
    const others = library.circuits.filter((x) => x.id !== circuit.id);
    await saveLibrary({ ...library, circuits: [...others, circuit] });
    setSelected(circuit.id);
    flash("Circuit enregistré dans la bibliothèque.");
  }

  async function deleteCircuit() {
    await saveLibrary({
      ...library,
      circuits: library.circuits.filter((x) => x.id !== selected),
    });
    setSelected("");
  }

  async function forgetDriver(name: string) {
    await saveLibrary({
      ...library,
      driverNames: library.driverNames.filter((n) => n !== name),
    });
  }

  const disabled = !canEdit;
  return (
    <section className="config">
      <article className="panel">
        <div className="panel-title">
          <h2>
            <MapPin size={19} /> Bibliothèque des circuits
          </h2>
        </div>
        <div className="input-row">
          <select
            disabled={disabled}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">— Circuits enregistrés ({library.circuits.length}) —</option>
            {library.circuits.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <button
            className="outline"
            disabled={disabled || !selected}
            onClick={() => {
              const found = library.circuits.find((x) => x.id === selected);
              if (found) setDraft({ ...draft, circuit: found });
            }}
          >
            Charger
          </button>
          <button
            className="outline"
            disabled={disabled || !selected}
            onClick={deleteCircuit}
          >
            <Trash2 size={15} />
          </button>
        </div>
        <div className="action-row">
          <button
            className="outline"
            disabled={disabled}
            onClick={() => {
              setDraft({ ...draft, circuit: emptyCircuit() });
              setSelected("");
            }}
          >
            <Plus size={15} /> Nouveau circuit
          </button>
          <button className="outline" disabled={disabled} onClick={saveCircuit}>
            <Save size={15} /> Enregistrer le circuit dans la bibliothèque
          </button>
        </div>
      </article>

      <article className="panel">
        <div className="panel-title">
          <h2>
            <MapPin size={19} /> Carte du circuit
          </h2>
        </div>
        <MapEditor circuit={c} onChange={setCircuit} disabled={disabled} />
      </article>

      <section className="columns">
        <div className="stack">
          <article className="panel">
            <div className="panel-title">
              <h2>
                <Users size={19} /> Pilotes
              </h2>
              <span className="pill">{draft.drivers.length} PILOTES</span>
            </div>
            <div className="input-row">
              <label>Nombre de pilotes</label>
              <input
                type="number"
                min={1}
                max={MAX_DRIVERS}
                disabled={disabled}
                value={draft.drivers.length}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
            <datalist id="known-drivers">
              {library.driverNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {draft.drivers.map((d, i) => (
              <div className="input-row" key={d.id}>
                <label>#{i + 1}</label>
                <input
                  list="known-drivers"
                  disabled={disabled}
                  maxLength={30}
                  placeholder={`Pilote ${i + 1}`}
                  value={d.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      drivers: draft.drivers.map((x) =>
                        x.id === d.id ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
            ))}
            {library.driverNames.length > 0 && (
              <div className="chips">
                <span className="muted tiny">Pilotes connus :</span>
                {library.driverNames.map((n) => (
                  <span className="pill" key={n}>
                    {n}
                    <button
                      className="chip-x"
                      disabled={disabled}
                      title="Oublier ce pilote"
                      onClick={() => forgetDriver(n)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </article>

          <article className="panel">
            <div className="panel-title">
              <h2>
                <MapPin size={19} /> Circuit
              </h2>
            </div>
            <div className="input-row">
              <label>Nom</label>
              <input
                disabled={disabled}
                maxLength={60}
                placeholder="Nom du circuit"
                value={c.name}
                onChange={(e) => setCircuit({ name: e.target.value })}
              />
            </div>
            <LapField
              label="Meilleur tour sec"
              disabled={disabled}
              value={c.bestLapDry}
              onChange={(v) => setCircuit({ bestLapDry: v })}
            />
            <LapField
              label="Meilleur tour mouillé"
              disabled={disabled}
              value={c.bestLapWet}
              onChange={(v) => setCircuit({ bestLapWet: v })}
            />
          </article>
        </div>

        <div className="stack">
          <article className="panel">
            <div className="panel-title">
              <h2>
                <Crosshair size={19} /> Points clés GPS
              </h2>
            </div>
            <GpsEditor
              label="Point de départ"
              disabled={disabled}
              value={c.start}
              onChange={(v) => setCircuit({ start: v })}
            />
            <GpsEditor
              label="Zone entrée des stands"
              withRadius
              disabled={disabled}
              value={c.pitEntry}
              onChange={(v) => setCircuit({ pitEntry: v })}
            />
            <GpsEditor
              label="Zone sortie des stands"
              withRadius
              disabled={disabled}
              value={c.pitExit}
              onChange={(v) => setCircuit({ pitExit: v })}
            />
          </article>

          <article className="panel">
            <div className="panel-title">
              <h2>
                <MapPin size={19} /> Positions et zones GPS
              </h2>
            </div>
            {c.points.map((p) => (
              <div className="gps-item" key={p.id}>
                <div className="input-row">
                  <input
                    disabled={disabled}
                    maxLength={40}
                    placeholder="Nom de la position"
                    value={p.name}
                    onChange={(e) =>
                      setCircuit({
                        points: c.points.map((x) =>
                          x.id === p.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    className="outline"
                    disabled={disabled}
                    onClick={() =>
                      setCircuit({ points: c.points.filter((x) => x.id !== p.id) })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <GpsEditor
                  label="Position"
                  disabled={disabled}
                  value={p}
                  onChange={(v) =>
                    v &&
                    setCircuit({
                      points: c.points.map((x) => (x.id === p.id ? v : x)),
                    })
                  }
                />
              </div>
            ))}
            {c.zones.map((z) => (
              <div className="gps-item" key={z.id}>
                <div className="input-row">
                  <input
                    disabled={disabled}
                    maxLength={40}
                    placeholder="Nom de la zone"
                    value={z.name}
                    onChange={(e) =>
                      setCircuit({
                        zones: c.zones.map((x) =>
                          x.id === z.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    className="outline"
                    disabled={disabled}
                    onClick={() =>
                      setCircuit({ zones: c.zones.filter((x) => x.id !== z.id) })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <GpsEditor
                  label="Zone"
                  withRadius
                  disabled={disabled}
                  value={z}
                  onChange={(v) =>
                    v &&
                    setCircuit({
                      zones: c.zones.map((x) => (x.id === z.id ? v : x)),
                    })
                  }
                />
              </div>
            ))}
            <div className="action-row">
              <button
                className="outline"
                disabled={disabled}
                onClick={() =>
                  setCircuit({
                    points: [
                      ...c.points,
                      { id: newId(), name: "", lat: 0, lng: 0 },
                    ],
                  })
                }
              >
                <Plus size={15} /> Position
              </button>
              <button
                className="outline"
                disabled={disabled}
                onClick={() =>
                  setCircuit({
                    zones: [
                      ...c.zones,
                      { id: newId(), name: "", lat: 0, lng: 0, radius: 20 },
                    ],
                  })
                }
              >
                <Plus size={15} /> Zone
              </button>
            </div>
          </article>
        </div>
      </section>

      <div className="config-footer">
        {saved && <span className="pill">{saved}</span>}
        <button
          className="outline"
          disabled={disabled || !dirty}
          onClick={() => setDraft(config)}
        >
          Annuler les modifications
        </button>
        <button
          className="primary"
          disabled={disabled || !dirty}
          onClick={apply}
        >
          <Save size={16} /> Appliquer à la course
        </button>
      </div>
    </section>
  );
}
