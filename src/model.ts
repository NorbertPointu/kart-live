export type Driver = string;
export type DriverInfo = { id: string; name: string };
export type GpsPoint = { lat: number; lng: number };
export type GpsZone = GpsPoint & { radius: number };
export type NamedPoint = GpsPoint & { id: string; name: string };
export type NamedZone = GpsZone & { id: string; name: string };
export type Circuit = {
  id: string;
  name: string;
  bestLapDry: number | null;
  bestLapWet: number | null;
  start: GpsPoint | null;
  pitEntry: GpsZone | null;
  pitExit: GpsZone | null;
  points: NamedPoint[];
  zones: NamedZone[];
};
export type RaceConfig = { drivers: DriverInfo[]; circuit: Circuit };
/** Reusable data shared across races. */
export type Library = { circuits: Circuit[]; driverNames: string[] };
export type Signal =
  | "READY"
  | "BOX"
  | "PUSH"
  | "STAY OUT"
  | "SLOW"
  | "CLEAR"
  | "MESSAGE";
export type Phase = "qualifying" | "race";
export type Segment = {
  id: string;
  driver: Driver;
  phase: Phase;
  start: number;
  end: number;
};
export type EventState = {
  signal: Signal;
  message: string;
  signalAt: number;
  signalConfirmedAt: number;
  signalExpiresAt: number;
  activeDriver: Driver | null;
  activeSince: number | null;
  phase: Phase;
  segments: Segment[];
  pitSince: number | null;
  fuel1: boolean;
  fuel2: boolean;
  startAt: number | null;
  finishAt: number | null;
  updatedAt: number;
  config: RaceConfig;
};
export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
export function emptyCircuit(): Circuit {
  return {
    id: newId(),
    name: "",
    bestLapDry: null,
    bestLapWet: null,
    start: null,
    pitEntry: null,
    pitExit: null,
    points: [],
    zones: [],
  };
}
export const defaultConfig: RaceConfig = {
  drivers: ["A", "B", "C", "D"].map((id) => ({ id, name: `Pilote ${id}` })),
  circuit: { ...emptyCircuit(), id: "lille-karting", name: "Lille Karting" },
};
export const emptyLibrary: Library = { circuits: [], driverNames: [] };
export function normalize(data: Partial<EventState>): EventState {
  return { ...initial, ...data, config: data.config ?? defaultConfig };
}
export function driverName(s: EventState, id: Driver | null) {
  if (!id) return "";
  return s.config.drivers.find((d) => d.id === id)?.name || id;
}
export function formatLap(ms: number | null) {
  if (ms === null) return "";
  const m = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${sec}`;
}
/** Accepts "1:02.345" or "62.345". */
export function parseLap(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const ms = Math.round(
    (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000,
  );
  return ms > 0 ? ms : null;
}
export const initial: EventState = {
  signal: "READY",
  message: "",
  signalAt: 0,
  signalConfirmedAt: 0,
  signalExpiresAt: 0,
  activeDriver: null,
  activeSince: null,
  phase: "qualifying",
  segments: [],
  pitSince: null,
  fuel1: false,
  fuel2: false,
  startAt: null,
  finishAt: null,
  updatedAt: Date.now(),
  config: defaultConfig,
};
export function totals(s: EventState, now: number) {
  const r: Record<Driver, { qualifying: number; race: number }> = {};
  const add = (d: Driver, p: Phase, ms: number) => {
    if (!r[d]) r[d] = { qualifying: 0, race: 0 };
    r[d][p] += Math.max(0, ms);
  };
  for (const d of s.config.drivers) add(d.id, "race", 0);
  for (const x of s.segments) add(x.driver, x.phase, x.end - x.start);
  if (s.activeDriver && s.activeSince !== null)
    add(s.activeDriver, s.phase, now - s.activeSince);
  return r;
}
export function format(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export function clock(ts: number) {
  return new Date(ts).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
export function closeSegment(s: EventState, now: number): EventState {
  if (!s.activeDriver || s.activeSince === null) return s;
  return {
    ...s,
    segments: [
      ...s.segments,
      {
        id: `${now}-${s.activeDriver}`,
        driver: s.activeDriver,
        phase: s.phase,
        start: s.activeSince,
        end: now,
      },
    ],
    activeDriver: null,
    activeSince: null,
  };
}
