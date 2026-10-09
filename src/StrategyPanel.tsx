import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Clock3,
  Fuel,
  GripVertical,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import type { DriverInfo, RaceStrategy } from "./model";
import { format } from "./model";
import {
  buildStrategyTimeline,
  generateStrategy,
  moveRelay,
  pitWindowAt,
  removeQualifyingDriver,
  resizeRelay,
  scheduleQualifying,
  validateStrategy,
} from "./strategy";

function datetimeValue(timestamp: number | null) {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseDatetime(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function StrategyPanel({
  strategy,
  drivers,
  canEdit,
  onApply,
  onError,
}: {
  strategy: RaceStrategy;
  drivers: DriverInfo[];
  canEdit: boolean;
  onApply: (strategy: RaceStrategy) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(strategy);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(strategy), [strategy]);
  useEffect(() => {
    if (!draggingId) return;
    const finishDrag = (event: PointerEvent) => {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-relay-id]");
      const targetIndex = draft.relays.findIndex(
        (relay) => relay.id === target?.dataset.relayId,
      );
      const sourceIndex = draft.relays.findIndex((relay) => relay.id === draggingId);
      if (targetIndex >= 0 && sourceIndex >= 0 && targetIndex !== sourceIndex)
        setDraft((current) => ({
          ...current,
          relays: moveRelay(current.relays, sourceIndex, targetIndex),
        }));
      setDraggingId(null);
    };
    window.addEventListener("pointerup", finishDrag);
    return () => window.removeEventListener("pointerup", finishDrag);
  }, [draggingId, draft.relays]);

  const qualification = useMemo(
    () =>
      scheduleQualifying(
        draft.qualifyingOrder,
        draft.qualifyingMinutes,
        draft.qualifyingKarts,
        draft.scheduledStartAt - draft.qualifyingMinutes * 60_000,
      ),
    [draft.qualifyingOrder, draft.qualifyingMinutes, draft.qualifyingKarts, draft.scheduledStartAt],
  );
  const alerts = validateStrategy(draft);
  const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));
  const nextQualifyingDriver = drivers.find(
    (driver) => !draft.qualifyingOrder.includes(driver.id),
  );
  const timeline = useMemo(() => buildStrategyTimeline(draft), [draft]);

  function update(patch: Partial<RaceStrategy>) {
    setDraft((current) => ({ ...current, ...patch }));
  }
  function addQualifyingDriver() {
    if (!nextQualifyingDriver) return;
    update({ qualifyingOrder: [...draft.qualifyingOrder, nextQualifyingDriver.id] });
  }
  function updateWindow(id: string, patch: Partial<RaceStrategy["fuelWindows"][number]>) {
    setDraft((current) => ({
      ...current,
      fuelWindows: current.fuelWindows.map((window) =>
        window.id === id ? { ...window, ...patch } : window,
      ),
    }));
  }
  function regenerate() {
    if (
      draft.relays.length &&
      !window.confirm("Remplacer le planning actuel par une nouvelle proposition ?")
    )
      return;
    try {
      setDraft(generateStrategy(draft, drivers.map((driver) => driver.id)));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }
  async function apply() {
    await onApply(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }
  function changeStart(timestamp: number) {
    const shift = timestamp - draft.scheduledStartAt;
    setDraft((current) => ({
      ...current,
      scheduledStartAt: timestamp,
      fuelWindows: current.fuelWindows.map((window) => ({
        ...window,
        opensAt: window.opensAt + shift,
        closesAt: window.closesAt + shift,
        plannedAt: window.plannedAt === null ? null : window.plannedAt + shift,
      })),
    }));
  }
  function shiftRelay(index: number, direction: -1 | 1) {
    const destination = index + direction;
    setDraft((current) => ({
      ...current,
      relays: moveRelay(current.relays, index, destination),
    }));
  }
  function resize(index: number, value: number) {
    try {
      setDraft((current) =>
        resizeRelay(current, index, value),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="strategy-layout">
      <section className="panel strategy-panel">
        <div className="panel-title">
          <h2><CalendarClock size={19} /> Paramètres de course</h2>
          <button className="primary" disabled={!canEdit} onClick={regenerate}>
            <RefreshCw size={16} /> Générer une proposition
          </button>
        </div>
        <div className="strategy-fields">
          <label>Départ prévu<input type="datetime-local" disabled={!canEdit} value={datetimeValue(draft.scheduledStartAt)} onChange={(event) => {
            const value = parseDatetime(event.target.value);
            if (value !== null) changeStart(value);
          }} /></label>
          <label>Durée de course (min)<input type="number" min={1} disabled={!canEdit} value={draft.durationMinutes} onChange={(event) => update({ durationMinutes: Number(event.target.value) })} /></label>
          <label>Relais minimum<input type="number" min={1} disabled={!canEdit} value={draft.minRelays} onChange={(event) => update({ minRelays: Number(event.target.value) })} /></label>
          <label>Qualifications (min)<input type="number" min={1} disabled={!canEdit} value={draft.qualifyingMinutes} onChange={(event) => update({ qualifyingMinutes: Number(event.target.value) })} /></label>
          <label>Karts en qualif<input type="number" min={1} max={drivers.length} disabled={!canEdit} value={draft.qualifyingKarts} onChange={(event) => update({ qualifyingKarts: Number(event.target.value) })} /></label>
          <label>Changement pilote (min)<input type="number" min={0} disabled={!canEdit} value={draft.changeoverMinutes} onChange={(event) => update({ changeoverMinutes: Number(event.target.value) })} /></label>
          <label>Relais min. (min)<input type="number" min={1} disabled={!canEdit} value={draft.minStintMinutes} onChange={(event) => update({ minStintMinutes: Number(event.target.value) })} /></label>
          <label>Relais max. (min)<input type="number" min={1} disabled={!canEdit} value={draft.maxStintMinutes} onChange={(event) => update({ maxStintMinutes: Number(event.target.value) })} /></label>
        </div>
        <div className="strategy-inline-control">
          <label htmlFor="distribution-mode">Redistribution des durées</label>
          <select id="distribution-mode" disabled={!canEdit} value={draft.distributionMode} onChange={(event) => update({ distributionMode: event.target.value as RaceStrategy["distributionMode"] })}>
            <option value="next">Relais suivant uniquement</option>
            <option value="remaining">Répartir sur les relais suivants</option>
          </select>
        </div>
      </section>

      <section className="panel strategy-panel">
        <div className="panel-title">
          <h2><Fuel size={19} /> Fenêtres de ravitaillement</h2>
        </div>
        {draft.fuelWindows.map((window) => (
          <div className="fuel-window-editor" key={window.id}>
            <strong>{window.label}</strong>
            <label>Ouverture<input type="datetime-local" disabled={!canEdit} value={datetimeValue(window.opensAt)} onChange={(event) => {
              const value = parseDatetime(event.target.value);
              if (value !== null) updateWindow(window.id, { opensAt: value });
            }} /></label>
            <label>Fermeture<input type="datetime-local" disabled={!canEdit} value={datetimeValue(window.closesAt)} onChange={(event) => {
              const value = parseDatetime(event.target.value);
              if (value !== null) updateWindow(window.id, { closesAt: value });
            }} /></label>
            <label>Passage prévu<input type="datetime-local" disabled={!canEdit} value={datetimeValue(window.plannedAt)} onChange={(event) => {
              const value = parseDatetime(event.target.value);
              if (value !== null) updateWindow(window.id, pitWindowAt(window, value));
            }} /></label>
            <label>Arrêt (min)<input type="number" min={0} disabled={!canEdit} value={window.stopMinutes} onChange={(event) => updateWindow(window.id, { stopMinutes: Number(event.target.value) })} /></label>
          </div>
        ))}
      </section>

      <section className="panel strategy-panel">
        <div className="panel-title">
          <h2><Clock3 size={19} /> Timeline de course</h2>
          <span className="pill">ARRIVÉE PRÉVUE {new Date(draft.scheduledStartAt + draft.durationMinutes * 60_000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        {alerts.length > 0 && <ul className="strategy-alerts">{alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul>}
        {draft.relays.length ? (
          <div className="timeline-scroll" aria-label="Frise chronologique de la course">
            <div className="strategy-timeline">
              {timeline.map((item, index) => item.kind === "relay" ? (
                <article
                  className={`timeline-relay${draggingId === item.relay.id ? " timeline-dragging" : ""}`}
                  key={item.relay.id}
                  data-relay-id={item.relay.id}
                  style={{ flexGrow: item.relay.durationMinutes, "--driver-color": driverMap.get(item.relay.driver)?.color ?? "#f5c84b" } as CSSProperties}
                >
                  <div className="timeline-relay-head">
                    <button className="relay-drag-handle" aria-label={`Déplacer le relais ${index + 1}`} disabled={!canEdit} onPointerDown={() => setDraggingId(item.relay.id)}><GripVertical size={16} /></button>
                    <strong>RELAIS {index + 1}</strong>
                    <div className="relay-order-actions">
                      <button aria-label="Monter le relais" disabled={!canEdit || index === 0} onClick={() => shiftRelay(index, -1)}><ArrowUp size={14} /></button>
                      <button aria-label="Descendre le relais" disabled={!canEdit || index === draft.relays.length - 1} onClick={() => shiftRelay(index, 1)}><ArrowDown size={14} /></button>
                    </div>
                  </div>
                  <b>{driverMap.get(item.relay.driver)?.name ?? item.relay.driver}</b>
                  <span>{new Date(item.startAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} – {new Date(item.endAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <small>{item.relay.durationMinutes} min</small>
                  <input aria-label={`Durée du relais ${index + 1}`} type="range" min={draft.minStintMinutes} max={draft.maxStintMinutes} step={1} disabled={!canEdit || index === draft.relays.length - 1} value={item.relay.durationMinutes} onChange={(event) => resize(index, Number(event.target.value))} />
                </article>
              ) : (
                <article className="timeline-pit" key={`${item.window.id}-${index}`} style={{ flexGrow: item.window.stopMinutes }}>
                  <Fuel size={17} />
                  <strong>{item.window.label}</strong>
                  <span>{item.window.stopMinutes} min arrêt</span>
                  <small>{new Date(item.startAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small>
                </article>
              ))}
            </div>
          </div>
        ) : <p className="muted">Aucun relais planifié. Générez une proposition pour construire la frise.</p>}
        <div className="strategy-summary">
          {drivers.map((driver) => {
            const assigned = draft.relays.filter((relay) => relay.driver === driver.id);
            const minutes = assigned.reduce((total, relay) => total + relay.durationMinutes, 0);
            return <div key={driver.id} style={{ "--driver-color": driver.color ?? "#f5c84b" } as CSSProperties}>
              <span className="driver-swatch" /> <strong>{driver.name}</strong>
              <span>{assigned.length} relais · {format(minutes * 60_000)} prévus</span>
            </div>;
          })}
        </div>
      </section>

      <section className="panel strategy-panel">
        <div className="panel-title">
          <h2><Users size={19} /> Ordre des qualifications</h2>
          <div className="action-row qualifying-actions">
            <span className="pill">{draft.qualifyingKarts} KART(S) EN PARALLÈLE</span>
            <button
              className="outline"
              disabled={!canEdit || !nextQualifyingDriver}
              onClick={addQualifyingDriver}
            >
              <Plus size={15} /> Ajouter un pilote
            </button>
          </div>
        </div>
        {qualification.map((slot, index) => <div className="qualifying-row" key={`${slot.driver}-${index}`}>
          <strong>#{slot.order}</strong>
          <span>{driverMap.get(slot.driver)?.name ?? slot.driver}</span>
          <time>{new Date(slot.startAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} – {new Date(slot.endAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time>
          <span>{Math.round(slot.durationMinutes)} min</span>
          <span className="relay-order-actions">
            <button aria-label="Monter dans l'ordre" disabled={!canEdit || index === 0} onClick={() => update({ qualifyingOrder: moveRelay(draft.qualifyingOrder.map((driver) => ({ id: driver, driver, durationMinutes: 1 })), index, index - 1).map((relay) => relay.driver) })}><ArrowUp size={14} /></button>
            <button aria-label="Descendre dans l'ordre" disabled={!canEdit || index === qualification.length - 1} onClick={() => update({ qualifyingOrder: moveRelay(draft.qualifyingOrder.map((driver) => ({ id: driver, driver, durationMinutes: 1 })), index, index + 1).map((relay) => relay.driver) })}><ArrowDown size={14} /></button>
            <button
              className="remove-qualifier"
              aria-label={`Retirer ${driverMap.get(slot.driver)?.name ?? slot.driver} des qualifications`}
              title="Ne participe pas aux qualifications"
              disabled={!canEdit || draft.qualifyingOrder.length <= 1}
              onClick={() => update({
                qualifyingOrder: removeQualifyingDriver(draft.qualifyingOrder, slot.driver),
                qualifyingDone: draft.qualifyingDone.filter((driver) => driver !== slot.driver),
              })}
            ><Trash2 size={14} /></button>
          </span>
        </div>)}
      </section>

      <div className="strategy-footer">
        <span className="muted tiny">Les modifications sont partagées après enregistrement.</span>
        <button className="primary" disabled={!canEdit} onClick={apply}><Save size={16} /> {saved ? "Enregistré" : "Enregistrer la stratégie"}</button>
      </div>
    </div>
  );
}