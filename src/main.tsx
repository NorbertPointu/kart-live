import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { auth, configured, db, eventId } from "./firebase";
import {
  clock,
  closeSegment,
  driverName,
  EventState,
  format,
  formatLap,
  initial,
  normalize,
  Signal,
  totals,
  Driver,
  Phase,
} from "./model";
import { ConfigPanel } from "./ConfigPanel";
import {
  Flag,
  Radio,
  Clock3,
  Users,
  ShieldCheck,
  Wifi,
  WifiOff,
  Fuel,
  RotateCcw,
  LogIn,
  LogOut,
  Pause,
  Play,
  Send,
  Settings,
} from "lucide-react";
import "./style.css";
const KEY = "kart-live-demo-v1";
const channel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(KEY) : null;
function App() {
  const [role, setRole] = useState<"stand" | "driver">(
    location.pathname.startsWith("/driver") ? "driver" : "stand",
  );
  const [state, setState] = useState<EventState>(initial);
  const [now, setNow] = useState(Date.now());
  const [user, setUser] = useState<User | null>(null);
  const [online, setOnline] = useState(!configured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [qual, setQual] = useState<Phase>("race");
  const [admin, setAdmin] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [tab, setTab] = useState<"race" | "config">("race");
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
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
      setAdmin(Boolean(u && !u.isAnonymous));
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
  async function save(next: EventState) {
    if (configured && !admin) {
      setError("Connexion administrateur requise pour modifier la course.");
      return;
    }
    const updated = { ...next, updatedAt: Date.now() };
    if (configured) {
      try {
        await setDoc(doc(db!, "events", eventId), updated);
      } catch (e) {
        setError(`Enregistrement impossible : ${String(e)}`);
      }
    } else {
      setState(updated);
      localStorage.setItem(KEY, JSON.stringify(updated));
      channel?.postMessage(updated);
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
    BOX: "BOX BOX",
    PUSH: "ATTAQUE",
    "STAY OUT": "FAIS TOI PLAIZ",
    SLOW: "PRUDENCE",
    CLEAR: "PISTE LIBRE",
    MESSAGE: "MESSAGE DU STAND",
  };
  const canEdit = !configured || admin;
  function start(driver: Driver) {
    const t = Date.now();
    const closed = closeSegment(state, t);
    void save({
      ...closed,
      activeDriver: driver,
      activeSince: t,
      pitSince: null,
      signal: "READY",
      signalExpiresAt: 0,
      phase: qual,
    });
  }
  function pit() {
    const t = Date.now();
    const closed = closeSegment(state, t);
    void save({ ...closed, pitSince: t, signal: "READY", signalExpiresAt: 0 });
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
    });
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
    });
    setMessage("");
  }
  async function acknowledgeBox() {
    if (state.signal !== "BOX" || !boxAwaitingAck) return;
    const confirmedAt = state.signalAt;
    const updatedAt = Date.now();
    const updated = { ...state, signalConfirmedAt: confirmedAt, updatedAt };
    setState(updated);
    if (configured) {
      try {
        await updateDoc(doc(db!, "events", eventId), {
          signalConfirmedAt: confirmedAt,
          updatedAt,
        });
      } catch (e) {
        setError(`Confirmation impossible : ${String(e)}`);
      }
    } else {
      localStorage.setItem(KEY, JSON.stringify(updated));
      channel?.postMessage(updated);
    }
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
            className={`signal signal-${effectiveSignal.replace(" ", "-")}${effectiveSignal === "BOX" ? " signal-box-clickable" : ""}${boxAwaitingAck && effectiveSignal === "BOX" ? " signal-flashing" : ""}${boxConfirmed && effectiveSignal === "BOX" ? " signal-confirmed" : ""}`}
            disabled={effectiveSignal !== "BOX" || !boxAwaitingAck}
            onClick={() => {
              if (state.signal !== "BOX" || !boxAwaitingAck) return;
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
              {effectiveSignal === "MESSAGE"
                ? state.message
                : effectiveSignal === "READY"
                  ? "EN ATTENTE"
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
              onApply={(config) => save({ ...state, config })}
            />
          ) : (
          <>
          <section className="stats">
            <article className="stat">
              <span>
                <Clock3 size={17} /> TEMPS DE COURSE
              </span>
              <strong>{format(elapsed)}</strong>
              <small>
                {state.startAt ? "Chronomètre lancé" : "Prêt pour le départ"}
              </small>
            </article>
            <article className="stat">
              <span>
                <Users size={17} /> PILOTE ACTUEL
              </span>
              <strong>{driverName(state, state.activeDriver) || "—"}</strong>
              <small>
                {state.activeDriver
                  ? `Roulage : ${format(activeMs)}`
                  : state.pitSince
                    ? "Kart aux stands"
                    : "Aucun pilote actif"}
              </small>
            </article>
            <article className="stat">
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
            <article className="stat">
              <span>
                <Fuel size={17} /> RAVITAILLEMENTS
              </span>
              <strong>
                {Number(state.fuel1) + Number(state.fuel2)} <em>/ 2</em>
              </strong>
              <small>Deux postes de plein</small>
            </article>
          </section>
          <section className="columns">
            <div className="stack">
              <article className="panel">
                <div className="panel-title">
                  <h2>
                    <Radio size={19} /> Consignes au pilote
                  </h2>
                  <span className="pill active-signal">
                    {effectiveSignal === "READY"
                      ? "AUCUNE CONSIGNE"
                      : `MESSAGE ACTIF : ${effectiveSignal === "MESSAGE" ? state.message : signalDescription[effectiveSignal]}`}
                  </span>
                  {boxConfirmed && effectiveSignal === "BOX" && (
                    <span className="pill confirmation-tag">
                      CONFIRMÉ PAR LE PILOTE
                    </span>
                  )}
                </div>
                <div className="commands">
                  <button
                    disabled={!canEdit}
                    className={`command boxcmd${effectiveSignal === "BOX" ? " command-active" : ""}`}
                    onClick={() => send("BOX")}
                  >
                    BOX BOX
                  </button>
                  <button
                    disabled={!canEdit}
                    className={`command pushcmd${effectiveSignal === "PUSH" ? " command-active" : ""}`}
                    onClick={() => send("PUSH")}
                  >
                    ATTAQUE
                  </button>
                  <button
                    disabled={!canEdit}
                    className={`command staycmd${effectiveSignal === "STAY OUT" ? " command-active" : ""}`}
                    onClick={() => send("STAY OUT")}
                  >
                    FAIS TOI PLAIZ
                  </button>
                  <button
                    disabled={!canEdit}
                    className={`command slowcmd${effectiveSignal === "SLOW" ? " command-active" : ""}`}
                    onClick={() => send("SLOW")}
                  >
                    PRUDENCE
                  </button>
                </div>
                <div className="input-row">
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
                <p className="muted tiny">
                  Une consigne écrite reste visible 20 secondes. Les consignes
                  ne remplacent jamais les drapeaux et instructions des commissaires.
                </p>
              </article>
              <article className="panel">
                <div className="panel-title">
                  <h2>
                    <Play size={19} /> Gestion des relais
                  </h2>
                </div>
                <div className="input-row">
                  <label>Type de session</label>
                  <select
                    disabled={!canEdit}
                    value={qual}
                    onChange={(e) => setQual(e.target.value as Phase)}
                  >
                    <option value="qualifying">Qualifications</option>
                    <option value="race">Course</option>
                  </select>
                </div>
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
                  <button
                    disabled={!canEdit || Boolean(state.startAt)}
                    className="outline"
                    onClick={() =>
                      save({ ...state, startAt: Date.now(), finishAt: null })
                    }
                  >
                    <Clock3 size={17} /> Départ course
                  </button>
                  <button
                    disabled={
                      !canEdit || !state.startAt || Boolean(state.finishAt)
                    }
                    className="outline"
                    onClick={() =>
                      save({
                        ...closeSegment(state, Date.now()),
                        finishAt: Date.now(),
                        pitSince: Date.now(),
                      })
                    }
                  >
                    <Flag size={17} /> Arrivée
                  </button>
                </div>
                <p className="muted tiny">
                  À l'entrée au stand, arrête le relais. Démarre le suivant à la
                  sortie du stand : l'immobilisation n'est pas comptée comme
                  roulage.
                </p>
              </article>
            </div>
            <div className="stack">
              <article className="panel">
                <div className="panel-title">
                  <h2>
                    <Users size={19} /> Temps de roulage
                  </h2>
                  <span className="pill">ÉGALITÉ</span>
                </div>
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
              </article>
              <article className="panel">
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
                    onClick={() => save({ ...state, fuel1: !state.fuel1 })}
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
                    onClick={() => save({ ...state, fuel2: !state.fuel2 })}
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
              </article>
              <article className="panel">
                <div className="panel-title">
                  <h2>
                    <Clock3 size={19} /> Historique des relais
                  </h2>
                </div>
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
              </article>
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
                      });
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
