import "./style.css";

import {
  Clock3,
  CalendarClock,
  CarFront,
  Check,
  Flag,
  Fuel,
  LogIn,
  LogOut,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Driver,
  EventState,
  Signal,
  clock,
  closeSegment,
  countRaceRelays,
  currentPhase,
  driverName,
  format,
  formatLap,
  initial,
  newId,
  normalize,
  totals,
} from "./model";
import React, { useEffect, useState } from "react";
import {
  User,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth, configured, db, eventId } from "./firebase";
import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
} from "firebase/firestore";

import { ConfigPanel } from "./ConfigPanel";
import { StrategyPanel } from "./StrategyPanel";
import {
  buildStrategyTimeline,
  driverToPutOnTrack,
  firstStrategyRelayDriver,
  nextStrategyRelayDriver,
  nextPlannedDriverAt,
  plannedDriverAt,
  strategyRelayIndex,
} from "./strategy";
import { FirebaseError } from "firebase/app";
import { createRoot } from "react-dom/client";
const ADMIN_UID = "k080KWL0WJTnbHzEJARVLfdzKWo1";
const KEY = "kart-live-demo-v1";
const HISTORY_KEY = `${KEY}-history`;
const channel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(KEY) : null;
function App() {
  const [role, setRole] = useState<"stand" | "driver">(
    location.pathname.startsWith("/driver") ? "driver" : "stand",
  );
  const [compactMobile, setCompactMobile] = useState(
    () => window.matchMedia("(max-width: 530px)").matches,
  );
  const [state, setState] = useState<EventState>(initial);
  const [now, setNow] = useState(Date.now());
  const [user, setUser] = useState<User | null>(null);
  const [online, setOnline] = useState(!configured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [admin, setAdmin] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmFinishQualification, setConfirmFinishQualification] = useState(false);
  const [confirmFinishRace, setConfirmFinishRace] = useState(false);
  const [tab, setTab] = useState<"race" | "strategy" | "config">("race");
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 530px)");
    const update = () => setCompactMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!configured) {
      try {
        const saved = localStorage.getItem(KEY);
        if (saved) setState(normalize(JSON.parse(saved)));
      } catch {}
      const listener = (e: MessageEvent) => setState(normalize(e.data));
      channel?.addEventListener("message", listener);
      const storage = (e: StorageEvent) => {
        if (e.key === KEY && e.newValue)
          try {
            setState(normalize(JSON.parse(e.newValue)));
          } catch {}
      };
      window.addEventListener("storage", storage);
      return () => {
        channel?.removeEventListener("message", listener);
        window.removeEventListener("storage", storage);
      };
    }
    const unsub = onAuthStateChanged(auth!, async (u) => {
      setUser(u);
      setAdmin(Boolean(u && !u.isAnonymous && u.uid === ADMIN_UID));
      if (u && !u.isAnonymous && u.uid !== ADMIN_UID) {
        setError(`Ce compte n'est pas administrateur. UID connecté : ${u.uid}. Vérifier l'UID autorisé dans l'application et les règles Firestore.`);
      }
      if (!u && location.pathname.startsWith("/driver"))
        try {
          await signInAnonymously(auth!);
        } catch (e) {
          setError(String(e));
        }
    });
    return () => unsub();
  }, []);
  useEffect(() => {
    if (!configured || !user) return;
    const ref = doc(db!, "events", eventId);
    return onSnapshot(
      ref,
      (snap) => {
        setOnline(true);
        if (snap.exists()) setState(normalize(snap.data() as EventState));
        else setState(initial);
      },
      () => setOnline(false),
    );
  }, [user]);
  async function save(next: EventState, type = "state_updated"): Promise<boolean> {
    if (configured && !admin) {
      setError("Connexion administrateur requise pour modifier la course.");
      return false;
    }
    const updated = { ...next, updatedAt: Date.now() };
    const entry = {
      id: newId(),
      type,
      at: updated.updatedAt,
      raceId: updated.raceId,
      state: updated,
    };
    if (configured) {
      try {
        const batch = writeBatch(db!);
        batch.set(doc(db!, "events", eventId), updated);
        batch.set(doc(db!, "events", eventId, "races", updated.raceId), {
          ...updated,
          status: updated.finishAt === null ? "active" : "finished",
        });
        batch.set(doc(collection(db!, "events", eventId, "history")), entry);
        await batch.commit();
        return true;
      } catch (e) {
        setError(
          e instanceof FirebaseError && e.code === "permission-denied"
            ? "Enregistrement refusé par Firestore. Vérifier le projet Firebase et publier les règles avec firebase deploy --only firestore:rules. Les écritures dans events, races et history doivent toutes être autorisées."
            : `Enregistrement impossible : ${String(e)}`,
        );
          return false;
      }
    } else {
      setState(updated);
      localStorage.setItem(KEY, JSON.stringify(updated));
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      history.push(entry);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      channel?.postMessage(updated);
      return true;
    }
  }
  const elapsed =
    state.startAt !== null
      ? Math.min(now, state.finishAt ?? Infinity) - state.startAt
      : 0;
  const pilotSessionElapsed =
    state.activeDriver !== null && state.activeSince !== null
      ? Math.max(0, now - state.activeSince)
      : 0;
  const qualificationElapsed =
    state.qualificationStartAt !== null
      ? Math.max(
          0,
          Math.min(now, state.qualificationFinishAt ?? Infinity) -
            state.qualificationStartAt,
        )
      : 0;
  const total = totals(state, now);
  const team = state.config.drivers;
  const circuit = state.config.circuit;
  const driven = (id: Driver) =>
    (total[id]?.qualifying ?? 0) + (total[id]?.race ?? 0);
  const drivenAll = team.length ? team.map((d) => driven(d.id)) : [0];
  const boxConfirmed =
    state.signal === "BOX" && state.signalConfirmedAt === state.signalAt;
  const boxAwaitingAck =
    role === "driver" &&
    state.signal === "BOX" &&
    !boxConfirmed;
  const effectiveSignal =
    boxAwaitingAck ||
    now <= state.signalExpiresAt
      ? state.signal
      : "READY";
  const signalExpired = state.signalExpiresAt > 0 && now > state.signalExpiresAt;
  const hasPilotMessage =
    effectiveSignal === "MESSAGE" ||
    (effectiveSignal !== "READY" && Boolean(state.message.trim()));
  const signalDescription: Record<Signal, string> = {
    READY: "EN ATTENTE DES CONSIGNES",
    BOX: "BOX",
    PUSH: "GO",
    "STAY OUT": "RESTE EN PISTE",
    SLOW: "RALENTIS",
    CLEAR: "PISTE LIBRE",
    MESSAGE: "MESSAGE DU STAND",
  };
  const canEdit = !configured || admin;
  const phase = currentPhase(state);
  const pilotModeFinished = state.finishAt !== null;
  const phaseStarted = phase === "qualifying"
    ? state.qualificationStartAt !== null
    : state.startAt !== null;
  const phaseFinished = phase === "qualifying"
    ? state.qualificationFinishAt !== null
    : state.finishAt !== null;
  const phaseActive = phaseStarted && !phaseFinished;
  const phaseElapsed = phase === "qualifying" ? qualificationElapsed : elapsed;
  const phaseDuration =
    (phase === "qualifying"
      ? state.strategy.qualifyingMinutes
      : state.strategy.durationMinutes) * 60_000;
  const remainingTime = Math.max(0, phaseDuration - phaseElapsed);
  const raceInProgress = state.startAt !== null && state.finishAt === null;
  const completedRaceRelays = state.segments.filter((segment) => segment.phase === "race").length;
  const raceRelayCount = countRaceRelays(state);
  const lastRaceDriver = state.segments
    .slice()
    .reverse()
    .find((segment) => segment.phase === "race")?.driver ?? null;
  const plannedDriver =
    state.finishAt === null
      ? plannedDriverAt(
          state.strategy,
          phase,
          now,
          state.qualificationStartAt,
          state.startAt,
        )
      : null;
    const currentDriver = phase === "race"
      ? state.activeDriver ?? (state.pitSince !== null ? lastRaceDriver ?? plannedDriver : plannedDriver)
      : state.activeDriver ?? plannedDriver;
    const activeQualifyingIndex = state.activeDriver
      ? state.strategy.qualifyingOrder.indexOf(state.activeDriver)
      : -1;
    const nextDriver = phase === "race" && state.strategy.relays.length &&
      (state.activeDriver !== null || state.pitSince !== null)
      ? nextStrategyRelayDriver(state.strategy, completedRaceRelays, state.activeDriver)
      : phase === "qualifying" && activeQualifyingIndex >= 0
        ? state.strategy.qualifyingOrder[activeQualifyingIndex + 1] ?? null
        : nextPlannedDriverAt(
            state.strategy,
            phase,
            now,
            state.qualificationStartAt,
            state.startAt,
          );
    const initialRaceRelayPending = phase === "race" && phaseActive &&
      state.activeDriver === null && state.pitSince === null;
    const driverToStartOnTrack = driverToPutOnTrack(
      phase,
      state.activeDriver !== null,
      state.pitSince !== null,
      currentDriver,
      nextDriver,
    );
  const raceTimeline = buildStrategyTimeline(
    state.strategy,
    state.startAt ?? state.strategy.scheduledStartAt,
  );
  const completedRelayPosition = Math.max(0, completedRaceRelays - 1);
  const actualRelayPosition = phase === "race" && state.activeDriver !== null
    ? strategyRelayIndex(state.strategy, completedRaceRelays, state.activeDriver)
    : phase === "race" && state.pitSince !== null
      ? strategyRelayIndex(state.strategy, completedRelayPosition, lastRaceDriver)
      : null;
  const currentRelayNumber = Math.max(
    1,
    actualRelayPosition !== null && actualRelayPosition >= 0
      ? actualRelayPosition + 1
      : completedRaceRelays + 1,
  );
  const driverRelayNumber = phase === "qualifying"
    ? Math.max(1, state.strategy.qualifyingOrder.indexOf(currentDriver ?? "") + 1)
    : currentRelayNumber;
  const nextStrategyRelayPosition = strategyRelayIndex(
    state.strategy,
    actualRelayPosition !== null && actualRelayPosition >= 0
      ? actualRelayPosition + 1
      : completedRaceRelays,
    nextDriver,
  );
  const nextRelayNumber = nextStrategyRelayPosition >= 0
    ? nextStrategyRelayPosition + 1
    : currentRelayNumber + 1;
  const nextPlannedPit = raceTimeline.find(
    (item) =>
      item.kind === "pit" &&
      item.window.status === "planned" &&
      (state.startAt === null || item.endAt > now),
  );
  function start(driver: Driver, eventType = "relay_started") {
    const t = Date.now();
    const closed = closeSegment(state, t);
    const previousRaceDriver = state.activeDriver ??
      (state.pitSince !== null ? lastRaceDriver : plannedDriver);
    const isRaceChange = phase === "race" &&
      state.startAt !== null &&
      previousRaceDriver !== null &&
      previousRaceDriver !== driver;
    void save({
      ...closed,
      activeDriver: driver,
      activeSince: t,
      raceChanges: state.raceChanges + Number(isRaceChange),
      pitSince: null,
      signal: "MESSAGE",
      message: `Go ${driverName(state, driver)}`,
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 10000,
      phase,
    }, eventType);
  }
  function completeStrategicChange() {
    if (state.activeDriver) {
      pit();
      return;
    }
    if (state.pitSince === null && currentDriver)
      start(currentDriver, "relay_started");
  }
  function startNextDriver() {
    if (!phaseActive || !driverToStartOnTrack) return;
    const eventType = phase === "qualifying"
      ? "qualification_driver_started"
      : state.activeDriver ? "driver_change_completed" : "relay_started";
    start(driverToStartOnTrack, eventType);
  }
  function pit() {
    const t = Date.now();
    const closed = closeSegment(state, t);
    void save(
      { ...closed, pitSince: t, signal: "READY", message: "", signalExpiresAt: 0 },
      "relay_ended",
    );
  }
  function send(signal: Signal) {
    const t = Date.now();
    void save({
      ...state,
      signal,
      message: message.trim().slice(0, 80),
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 120000,
    }, `signal_${signal.toLowerCase().replace(" ", "_")}`);
  }
  function sendCustomMessage() {
    const text = message.trim().slice(0, 80);
    if (!text) return;
    const t = Date.now();
    void save({
      ...state,
      signal: "MESSAGE",
      message: text,
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 20000,
    }, "custom_message_sent");
    setMessage("");
  }
  async function acknowledgeBox() {
    if (state.signal !== "BOX" || !boxAwaitingAck) return;
    const confirmedAt = state.signalAt;
    const updatedAt = Date.now();
    const updated = { ...state, signalConfirmedAt: confirmedAt, updatedAt };
    const entry = {
      id: newId(),
      type: "box_acknowledged",
      at: updatedAt,
      raceId: state.raceId,
      state: updated,
    };
    setState(updated);
    if (configured) {
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, "events", eventId), {
          signalConfirmedAt: confirmedAt,
          updatedAt,
        });
        batch.set(doc(collection(db!, "events", eventId, "history")), entry);
        await batch.commit();
      } catch (e) {
        setError(`Confirmation impossible : ${String(e)}`);
      }
    } else {
      localStorage.setItem(KEY, JSON.stringify(updated));
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      history.push(entry);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      channel?.postMessage(updated);
    }
  }
  function startRace() {
    const t = Date.now();
    const isNewRace = state.finishAt !== null;
    const next = isNewRace
      ? {
          ...state,
          raceId: newId(),
          activeDriver: null,
          activeSince: null,
          segments: [],
          raceChanges: 0,
          pitSince: null,
          fuel1: false,
          fuel2: false,
          signal: "READY" as Signal,
          message: "",
          signalAt: 0,
          signalConfirmedAt: 0,
          signalExpiresAt: 0,
          phase: "race",
          qualificationStartAt: null,
          qualificationFinishAt: null,
          strategy: {
            ...state.strategy,
            qualifyingDone: [],
          },
        }
      : state;
    const startingDriver = firstStrategyRelayDriver(next.strategy);
    void save({
      ...next,
      activeDriver: startingDriver,
      activeSince: startingDriver !== null ? t : null,
      phase: "race",
      startAt: t,
      finishAt: null,
      signal: "MESSAGE",
      message: "Go Go Go",
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 10_000,
    }, "race_started");
  }
  function startQualification() {
    const t = Date.now();
    void save({
      ...state,
      phase: "qualifying",
      qualificationStartAt: t,
      qualificationFinishAt: null,
      signal: "MESSAGE",
      message: "Vas-y fume les",
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 10_000,
    }, "qualification_started");
  }
  function finishQualification() {
    const t = Date.now();
    setConfirmFinishQualification(false);
    const closed = closeSegment(state, t);
    void save({
      ...closed,
      phase: "race",
      qualificationFinishAt: t,
      signal: "READY",
      message: "",
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: 0,
    }, "qualification_finished");
  }
  function createNewQualification(source: EventState): EventState {
    return {
      ...source,
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
      raceChanges: 0,
      pitSince: null,
      fuel1: false,
      fuel2: false,
      startAt: null,
      finishAt: null,
      qualificationStartAt: null,
      qualificationFinishAt: null,
      strategy: {
        ...source.strategy,
        qualifyingDone: [],
        fuelWindows: source.strategy.fuelWindows.map((window) => ({
          ...window,
          status: window.plannedAt === null ? "unplanned" : "planned",
        })),
      },
    };
  }
  async function finishRace() {
    const t = Date.now();
    const finished = { ...closeSegment(state, t), finishAt: t, pitSince: t };
    if (!(await save(finished, "race_finished"))) return;
    setConfirmFinishRace(false);
    await save(createNewQualification(finished), "race_reset");
  }
  function prepareNewQualification() {
    void save({
      ...createNewQualification(state),
    }, "race_reset");
  }
  function goRole(r: "stand" | "driver") {
    history.pushState({}, "", r === "driver" ? "/driver" : "/");
    setRole(r);
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await signInWithEmailAndPassword(auth!, email, password);
      setPassword("");
    } catch {
      setError("Identifiants invalides ou connexion indisponible.");
    }
  }
  const fuel1Window =
    now >= new Date().setHours(11, 50, 0, 0) &&
    now <= new Date().setHours(12, 20, 0, 0);
  const fuel2Window =
    now >= new Date().setHours(13, 5, 0, 0) &&
    now <= new Date().setHours(13, 35, 0, 0);
  return (
    <div className={`app ${role === "driver" ? "driver-app" : ""}`}>
      {role === "stand" && (
        <header className="topbar">
          <div className="brand">
            <Flag size={25} />
            <span>
              KART<span className="accent">LIVE</span>
            </span>
            <small>ENDURANCE</small>
          </div>
          <div className="top-actions">
            <span className={`connection ${online ? "good" : "bad"}`}>
              {online ? <Wifi size={15} /> : <WifiOff size={15} />} {" "}
              {configured
                ? online
                  ? "SYNC LIVE"
                  : "HORS LIGNE"
                : "DÉMO LOCALE"}
            </span>
            <button className="subtle" onClick={() => goRole("driver")}>
              Vue pilote
            </button>
          </div>
        </header>
      )}
      {role === "driver" ? (
        <main className={`driver-view${hasPilotMessage ? " driver-view-with-message" : ""}`}>
          <div className="driver-meta">
            <span>MESSAGE DU STAND</span>
            <div className="driver-meta-status">
              <span>REÇU {state.signalAt ? clock(state.signalAt) : "—"}</span>
              <span
                className={`driver-connection ${online ? "good" : "bad"}`}
                aria-label={
                  configured
                    ? online
                      ? "Connexion active"
                      : "Hors ligne"
                    : "Mode démo locale"
                }
                title={
                  configured
                    ? online
                      ? "Connexion active"
                      : "Hors ligne"
                    : "Mode démo locale"
                }
              >
                {online ? <Wifi size={16} /> : <WifiOff size={16} />}
              </span>
            </div>
          </div>
          <button
            type="button"
            className={`signal signal-${effectiveSignal.replace(" ", "-")}${pilotModeFinished ? " signal-finished" : ""}${state.startAt === null && effectiveSignal === "READY" ? " signal-start" : ""}${effectiveSignal === "BOX" ? " signal-box-clickable" : ""}${boxAwaitingAck && effectiveSignal === "BOX" ? " signal-flashing" : ""}${boxConfirmed && effectiveSignal === "BOX" ? " signal-confirmed" : ""}`}
            disabled={pilotModeFinished || effectiveSignal !== "BOX" || !boxAwaitingAck}
            onClick={() => {
              if (pilotModeFinished || state.signal !== "BOX" || !boxAwaitingAck) return;
              void acknowledgeBox();
            }}
            aria-label={
              effectiveSignal === "BOX"
                ? !boxAwaitingAck
                  ? "Consigne BOX confirmée"
                  : "Confirmer la consigne BOX"
                : undefined
            }
          >
            <span className="signal-title">
              {pilotModeFinished
                ? "ARRIVÉE"
                : signalExpired || state.pitSince !== null
                  ? ""
                : effectiveSignal === "MESSAGE"
                  ? state.message
                  : effectiveSignal === "READY"
                    ? state.startAt === null
                      ? phase === "race" ? "PRÊT POUR LE DÉPART" : "DÉPART"
                      : state.pitSince !== null
                        ? "EN ATTENTE"
                        : state.activeDriver
                          ? "EN PISTE"
                          : "PRÊT POUR LE DÉPART"
                    : signalDescription[effectiveSignal]}
            </span>
          </button>
          <div className="driver-side">
            {effectiveSignal !== "READY" &&
              effectiveSignal !== "MESSAGE" &&
              state.message && (
                <div className="driver-note">
                  <small>INFO COMPLÉMENTAIRE</small>
                  <span>{state.message}</span>
                </div>
              )}
            <div className={`driver-bottom driver-live-metrics${phase === "qualifying" ? " driver-qualifying-metrics" : ""}`}>
              {phase === "qualifying" ? (
                <div className="driver-qualifying-card">
                  <div className="driver-qualifying-pilot">
                    <small>QUALIFICATION · PASSAGE N° {driverRelayNumber}</small>
                    <strong>{driverName(state, currentDriver) || "—"}</strong>
                  </div>
                    <div className="driver-qualifying-clock">
                      <small>TEMPS DU PILOTE</small>
                      <strong>{format(pilotSessionElapsed)}</strong>
                    </div>
                  <div className="driver-qualifying-clock">
                    <small>TEMPS DE QUALIFICATION</small>
                    <strong>{format(phaseElapsed)}</strong>
                  </div>
                </div>
              ) : (
                <>
                  <div className="driver-timer driver-pilot-timer">
                    <small>RELAIS N° {driverRelayNumber} · {driverName(state, currentDriver) || "—"}</small>
                    <strong>{format(pilotSessionElapsed)}</strong>
                    <span className="driver-timer-caption">TEMPS DU RELAIS PILOTE</span>
                  </div>
                  <div className="driver-timer driver-global-timer">
                    <small>TEMPS DE COURSE</small>
                    <strong>{format(phaseElapsed)}</strong>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      ) : (
        <main className="dashboard">
          <div className="heading">
            <div>
              <p className="eyebrow">
                {(circuit.name || "Circuit").toUpperCase()} · {team.length}{" "}
                PILOTES
              </p>
              <h1>Centre de course</h1>
              <p className="muted">
                10h35 — 14h35 · 4 heures · 7 relais minimum
                {circuit.bestLapDry !== null &&
                  ` · Record sec ${formatLap(circuit.bestLapDry)}`}
                {circuit.bestLapWet !== null &&
                  ` · Record mouillé ${formatLap(circuit.bestLapWet)}`}
              </p>
            </div>
            <div className="right-head">
              {configured && !admin ? (
                <button
                  className="primary"
                  onClick={() =>
                    document
                      .getElementById("login")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  <LogIn size={16} /> Connexion stand
                </button>
              ) : (
                <span className="pill">
                  <ShieldCheck size={15} /> {configured ? "ADMIN" : "MODE DÉMO"}
                </span>
              )}
            </div>
          </div>
          {error && (
            <div className="error">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          <nav className="tabs">
            <button
              className={tab === "race" ? "tab tab-active" : "tab"}
              onClick={() => setTab("race")}
            >
              <Flag size={16} /> Course
            </button>
            <button
              className={tab === "strategy" ? "tab tab-active" : "tab"}
              onClick={() => setTab("strategy")}
            >
              <CalendarClock size={16} /> Stratégie
            </button>
            <button
              className={tab === "config" ? "tab tab-active" : "tab"}
              onClick={() => setTab("config")}
            >
              <Settings size={16} /> Configuration
            </button>
          </nav>
          {tab === "config" ? (
            <ConfigPanel
              config={state.config}
              canEdit={canEdit}
              ready={Boolean(user)}
              activeDriver={state.activeDriver}
              setError={setError}
              onApply={async (config) => {
                await save({ ...state, config }, "configuration_updated");
              }}
            />
          ) : tab === "strategy" ? (
            <StrategyPanel
              strategy={state.strategy}
              drivers={team}
              canEdit={canEdit}
              onError={setError}
              onApply={async (strategy) => {
                await save({ ...state, strategy }, "strategy_updated");
              }}
            />
          ) : (
          <>
          <section className="race-phase-panel" aria-label="Phases de l’épreuve">
            <div className="phase-switch" aria-label="Mode de l’épreuve">
              <span
                className={phase === "qualifying" ? "phase-tab phase-tab-active" : "phase-tab"}
                aria-current={phase === "qualifying" ? "step" : undefined}
              >
                Qualifications
              </span>
              <span
                className={phase === "race" ? "phase-tab phase-tab-active" : "phase-tab"}
                aria-current={phase === "race" ? "step" : undefined}
              >
                Course
              </span>
            </div>
            <div className="race-phase-status">
              <div className="phase-timer">
                <small>{phase === "qualifying" ? "QUALIFICATIONS" : "COURSE"}</small>
                <strong>{format(phaseElapsed)}</strong>
                <span className="phase-running">
                  {phaseActive ? "EN COURS" : phaseFinished ? "TERMINÉ" : "PRÊT"}
                </span>
              </div>
              <div className="phase-remaining">
                <small>TEMPS RESTANT</small>
                <strong>{format(remainingTime)}</strong>
              </div>
            </div>
          </section>
          <section className={`relay-focus-row${phaseActive ? "" : " relay-focus-ready"}${effectiveSignal === "BOX" ? " relay-focus-box-sent" : ""}${phase === "race" && !nextDriver ? " relay-focus-finish" : ""}`} aria-label="Pilotes et consigne BOX">
            <article className="stat stat-current">
              <span><Users size={17} /> {initialRaceRelayPending ? "PILOTE PRÉVU" : "PILOTE ACTUEL"}</span>
              <strong>{driverName(state, currentDriver) || "—"}</strong>
              {phaseActive && state.activeDriver !== null && !(phase === "race" && !nextDriver) && (
                <button
                  type="button"
                  className={`command boxcmd relay-box-inline relay-focus-action${effectiveSignal === "BOX" ? " command-active" : ""}`}
                  disabled={!canEdit}
                  aria-label="Envoyer la consigne BOX"
                  aria-pressed={effectiveSignal === "BOX"}
                  onClick={() => send("BOX")}
                >
                  BOX
                  {boxConfirmed
                    ? <Check className="box-check-icon" size={20} />
                    : <CarFront size={20} />}
                </button>
              )}
              {state.signal === "BOX" && boxConfirmed && (
                <span className="relay-box-ack" role="status">
                  <Check size={15} /> Bien reçu par le pilote
                </span>
              )}
              {!phaseActive && (
                <button
                  type="button"
                  className="primary relay-focus-action relay-mode-start"
                  disabled={!canEdit || (phase === "qualifying"
                    ? Boolean(state.activeDriver) || raceInProgress
                    : !state.qualificationFinishAt && !raceInProgress && state.phase !== "race")}
                  onClick={() => phase === "qualifying"
                    ? state.finishAt ? prepareNewQualification() : startQualification()
                    : startRace()}
                >
                  <Play size={15} /> {phase === "qualifying" ? "Départ Qualification" : "Départ Course"}
                </button>
              )}
            </article>
            <article className="stat stat-next">
              <span><Users size={17} /> {initialRaceRelayPending ? "PILOTE À METTRE EN PISTE" : "PILOTE SUIVANT"}</span>
              <strong>{driverToStartOnTrack ? driverName(state, driverToStartOnTrack) : phase === "qualifying" ? "Fin des qualifications" : "Fin de course"}</strong>
              {phaseActive && (
                driverToStartOnTrack ? (
                  <button
                    type="button"
                    className="primary relay-next-start relay-focus-action"
                    disabled={!canEdit}
                    onClick={startNextDriver}
                  >
                    <Play size={15} /> En piste
                  </button>
                ) : confirmFinishQualification || confirmFinishRace ? (
                  <div className="relay-mode-confirm" role="alertdialog" aria-label="Confirmer la fin du mode">
                    <p>Confirmer la fin {phase === "qualifying" ? "des qualifications" : "de la course"} ?</p>
                    <div>
                      <button className="outline" onClick={() => {
                        setConfirmFinishQualification(false);
                        setConfirmFinishRace(false);
                      }}>
                        Annuler
                      </button>
                      <button className="primary" onClick={phase === "qualifying" ? finishQualification : finishRace}>
                        <Flag size={15} /> Confirmer
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="relay-next-start relay-focus-action" disabled={!canEdit} onClick={() => phase === "qualifying" ? setConfirmFinishQualification(true) : setConfirmFinishRace(true)}>
                    <Flag size={15} /> {phase === "qualifying" ? "Fin Qualification" : "Fin Course"}
                  </button>
                )
              )}
            </article>
          </section>
          <section className={`stats${phase === "qualifying" ? " stats-qualifying" : ""}`}>
              <article className="panel pilot-command-panel">
                <div className="panel-title">
                  <div className="pilot-command-title">
                    <h2>
                      <Radio size={19} /> Consignes au pilote
                    </h2>
                  </div>
                </div>
                <div className="input-row optional-message">
                  <input
                    disabled={!canEdit}
                    aria-label="Message facultatif"
                    value={message}
                    maxLength={80}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <button
                    disabled={!canEdit || !message.trim()}
                    className="primary send-message"
                    aria-label="Envoyer le message"
                    title="Envoyer le message"
                    onClick={sendCustomMessage}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </article>
            <article className="stat stat-changes">
              <span>
                <Flag size={17} /> RELAIS
              </span>
              <strong>
                {raceRelayCount}{" "}
                <em>/ {state.strategy.minRelays} min.</em>
              </strong>
              <small>Compteur indicatif</small>
            </article>
            {phase === "race" && (
              <article className="stat stat-fuel">
                <span>
                  <Fuel size={17} /> RAVITAILLEMENTS
                </span>
                <strong>
                  {Number(state.fuel1) + Number(state.fuel2)} <em>/ 2</em>
                </strong>
                <small>Deux postes de plein</small>
              </article>
            )}
          </section>
          <section className="columns">
            <div className="stack">
              <article className="panel">
                <div className="panel-title">
                  <h2>
                    <Play size={19} /> Gestion des relais
                  </h2>
                </div>
                {phase === "race" && state.strategy.relays.length ? (
                  <div className="relay-live-timeline" aria-label="Relais prévus selon la stratégie">
                    <article
                      className="relay-live-step relay-live-current"
                      style={{ "--driver-color": team.find((driver) => driver.id === currentDriver)?.color ?? "#f5c84b" } as React.CSSProperties}
                    >
                      <span className="relay-live-marker" />
                      <div>
                        <small>PILOTE ACTUEL · RELAIS {currentRelayNumber}</small>
                        <strong>{driverName(state, currentDriver) || "—"}</strong>
                        {state.pitSince !== null && <span>Kart aux stands</span>}
                      </div>
                    </article>
                    {nextPlannedPit?.kind === "pit" && (
                      <article className="relay-live-fuel">
                        <Fuel size={17} />
                        <div>
                          <strong>{nextPlannedPit.window.label}</strong>
                          <small>Fenêtre {clock(nextPlannedPit.window.opensAt)} – {clock(nextPlannedPit.window.closesAt)}</small>
                          <small>Passage prévu {clock(nextPlannedPit.window.plannedAt ?? nextPlannedPit.startAt)} · arrêt {nextPlannedPit.window.stopMinutes} min</small>
                        </div>
                      </article>
                    )}
                    <button
                      className="outline relay-change-button"
                      disabled={!canEdit || (!currentDriver && !nextDriver) || state.pitSince !== null}
                      onClick={completeStrategicChange}
                    >
                      <RotateCcw size={16} />
                      {state.activeDriver ? "Changement effectué" : state.pitSince !== null ? "Aux stands" : "Démarrer le relais prévu"}
                    </button>
                    <article
                      className="relay-live-step relay-live-next"
                      style={{ "--driver-color": team.find((driver) => driver.id === nextDriver)?.color ?? "#47c7b4" } as React.CSSProperties}
                    >
                      <span className="relay-live-marker" />
                      <div>
                        <small>PILOTE SUIVANT · RELAIS {nextRelayNumber}</small>
                        <strong>{driverName(state, nextDriver) || "—"}</strong>
                      </div>
                    </article>
                    {state.activeDriver && (
                      <button className="outline relay-pit-button" disabled={!canEdit} onClick={pit}>
                        <Pause size={16} /> Entrée au stand
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {phase === "race" && <p className="muted tiny">Aucun relais généré dans la stratégie. Choisissez un pilote manuellement ou générez le planning dans l’onglet Stratégie.</p>}
                    <div className="driver-buttons">
                      {team.map((d) => (
                        <button
                          key={d.id}
                          disabled={!canEdit || Boolean(state.activeDriver)}
                          onClick={() => start(d.id)}
                          className="driver-btn"
                        >
                          <strong>{d.name}</strong>
                          <small>Début relais</small>
                        </button>
                      ))}
                    </div>
                    <div className="action-row">
                      <button
                        disabled={!canEdit || !state.activeDriver}
                        className="outline"
                        onClick={pit}
                      >
                        <Pause size={17} /> Entrée au stand / fin du relais
                      </button>
                    </div>
                  </>
                )}
              </article>
            </div>
            <div className="stack">
              <details className="panel mobile-details" open={!compactMobile}>
                <summary className="panel-title">
                  <h2>
                    <Users size={19} /> Temps de roulage
                  </h2>
                  <span className="pill">ÉGALITÉ</span>
                </summary>
                <p className="muted tiny">
                  Qualifications + course · objectif : même temps pour chacun
                </p>
                {team.map((d) => {
                  const ms = driven(d.id);
                  const max = Math.max(1, ...drivenAll);
                  return (
                    <div className="driver-total" key={d.id}>
                      <div className="total-line">
                        <strong>{d.name}</strong>
                        <span>{format(ms)}</span>
                      </div>
                      <div className="track">
                        <div
                          className="fill"
                          style={{ width: `${(ms / max) * 100}%` }}
                        />
                      </div>
                      <small>
                        Qualif {format(total[d.id]?.qualifying ?? 0)} · Course{" "}
                        {format(total[d.id]?.race ?? 0)}
                      </small>
                    </div>
                  );
                })}
                <div className="balance">
                  Écart max :{" "}
                  {format(Math.max(...drivenAll) - Math.min(...drivenAll))}
                </div>
              </details>
              {phase === "race" && <article className="panel">
                <div className="panel-title">
                  <h2>
                    <Fuel size={19} /> Ravitaillements
                  </h2>
                </div>
                <div className="fuel-row">
                  <div>
                    <strong>Ravitaillement 1</strong>
                    <small>11h50 – 12h20</small>
                  </div>
                  <button
                    disabled={!canEdit}
                    className={state.fuel1 ? "done" : "outline"}
                    onClick={() => save({ ...state, fuel1: !state.fuel1 }, "fuel_1_toggled")}
                  >
                    {state.fuel1 ? "✓ Effectué" : "Marquer effectué"}
                  </button>
                </div>
                <div className="fuel-row">
                  <div>
                    <strong>Ravitaillement 2</strong>
                    <small>13h05 – 13h35</small>
                  </div>
                  <button
                    disabled={!canEdit}
                    className={state.fuel2 ? "done" : "outline"}
                    onClick={() => save({ ...state, fuel2: !state.fuel2 }, "fuel_2_toggled")}
                  >
                    {state.fuel2 ? "✓ Effectué" : "Marquer effectué"}
                  </button>
                </div>
                <p className="muted tiny">
                  Fenêtres horaires officielles. Les indicateurs ne prouvent pas
                  qu'un plein a été réalisé.{" "}
                  {fuel1Window
                    ? "Fenêtre 1 en cours."
                    : fuel2Window
                      ? "Fenêtre 2 en cours."
                      : ""}
                </p>
              </article>}
              <details className="panel mobile-details" open={!compactMobile}>
                <summary className="panel-title">
                  <h2>
                    <Clock3 size={19} /> Historique des relais
                  </h2>
                </summary>
                <div className="history">
                  {state.segments.length ? (
                    state.segments
                      .slice()
                      .reverse()
                      .map((s) => (
                        <div key={s.id}>
                          <strong>{driverName(state, s.driver)}</strong>
                          <span>
                            {s.phase === "race" ? "Course" : "Qualifs"}
                          </span>
                          <span>
                            {clock(s.start)} → {clock(s.end)}
                          </span>
                          <b>{format(s.end - s.start)}</b>
                        </div>
                      ))
                  ) : (
                    <p className="muted">Aucun relais terminé.</p>
                  )}
                </div>
              </details>
            </div>
          </section>
          </>
          )}
          <section className="panel bottom-panel">
            <h2>Administration</h2>
            {configured && !admin ? (
              <form id="login" className="login" onSubmit={login}>
                <input
                  type="email"
                  placeholder="Email administrateur"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Mot de passe"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button className="primary" type="submit">
                  <LogIn size={16} /> Connexion
                </button>
              </form>
            ) : (
              <div className="action-row">
                <button
                  className="outline"
                  onClick={() => setConfirmReset(!confirmReset)}
                >
                  <RotateCcw size={16} /> Réinitialiser la course
                </button>
                {configured && (
                  <button className="outline" onClick={() => signOut(auth!)}>
                    <LogOut size={16} /> Déconnexion
                  </button>
                )}
                {confirmReset && (
                  <button
                    className="danger"
                    onClick={() => {
                      void save({
                        ...initial,
                        config: state.config,
                        updatedAt: Date.now(),
                      }, "race_reset");
                      setConfirmReset(false);
                    }}
                  >
                    Confirmer la réinitialisation
                  </button>
                )}
              </div>
            )}
            <p className="muted tiny">
              {configured
                ? "Mode Firebase : données synchronisées entre appareils authentifiés."
                : "Mode démonstration : les données restent dans ce navigateur et se synchronisent seulement entre onglets de la même origine."}
            </p>
          </section>
        </main>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
