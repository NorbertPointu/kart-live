export type Driver = "A" | "B" | "C" | "D";
export type Signal = "READY" | "BOX" | "PUSH" | "STAY OUT" | "SLOW" | "CLEAR";
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
};
export const drivers: Driver[] = ["A", "B", "C", "D"];
export const initial: EventState = {
  signal: "READY",
  message: "",
  signalAt: 0,
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
};
export function totals(s: EventState, now: number) {
  const r: Record<Driver, { qualifying: number; race: number }> = {
    A: { qualifying: 0, race: 0 },
    B: { qualifying: 0, race: 0 },
    C: { qualifying: 0, race: 0 },
    D: { qualifying: 0, race: 0 },
  };
  for (const x of s.segments)
    r[x.driver][x.phase] += Math.max(0, x.end - x.start);
  if (s.activeDriver && s.activeSince !== null)
    r[s.activeDriver][s.phase] += Math.max(0, now - s.activeSince);
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
