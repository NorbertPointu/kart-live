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
  getDocFromServer,
  onSnapshot,
  writeBatch,
} from "firebase/firestore";

import { ConfigPanel } from "./ConfigPanel";
import { StrategyPanel } from "./StrategyPanel";
import {
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
  const [messageDuration, setMessageDuration] = useState(10);
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
    effectiveSignal !== "READY" ||
    state.finishAt !== null ||
    (state.startAt === null && state.qualificationFinishAt !== null);
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
  const phaseRelayCount = phase === "race"
    ? raceRelayCount
    : state.segments.filter((segment) => segment.phase === "qualifying").length +
      Number(state.activeDriver !== null);
  const phaseRelayTarget = phase === "qualifying"
    ? state.strategy.qualifyingOrder.length
    : state.strategy.relays.length || state.strategy.minRelays;
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
      messageColor: "default",
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 10000,
      phase,
    }, eventType);
  }
  function startNextDriver() {
    if (!phaseActive || !driverToStartOnTrack) return;
    const eventType = phase === "qualifying"
      ? "qualification_driver_started"
      : state.activeDriver ? "driver_change_completed" : "relay_started";
    start(driverToStartOnTrack, eventType);
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
  function sendDirectMessage(text: string, messageColor: EventState["messageColor"] = "default") {
    if (!text) return;
    const t = Date.now();
    void save({
      ...state,
      signal: "MESSAGE",
      message: text,
      messageColor,
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + messageDuration * 1000,
    }, "custom_message_sent");
  }
  function sendCustomMessage() {
    const text = message.trim().slice(0, 80);
    if (!text) return;
    sendDirectMessage(text);
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
  async function startRace() {
    if (!canEdit) return;
    let latest = state;
    try {
      if (configured) {
        const snapshot = await getDocFromServer(doc(db!, "events", eventId));
        if (snapshot.exists()) latest = normalize(snapshot.data() as EventState);
      } else {
        const saved = localStorage.getItem(KEY);
        if (saved) latest = normalize(JSON.parse(saved));
      }
    } catch (error) {
      setError(`Impossible de charger la dernière stratégie enregistrée : ${String(error)}`);
      return;
    }
    const t = Date.now();
    const isNewRace = latest.finishAt !== null;
    const next = isNewRace
      ? {
          ...latest,
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
            ...latest.strategy,
            qualifyingDone: [],
          },
        }
      : latest;
    const startingDriver = firstStrategyRelayDriver(next.strategy) ?? next.config.drivers[0]?.id ?? null;
    void save({
      ...next,
      activeDriver: startingDriver,
      activeSince: startingDriver !== null ? t : null,
      phase: "race",
      startAt: t,
      finishAt: null,
      signal: "MESSAGE",
      message: "Go Go Go",
      messageColor: "default",
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 10_000,
    }, "race_started");
  }
  function startQualification() {
    const t = Date.now();
    const startingDriver = state.strategy.qualifyingOrder[0] ?? state.config.drivers[0]?.id ?? null;
    void save({
      ...state,
      activeDriver: startingDriver,
      activeSince: startingDriver !== null ? t : null,
      pitSince: null,
      phase: "qualifying",
      qualificationStartAt: t,
      qualificationFinishAt: null,
      signal: "MESSAGE",
      message: "Vas-y fume les",
      messageColor: "default",
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
            className={`signal signal-${effectiveSignal.replace(" ", "-")}${effectiveSignal === "MESSAGE" && state.messageColor ? ` signal-message-${state.messageColor}` : ""}${pilotModeFinished ? " signal-finished" : ""}${state.startAt === null && effectiveSignal === "READY" ? " signal-start" : ""}${effectiveSignal === "BOX" ? " signal-box-clickable" : ""}${boxAwaitingAck && effectiveSignal === "BOX" ? " signal-flashing" : ""}${boxConfirmed && effectiveSignal === "BOX" ? " signal-confirmed" : ""}`}
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
                10h35 — 14h35 · 4 heures · {state.strategy.minRelays} relais minimum
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
              <div className="phase-relays">
                <small><Flag size={13} /> RELAIS</small>
                <strong>{phaseRelayCount} <em>/ {phaseRelayTarget}</em></strong>
              </div>
            </div>
          </section>
          <section className="direct-messages" aria-label="Messages">
            <div className="input-row message-duration">
              <label htmlFor="message-duration">Durée d'affichage (secondes)</label>
              <input
                id="message-duration"
                type="number"
                min={1}
                max={300}
                step={1}
                value={messageDuration}
                disabled={!canEdit}
                onChange={(event) => {
                  const duration = event.target.valueAsNumber;
                  setMessageDuration(Number.isFinite(duration) ? Math.max(1, Math.min(300, Math.round(duration))) : 10);
                }}
              />
            </div>
            <div className="direct-message-actions">
              <button className="direct-message-red" disabled={!canEdit} onClick={() => sendDirectMessage("BOX", "red")}>
                <CarFront size={20} /> BOX
              </button>
              <button className="direct-message-red" disabled={!canEdit} onClick={() => sendDirectMessage("BOX NOW", "red")}>
                <CarFront size={20} /> BOX NOW
              </button>
              <button className="direct-message-green" disabled={!canEdit} onClick={() => sendDirectMessage("Reste en piste", "green")}>
                <Flag size={20} /> Reste en piste
              </button>
            </div>
            <div className="direct-message-custom">
              <h2><Radio size={19} /> Message facultatif</h2>
              <div className="input-row optional-message">
                <input
                  disabled={!canEdit}
                  aria-label="Message facultatif"
                  value={message}
                  maxLength={80}
                  onChange={(event) => setMessage(event.target.value)}
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
            </div>
          </section>
          <section className={`relay-focus-row${phaseActive ? "" : " relay-focus-ready"}${effectiveSignal === "BOX" ? " relay-focus-box-sent" : ""}${!nextDriver ? " relay-focus-finish" : ""}`} aria-label="Pilotes et consigne BOX">
            <article className="stat stat-current">
              <span><Users size={17} /> {initialRaceRelayPending ? "PILOTE PRÉVU" : "PILOTE ACTUEL"}</span>
              <strong>{driverName(state, currentDriver) || "—"}</strong>
              {phaseActive && state.activeDriver !== null && nextDriver !== null && (
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
          {phase === "race" && (
          <section className="stats">
              <article className="stat stat-fuel">
                <span>
                  <Fuel size={17} /> RAVITAILLEMENTS
                </span>
                <strong>
                  {Number(state.fuel1) + Number(state.fuel2)} <em>/ 2</em>
                </strong>
                <small>Deux postes de plein</small>
              </article>
          </section>
          )}
          <section className="columns">
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
