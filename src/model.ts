export type Driver = string;
export type DriverInfo = {
  id: string;
  name: string;
  email?: string;
  color?: string;
  bestLapDry?: number | null;
  bestLapWet?: number | null;
};
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
export type PitWindow = {
  id: string;
  label: string;
  opensAt: number;
  closesAt: number;
  plannedAt: number | null;
  stopMinutes: number;
  status: "unplanned" | "planned" | "done";
};
export type PlannedRelay = {
  id: string;
  driver: Driver;
  durationMinutes: number;
};
export type RaceStrategy = {
  durationMinutes: number;
  minRelays: number;
  scheduledStartAt: number;
  qualifyingMinutes: number;
  qualifyingKarts: number;
  changeoverMinutes: number;
  minStintMinutes: number;
  maxStintMinutes: number;
  distributionMode: "next" | "remaining";
  qualifyingOrder: Driver[];
  qualifyingDone: Driver[];
  fuelWindows: PitWindow[];
  relays: PlannedRelay[];
};
export type EventState = {
  raceId: string;
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
  qualificationStartAt: number | null;
  qualificationFinishAt: number | null;
  updatedAt: number;
  config: RaceConfig;
  strategy: RaceStrategy;
};
export function currentPhase(
  state: Pick<
    EventState,
    "phase" | "startAt" | "qualificationStartAt" | "qualificationFinishAt"
  >,
): Phase {
  if (state.startAt !== null) return "race";
  if (state.qualificationStartAt !== null)
    return state.qualificationFinishAt === null ? "qualifying" : "race";
  return state.phase;
}
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
  drivers: ["#f5c84b", "#47c7b4", "#ff7b72", "#82aaff"].map((color, index) => ({
    id: String.fromCharCode(65 + index),
    name: `Pilote ${String.fromCharCode(65 + index)}`,
    color,
    bestLapDry: null,
    bestLapWet: null,
  })),
  circuit: { ...emptyCircuit(), id: "lille-karting", name: "Lille Karting" },
};
export const emptyLibrary: Library = { circuits: [], driverNames: [] };
export function defaultStrategy(driverIds: Driver[], now = Date.now()): RaceStrategy {
  const start = new Date(now);
  start.setHours(10, 35, 0, 0);
  const windowAt = (hours: number, minutes: number) => {
    const date = new Date(start);
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
  };
  return {
    durationMinutes: 240,
    minRelays: 7,
    scheduledStartAt: start.getTime(),
    qualifyingMinutes: 20,
    qualifyingKarts: 1,
    changeoverMinutes: 2,
    minStintMinutes: 10,
    maxStintMinutes: 45,
    distributionMode: "next",
    qualifyingOrder: [...driverIds],
    qualifyingDone: [],
    fuelWindows: [
      {
        id: "fuel-1",
        label: "Ravitaillement 1",
        opensAt: windowAt(11, 50),
        closesAt: windowAt(12, 20),
        plannedAt: null,
        stopMinutes: 10,
        status: "unplanned",
      },
      {
        id: "fuel-2",
        label: "Ravitaillement 2",
        opensAt: windowAt(13, 5),
        closesAt: windowAt(13, 35),
        plannedAt: null,
        stopMinutes: 10,
        status: "unplanned",
      },
    ],
    relays: [],
  };
}
export function normalize(data: Partial<EventState>): EventState {
  const config = data.config ?? defaultConfig;
  return {
    ...initial,
    ...data,
    config,
    strategy: {
      ...defaultStrategy(config.drivers.map((driver) => driver.id)),
      ...data.strategy,
    },
  };
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
  raceId: newId(),
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
  qualificationStartAt: null,
  qualificationFinishAt: null,
  updatedAt: Date.now(),
  config: defaultConfig,
  strategy: defaultStrategy(defaultConfig.drivers.map((driver) => driver.id)),
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
