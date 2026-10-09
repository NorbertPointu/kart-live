import "./style.css";

import {
  Clock3,
  CalendarClock,
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
  nextPlannedDriverAt,
  plannedDriverAt,
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
  const [showOptionalMessage, setShowOptionalMessage] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
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
  const activeMs =
    state.activeSince !== null && state.activeDriver
      ? now - state.activeSince
      : 0;
  const elapsed =
    state.startAt !== null
      ? Math.min(now, state.finishAt ?? Infinity) - state.startAt
      : 0;
  const qualificationElapsed =
    state.qualificationStartAt !== null
      ? Math.max(
          0,
          Math.min(now, state.qualificationFinishAt ?? Infinity) -
            state.qualificationStartAt,
        )
      : 0;
  const relayNumber =
    state.segments.length + (state.activeDriver ? 1 : 0);
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
  const signalDescription: Record<Signal, string> = {
    READY: "EN ATTENTE DES CONSIGNES",
    BOX: "BOX",
    PUSH: "GO",
    "STAY OUT": "DANS LES STANDS",
    SLOW: "DANS LES STANDS",
    CLEAR: "PISTE LIBRE",
    MESSAGE: "MESSAGE DU STAND",
  };
  const canEdit = !configured || admin;
  const phase = currentPhase(state);
  const phaseElapsed = phase === "qualifying" ? qualificationElapsed : elapsed;
  const phaseDuration =
    (phase === "qualifying"
      ? state.strategy.qualifyingMinutes
      : state.strategy.durationMinutes) * 60_000;
  const remainingTime = Math.max(0, phaseDuration - phaseElapsed);
  const raceInProgress = state.startAt !== null && state.finishAt === null;
  const completedRaceRelays = state.segments.filter((segment) => segment.phase === "race").length;
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
      : plannedDriver ?? state.activeDriver;
    const nextDriver = phase === "race" && state.strategy.relays.length &&
      (state.activeDriver !== null || state.pitSince !== null)
      ? state.strategy.relays[completedRaceRelays + (state.activeDriver ? 1 : 0)]?.driver ?? null
      : nextPlannedDriverAt(
          state.strategy,
          phase,
          now,
          state.qualificationStartAt,
          state.startAt,
        );
  const raceTimeline = buildStrategyTimeline(
    state.strategy,
    state.startAt ?? state.strategy.scheduledStartAt,
  );
  const firstRelayIndex = raceTimeline.findIndex((item) => item.kind === "relay");
  const activeTimelineIndex = state.startAt === null
    ? -1
    : raceTimeline.findIndex((item) => now >= item.startAt && now < item.endAt);
  const previousRelayIndices = raceTimeline
    .map((item, index) => item.kind === "relay" && index < activeTimelineIndex ? index : -1)
    .filter((index) => index >= 0);
  const actualRelayPosition = phase === "race" && state.activeDriver !== null
    ? completedRaceRelays
    : phase === "race" && state.pitSince !== null
      ? Math.max(0, completedRaceRelays - 1)
      : null;
  const actualRelayId = actualRelayPosition === null
    ? null
    : state.strategy.relays[actualRelayPosition]?.id;
  const currentRelayIndex = actualRelayId
    ? raceTimeline.findIndex((item) => item.kind === "relay" && item.relay.id === actualRelayId)
    : activeTimelineIndex >= 0
      ? raceTimeline[activeTimelineIndex].kind === "relay"
        ? activeTimelineIndex
        : previousRelayIndices[previousRelayIndices.length - 1] ?? firstRelayIndex
      : firstRelayIndex;
  const currentRelayNumber = Math.max(
    1,
    completedRaceRelays + (state.activeDriver ? 1 : 0),
  );
  const nextRelayNumber = currentRelayNumber + 1;
  const nextRelayIndex = raceTimeline.findIndex(
    (item, index) => index > currentRelayIndex && item.kind === "relay",
  );
  const plannedPitBeforeNext = raceTimeline.find(
    (item, index) =>
      item.kind === "pit" &&
      index > currentRelayIndex &&
      (nextRelayIndex < 0 || index < nextRelayIndex) &&
      (state.startAt === null || item.endAt > now),
  );
  const plannedPitAfterNext = nextRelayIndex < 0
    ? undefined
    : raceTimeline.find(
        (item, index) =>
          item.kind === "pit" &&
          index >= nextRelayIndex &&
          (state.startAt === null || item.endAt > now),
      );
  function start(driver: Driver, eventType = "relay_started") {
    const t = Date.now();
    const closed = closeSegment(state, t);
    void save({
      ...closed,
      activeDriver: driver,
      activeSince: t,
      pitSince: null,
      signal: "PUSH",
      message: "",
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 120000,
      phase,
    }, eventType);
  }
  function completeStrategicChange() {
    const isChange = Boolean(state.activeDriver || state.pitSince !== null);
    const driverToStart = isChange ? nextDriver : currentDriver ?? nextDriver;
    if (driverToStart)
      start(driverToStart, isChange ? "driver_change_completed" : "relay_started");
  }
  function pit() {
    const t = Date.now();
    const closed = closeSegment(state, t);
    void save(
      { ...closed, pitSince: t, signal: "READY", signalExpiresAt: 0 },
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
    void save({
      ...next,
      phase: "race",
      startAt: t,
      finishAt: null,
      signal: "PUSH",
      message: "",
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 120000,
    }, "race_started");
  }
  function startQualification() {
    const t = Date.now();
    void save({
      ...state,
      phase: "qualifying",
      qualificationStartAt: t,
      qualificationFinishAt: null,
      signal: "PUSH",
      message: "",
      signalAt: t,
      signalConfirmedAt: 0,
      signalExpiresAt: t + 120000,
    }, "qualification_started");
  }
  function finishQualification() {
    const t = Date.now();
    const closed = closeSegment(state, t);
    void save({
      ...closed,
      phase: "race",
      qualificationFinishAt: t,
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
        <main className="driver-view">
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
            className={`signal signal-${effectiveSignal.replace(" ", "-")}${state.finishAt !== null ? " signal-finished" : ""}${state.startAt === null && effectiveSignal === "READY" ? " signal-start" : ""}${effectiveSignal === "BOX" ? " signal-box-clickable" : ""}${boxAwaitingAck && effectiveSignal === "BOX" ? " signal-flashing" : ""}${boxConfirmed && effectiveSignal === "BOX" ? " signal-confirmed" : ""}`}
            disabled={state.finishAt !== null || effectiveSignal !== "BOX" || !boxAwaitingAck}
            onClick={() => {
              if (state.finishAt !== null || state.signal !== "BOX" || !boxAwaitingAck) return;
              void acknowledgeBox();
            }}
            aria-label={
              effectiveSignal === "BOX"
                ? !boxAwaitingAck
                  ? "Consigne BOX confirmée"
                  : "Confirmer la réception de la consigne BOX"
                : undefined
            }
          >
            <span className="signal-title">
              {state.finishAt !== null
                ? "BRAVO"
                : effectiveSignal === "MESSAGE"
                  ? state.message
                  : effectiveSignal === "READY"
                    ? state.startAt === null
                      ? phase === "race" ? "PRÊT POUR LE DÉPART" : "DÉPART"
                      : "DANS LES STANDS"
                    : signalDescription[effectiveSignal]}
            </span>
            {effectiveSignal === "BOX" && (
              <span className="signal-ack">
                {boxAwaitingAck
                  ? "TOUCHER POUR CONFIRMER LA RÉCEPTION"
                  : "CONFIRMÉ PAR LE PILOTE"}
              </span>
            )}
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
            <div className="driver-bottom">
              <div className="driver-relay">
                <small>RELAIS N°</small>
                <strong>{relayNumber || "—"}</strong>
              </div>
              <div className="driver-timer">
                <small>RELAIS EN COURS</small>
                <strong>{format(activeMs)}</strong>
              </div>
              <div className="driver-timer">
                <small>COURSE</small>
                <strong>{format(elapsed)}</strong>
              </div>
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
                10h35 — 14h35 · 4 heures · 7 changements minimum
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
                <small>TEMPS ÉCOULÉ</small>
                <strong>{format(phaseElapsed)}</strong>
              </div>
              {phase === "qualifying" ? (
                <button
                  className={state.qualificationStartAt && !state.qualificationFinishAt ? "outline" : "primary"}
                  disabled={!canEdit || (!state.qualificationStartAt && !state.finishAt && (Boolean(state.activeDriver) || Boolean(state.startAt && !state.finishAt))) || Boolean(state.qualificationFinishAt && !state.finishAt)}
                  onClick={state.finishAt
                    ? prepareNewQualification
                    : state.qualificationStartAt && !state.qualificationFinishAt
                      ? finishQualification
                      : startQualification}
                >
                  {state.qualificationStartAt && !state.qualificationFinishAt ? <Flag size={16} /> : <Play size={16} />}
                  {state.qualificationStartAt && !state.qualificationFinishAt ? "Fin Qualification" : "Départ Qualification"}
                </button>
              ) : (
                <button
                  className={state.startAt && !state.finishAt ? "outline" : "primary"}
                  disabled={!canEdit || (!state.qualificationFinishAt && !raceInProgress && state.phase !== "race")}
                  onClick={state.startAt ? () => setConfirmFinishRace(true) : startRace}
                >
                  {state.startAt ? <Flag size={16} /> : <Play size={16} />}
                  {state.startAt ? "Fin Course" : "Départ Course"}
                </button>
              )}
            </div>
            {confirmFinishRace && (
              <div className="phase-confirm" role="alertdialog" aria-label="Confirmer la fin de course">
                <p>Confirmer la fin de course et enregistrer l’heure d’arrivée ?</p>
                <button className="outline" onClick={() => setConfirmFinishRace(false)}>
                  Annuler
                </button>
                <button className="primary" onClick={finishRace}>
                  <Flag size={16} /> Confirmer la fin de course
                </button>
              </div>
            )}
          </section>
          <section className={`stats${phase === "qualifying" ? " stats-qualifying" : ""}`}>
            <article className="stat stat-next">
              <span>
                <Users size={17} /> PROCHAIN PILOTE
              </span>
              <strong>{driverName(state, nextDriver) || "—"}</strong>
              <small>{nextDriver ? "Selon la stratégie" : "Aucun passage suivant"}</small>
            </article>
              <article className="stat stat-remaining">
                <span>
                  <Clock3 size={17} /> TEMPS RESTANT
                </span>
                <strong>{format(remainingTime)}</strong>
                <small>{phaseElapsed > 0 ? "Avant la fin prévue" : "Durée totale prévue"}</small>
              </article>
              <article className="panel pilot-command-panel">
                <div className="panel-title">
                  <div className="pilot-command-title">
                    <h2>
                      <Radio size={19} /> Consignes au pilote
                    </h2>
                    <strong>{driverName(state, currentDriver) || "—"}</strong>
                  </div>
                </div>
                <div className="commands">
                  <button
                    disabled={!canEdit}
                    className={`command boxcmd${effectiveSignal === "BOX" ? " command-active" : ""}`}
                    onClick={() => send("BOX")}
                  >
                    BOX
                    {boxConfirmed && effectiveSignal === "BOX" && (
                      <span className="pill confirmation-tag command-confirmation">
                        CONFIRMÉ PAR LE PILOTE
                      </span>
                    )}
                  </button>
                  <button
                    disabled={!canEdit}
                    className={`command pushcmd${effectiveSignal === "PUSH" ? " command-active" : ""}`}
                    onClick={() => send("PUSH")}
                  >
                    GO
                  </button>
                  <button
                    type="button"
                    className="outline message-toggle"
                    aria-expanded={showOptionalMessage}
                    onClick={() => setShowOptionalMessage((visible) => !visible)}
                  >
                    <Send size={14} /> {showOptionalMessage ? "Masquer le message" : "Message facultatif"}
                  </button>
                </div>
                {showOptionalMessage && (
                  <div className="input-row optional-message">
                    <input
                      disabled={!canEdit}
                      placeholder="Message facultatif (80 caractères)"
                      value={message}
                      maxLength={80}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                    <button
                      disabled={!canEdit || !message.trim()}
                      className="primary send-message"
                      onClick={sendCustomMessage}
                    >
                      <Send size={16} /> ENVOYER
                    </button>
                  </div>
                )}
              </article>
            <article className="stat stat-changes">
              <span>
                <RotateCcw size={17} /> CHANGEMENTS
              </span>
              <strong>
                {Math.max(
                  0,
                  state.segments.filter((x) => x.phase === "race").length -
                    (state.activeDriver ? 0 : 1),
                )}{" "}
                <em>/ 7 min.</em>
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
                        <span>{state.activeDriver === currentDriver ? "En piste" : state.pitSince !== null ? "Kart aux stands" : "Selon la stratégie"}</span>
                      </div>
                    </article>
                    {plannedPitBeforeNext?.kind === "pit" && (
                      <article className="relay-live-fuel">
                        <Fuel size={17} />
                        <div>
                          <strong>{plannedPitBeforeNext.window.label}</strong>
                          <small>Ravitaillement obligatoire · {clock(plannedPitBeforeNext.window.plannedAt ?? plannedPitBeforeNext.startAt)}</small>
                        </div>
                      </article>
                    )}
                    <button
                      className="outline relay-change-button"
                      disabled={!canEdit || !(currentDriver || nextDriver)}
                      onClick={completeStrategicChange}
                    >
                      <RotateCcw size={16} />
                      {state.activeDriver || state.pitSince !== null ? "Changement effectué" : "Démarrer le relais prévu"}
                    </button>
                    <article
                      className="relay-live-step relay-live-next"
                      style={{ "--driver-color": team.find((driver) => driver.id === nextDriver)?.color ?? "#47c7b4" } as React.CSSProperties}
                    >
                      <span className="relay-live-marker" />
                      <div>
                        <small>PILOTE SUIVANT · RELAIS {nextRelayNumber}</small>
                        <strong>{driverName(state, nextDriver) || "—"}</strong>
                        <span>{nextDriver ? "Selon la stratégie" : "Aucun relais suivant"}</span>
                      </div>
                    </article>
                    {!plannedPitBeforeNext && plannedPitAfterNext?.kind === "pit" && (
                      <article className="relay-live-fuel relay-live-fuel-later">
                        <Fuel size={17} />
                        <div>
                          <strong>{plannedPitAfterNext.window.label}</strong>
                          <small>Ravitaillement obligatoire · {clock(plannedPitAfterNext.window.plannedAt ?? plannedPitAfterNext.startAt)}</small>
                        </div>
                      </article>
                    )}
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
