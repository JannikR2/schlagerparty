"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { PublicGame } from "@/lib/types";
import { browserDb } from "@/lib/supabase-browser";

type ViewGame = PublicGame & { viewerPlayerId: string | null; viewerIsHost: boolean };
type Device = { id: string; name: string; type: string; is_active: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Etwas ist schiefgegangen.");
  return body;
}

export default function Home() {
  const [game, setGame] = useState<ViewGame | null>(null);
  const [lobbyOrigin, setLobbyOrigin] = useState("");
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [mode, setMode] = useState<"home" | "create" | "join">("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedGap, setSelectedGap] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  const refresh = useCallback(async () => {
    const result = await api<{ game: ViewGame | null }>("/api/game");
    setGame(result.game);
  }, []);

  useEffect(() => {
    setLobbyOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    // The setters run after network promises resolve; this is initial synchronization with the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([refresh(), api<{ spotifyConnected: boolean; displayName: string | null }>("/api/session")])
      .then(([, session]) => { setSpotifyConnected(session.spotifyConnected); setDisplayName(session.displayName ?? ""); })
      .catch((reason) => setError(reason.message));
    const timer = window.setInterval(refresh, 5000);
    const supabase = browserDb();
    const channel = supabase?.channel("game-signals").on("postgres_changes", { event: "INSERT", schema: "public", table: "game_signals" }, refresh).subscribe();
    return () => { clearInterval(timer); if (channel) void supabase?.removeChannel(channel); };
  }, [refresh]);

  useEffect(() => {
    const deadline = game?.phase === "revealing" ? game.revealEndsAt : game?.phase === "countdown" ? game.turnStartsAt : game?.clipEndsAt;
    if (!deadline) {
      // Reset the derived countdown whenever the server clears its deadline.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemaining(0); return;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)));
    tick(); const timer = window.setInterval(tick, 250); return () => clearInterval(timer);
  }, [game?.phase, game?.revealEndsAt, game?.turnStartsAt, game?.clipEndsAt]);

  useEffect(() => {
    if (!game || remaining !== 0) return;
    if ((game.phase === "revealing" && game.revealEndsAt) || (game.phase === "countdown" && game.turnStartsAt)) void api("/api/game/advance", { method: "POST", body: JSON.stringify({ version: game.version }) }).then(refresh).catch(() => refresh());
    if (game.phase === "playing" && game.clipEndsAt) void api("/api/game/pause", { method: "POST", body: JSON.stringify({ version: game.version }) }).catch(() => undefined);
  }, [game, remaining, refresh]);

  useEffect(() => {
    // A new optimistic-lock version always represents a new placement decision.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedGap(null);
  }, [game?.version]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unbekannter Fehler"); }
    finally { setBusy(false); }
  };

  const loadDevices = () => run(async () => {
    const result = await api<{ devices: Device[] }>("/api/spotify/devices");
    setDevices(result.devices); setMode("create");
  });

  const createGame = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void run(async () => {
      const result = await api<{ skipped: number }>("/api/game/create", { method: "POST", body: JSON.stringify(Object.fromEntries(data)) });
      if (result.skipped) setNotice(`${result.skipped} ungeeignete Titel wurden übersprungen.`);
      setMode("home");
    });
  };

  const join = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void run(() => api("/api/game/join", { method: "POST", body: JSON.stringify(Object.fromEntries(data)) }));
  };

  const resetGame = () => {
    if (!window.confirm("Aktive Runde wirklich zurücksetzen? Der aktuelle Spielstand geht verloren.")) return;
    void run(async () => {
      await api("/api/game/reset", { method: "POST" });
      setGame(null);
      setMode("home");
    });
  };

  const activePlayer = game?.players.find((player) => player.id === game.currentPlayerId);
  const viewer = game?.players.find((player) => player.id === game.viewerPlayerId);
  const canPlace = game?.phase === "playing" && game.viewerPlayerId === game.currentPlayerId;
  const viewerBet = game?.hitsterBets.find((bet) => bet.playerId === game.viewerPlayerId);
  const blockedBetGaps = new Set<number>([
    ...(game?.hitsterBets.map((bet) => bet.gap) ?? []),
    ...(game?.selectedGap === null || game?.selectedGap === undefined ? [] : [game.selectedGap]),
  ]);
  const canBet = Boolean(
    game?.phase === "betting"
    && viewer
    && activePlayer
    && viewer.id !== activePlayer.id
    && viewer.tokens > 0
    && !viewerBet,
  );

  return <main>
    <header className="brand"><span className="record">♪</span><div><h1>Schlagerparty</h1><p>Sortier den Soundtrack deines Lebens.</p></div></header>
    {game && spotifyConnected && <button className="reset-button" onClick={resetGame} disabled={busy} title="Festgefahrene Runde beenden">↻ Runde zurücksetzen</button>}
    {error && <div className="toast error">{error}<button onClick={() => setError(null)}>×</button></div>}
    {notice && <div className="toast">{notice}</div>}
    {!game && mode === "home" && <section className="hero panel">
      <div className="eyebrow">Bereit für die Zeitreise?</div><h2>Wer kennt die Hits<br />in der richtigen Reihenfolge?</h2>
      <div className="actions">
        {spotifyConnected ? <button className="primary" onClick={loadDevices} disabled={busy}>Runde erstellen</button> : <a className="button primary" href="/api/auth/spotify">Mit Spotify verbinden</a>}
        <button className="secondary" disabled>Runde beitreten <small>Keine Runde aktiv</small></button>
      </div>
      <p className="hint">Der Host benötigt Spotify Premium und eine eigene oder kollaborative Playlist.</p>
    </section>}
    {!game && mode === "create" && <CreateForm onSubmit={createGame} devices={devices} defaultName={displayName} busy={busy} onBack={() => setMode("home")} onReload={loadDevices} />}
    {game && game.phase === "lobby" && !game.viewerPlayerId && <JoinForm onSubmit={join} busy={busy} />}
    {game && game.phase === "lobby" && game.viewerPlayerId && <Lobby game={game} busy={busy} lobbyOrigin={lobbyOrigin} onStart={() => run(() => api("/api/game/start", { method: "POST" }))} onTest={() => run(async () => { await api("/api/game/test-device", { method: "POST" }); setNotice("Spotify-Handy erfolgreich verbunden."); })} />}
    {game && (game.phase === "countdown" || game.phase === "playing" || game.phase === "betting" || game.phase === "revealing") && <section className="game-shell">
      <div className="turn-banner"><span>{game.phase === "revealing" ? "Auflösung" : game.phase === "betting" ? "HITSTER" : "Jetzt am Zug"}</span><strong>{activePlayer?.name}</strong><em>{remaining > 0 ? `${remaining}s` : "…"}</em></div>
      <ScoreStrip game={game} />
      {game.phase === "countdown" ? <div className="countdown panel"><span>Als Nächstes</span><h2>{activePlayer?.name}</h2><strong>{remaining || 1}</strong><p>Mach dich bereit – gleich startet der nächste Hit.</p></div> : <>
        <div className={`mystery panel ${game.phase === "revealing" ? "revealed" : ""}`}>
          {game.revealedTrack ? <TrackFace track={game.revealedTrack} correct={game.placementCorrect} /> : <><div className="vinyl"><span>?</span></div><h3>Welcher Hit läuft gerade?</h3><p>{remaining > 0 ? `Ausschnitt: noch ${remaining} Sekunden` : "Jetzt einsortieren"}</p></>}
        </div>
        <Timeline
          cards={activePlayer?.cards ?? []}
          interactive={Boolean(canPlace || canBet)}
          selectedGap={selectedGap}
          onSelect={setSelectedGap}
          disabledGaps={game.phase === "betting" ? Array.from(blockedBetGaps) : []}
          ownHitsterGap={viewerBet?.gap ?? null}
          hitsterGaps={game.hitsterBets.map((bet) => bet.gap)}
          revealed={game.phase === "revealing" ? game.revealedTrack : null}
          revealGap={game.selectedGap}
          correct={game.placementCorrect}
        />
        {canPlace && <button className="primary sticky" disabled={selectedGap === null || busy} onClick={() => run(() => api("/api/game/place", { method: "POST", body: JSON.stringify({ gap: selectedGap, version: game.version }) }))}>Hier platzieren</button>}
        {game.phase === "betting" && <div className="betting-actions panel">
          {game.viewerPlayerId === game.currentPlayerId && <p>Andere Teams können jetzt HITSTER setzen.</p>}
          {!viewer && <p>Du schaust als Gast zu …</p>}
          {viewer && viewer.id !== game.currentPlayerId && viewerBet && <p>Dein HITSTER liegt auf Position {viewerBet.gap + 1}.</p>}
          {viewer && viewer.id !== game.currentPlayerId && !viewerBet && viewer.tokens < 1 && <p>Du hast keine Tokens mehr.</p>}
          {canBet && <button className="primary" disabled={selectedGap === null || blockedBetGaps.has(selectedGap) || busy} onClick={() => run(() => api("/api/game/hitster", { method: "POST", body: JSON.stringify({ gap: selectedGap, version: game.version }) }))}>HITSTER einsetzen · 1 Token</button>}
          {game.viewerIsHost && <button className="secondary host-action" disabled={busy} onClick={() => run(() => api("/api/game/reveal", { method: "POST", body: JSON.stringify({ version: game.version }) }))}>Karte aufdecken</button>}
        </div>}
        {game.phase === "revealing" && game.viewerIsHost && !game.titleArtistAwarded && <button className="secondary host-action" disabled={busy} onClick={() => run(() => api("/api/game/token-earned", { method: "POST", body: JSON.stringify({ version: game.version }) }))}>{`Titel + Künstler richtig (${activePlayer?.name ?? "Aktives Team"}) · +1 Token`}</button>}
        {!canPlace && game.phase === "playing" && <p className="waiting">{viewer ? `${activePlayer?.name} entscheidet …` : "Du schaust als Gast zu …"}</p>}
      </>}
    </section>}
    {game?.phase === "finished" && <Finished game={game} busy={busy} onClose={() => run(async () => { await api("/api/game/close", { method: "POST" }); location.reload(); })} />}
  </main>;
}

function CreateForm({ onSubmit, devices, defaultName, busy, onBack, onReload }: { onSubmit: (e: FormEvent<HTMLFormElement>) => void; devices: Device[]; defaultName: string; busy: boolean; onBack: () => void; onReload: () => void }) {
  const playbackDevices = devices.filter((device) => /(smartphone|computer)/i.test(device.type));
  return <section className="panel form-panel"><button className="back" onClick={onBack}>← Zurück</button><div className="eyebrow">Neue Runde</div><h2>Party vorbereiten</h2>
    <form onSubmit={onSubmit}>
      <label>Dein Spielername<input name="hostName" required maxLength={30} defaultValue={defaultName} placeholder="z. B. Jannik" /></label>
      <label>Spotify-Playlist<input name="playlistUrl" type="url" required placeholder="https://open.spotify.com/playlist/…" /></label>
      <div className="field-row"><label>Ausschnitt (Sek.)<input name="clipSeconds" type="number" min="1" step="1" defaultValue="30" required /></label><label>Auflösung (Sek.)<input name="revealSeconds" type="number" min="1" step="1" defaultValue="8" required /></label></div>
      <label>Spotify-Gerät<select name="deviceId" required defaultValue={playbackDevices.find((d) => d.is_active)?.id ?? ""}><option value="" disabled>Host-Gerät wählen</option>{playbackDevices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.type}{device.is_active ? " · aktiv" : ""}</option>)}</select></label>
      {!playbackDevices.length && <p className="warning">Öffne Spotify auf deinem Handy oder Computer, starte kurz einen Song und lade die Geräteliste neu.</p>}
      <button type="button" className="text-button" onClick={onReload}>Geräteliste neu laden</button><button className="primary" disabled={busy || !playbackDevices.length}>{busy ? "Playlist wird geprüft …" : "Lobby erstellen"}</button>
    </form>
  </section>;
}

function JoinForm({ onSubmit, busy }: { onSubmit: (e: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return <section className="panel form-panel"><div className="eyebrow">Runde gefunden</div><h2>Mach mit!</h2><form onSubmit={onSubmit}><label>Dein Name<input name="name" required maxLength={30} autoFocus placeholder="Wie sollen wir dich nennen?" /></label><button className="primary" disabled={busy}>Runde beitreten</button></form></section>;
}

function Lobby({ game, busy, lobbyOrigin, onStart, onTest }: { game: ViewGame; busy: boolean; lobbyOrigin: string; onStart: () => void; onTest: () => void }) {
  return <section className="panel lobby"><div className="eyebrow">Lobby · {game.playlistName}</div><h2>Die Partycrew</h2><div className="players">{game.players.map((player) => <div className="player" key={player.id}><span>{player.seat + 1}</span><strong>{player.name}</strong>{player.id === game.hostPlayerId && <em>Host</em>}</div>)}</div>
    {game.viewerIsHost ? <><p className="hint">Weitere Spieler öffnen: <strong>{lobbyOrigin || "diese Startseite"}</strong></p><button className="text-button" onClick={onTest} disabled={busy}>Spotify-Gerät testen</button><button className="primary" onClick={onStart} disabled={busy || game.poolRemaining < game.players.length + 1}>Spiel starten</button></> : <div className="waiting">Der Host startet gleich …</div>}
  </section>;
}

function ScoreStrip({ game }: { game: ViewGame }) {
  return <div className="score-strip">{game.players.map((player) => <div key={player.id} className={player.id === game.currentPlayerId ? "active" : ""}><strong>{player.name}</strong><span className="tokens">{player.cards.length}/10 · {player.tokens} Tokens</span></div>)}</div>;
}

function TrackFace({ track, correct }: { track: NonNullable<PublicGame["revealedTrack"]>; correct: boolean | null }) { return <div className="track-face">{track.coverUrl && <Image src={track.coverUrl} alt="Albumcover" width={160} height={160} priority />}<div><span className={correct ? "result right" : "result wrong"}>{correct ? "Richtig!" : "Leider falsch"}</span><h3>{track.name}</h3><p>{track.artist}</p><strong>{track.year}</strong><a href={track.spotifyUrl} target="_blank" rel="noreferrer">Auf Spotify öffnen ↗</a></div></div>; }

function Timeline({ cards, interactive, selectedGap, onSelect, disabledGaps, hitsterGaps, ownHitsterGap, revealed, revealGap, correct }: { cards: PublicGame["players"][number]["cards"]; interactive: boolean; selectedGap: number | null; onSelect: (gap: number) => void; disabledGaps: number[]; hitsterGaps: number[]; ownHitsterGap: number | null; revealed: PublicGame["revealedTrack"]; revealGap: number | null; correct: boolean | null }) {
  const nodes = useMemo(() => Array.from({ length: cards.length * 2 + 1 }), [cards.length]);
  const disabledSet = useMemo(() => new Set(disabledGaps), [disabledGaps]);
  const hitsterSet = useMemo(() => new Set(hitsterGaps), [hitsterGaps]);
  return <div className="timeline-wrap"><h3>Zeitstrahl</h3><div className="timeline">{nodes.map((_, index) => {
    if (index % 2 !== 0) return <article className="card" key={cards[(index - 1) / 2].id}><small>{cards[(index - 1) / 2].year}</small><strong>{cards[(index - 1) / 2].name}</strong><span>{cards[(index - 1) / 2].artist}</span></article>;
    const gap = index / 2;
    const blocked = disabledSet.has(gap);
    return <button key={`g${index}`} aria-label={`Lücke ${gap + 1}`} className={`gap ${selectedGap === gap ? "selected" : ""} ${hitsterSet.has(gap) ? "hitster-occupied" : ""} ${ownHitsterGap === gap ? "hitster-own" : ""}`} disabled={!interactive || blocked} onClick={() => onSelect(gap)}><span>+</span>{revealed && revealGap === gap && !correct && <b className="ghost-year">{revealed.year}</b>}</button>;
  })}</div></div>;
}

function Finished({ game, busy, onClose }: { game: ViewGame; busy: boolean; onClose: () => void }) {
  const winners = game.players.filter((player) => game.winnerIds.includes(player.id));
  return <section className="panel finished"><div className="confetti">✦ ♪ ✺</div><div className="eyebrow">Spiel beendet</div><h2>{winners.length > 1 ? "Wir haben mehrere Sieger!" : `${winners[0]?.name ?? "Die Party"} gewinnt!`}</h2><p>{winners.map((winner) => winner.name).join(" & ")} {winners.length > 1 ? "teilen sich den Sieg." : "hat die Musikgeschichte gemeistert."}</p><ScoreStrip game={game} />{game.viewerIsHost && <button className="primary" disabled={busy} onClick={onClose}>Runde schließen</button>}</section>;
}
