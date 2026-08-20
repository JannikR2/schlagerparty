"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Device = { id: string; name: string; type: string; is_active: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Etwas ist schiefgegangen.");
  return body;
}

export default function CreatePage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ devices: Device[] }>("/api/spotify/devices");
      setDevices(result.devices);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unbekannter Fehler");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      api<{ game: { id: string } | null }>("/api/game"),
      api<{ spotifyConnected: boolean; displayName: string | null }>("/api/session"),
    ]).then(([gameResult, session]) => {
      if (gameResult.game) return router.replace("/game");
      if (!session.spotifyConnected) {
        router.replace("/api/auth/spotify");
        return;
      }
      setDisplayName(session.displayName ?? "");
      void loadDevices();
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Unbekannter Fehler");
      setBusy(false);
    });
  }, [loadDevices, router]);

  const createGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/game/create", { method: "POST", body: JSON.stringify(Object.fromEntries(data)) });
      router.push("/game");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unbekannter Fehler");
      setBusy(false);
    }
  };

  const playbackDevices = devices.filter((device) => /(smartphone|computer)/i.test(device.type));

  return <main>
    <header className="brand"><span className="record">♪</span><div><h1>Schlagerparty</h1><p>Sortier den Soundtrack deines Lebens.</p></div></header>
    {error && <div className="toast error">{error}<button onClick={() => setError(null)}>×</button></div>}
    <section className="panel form-panel">
      <Link className="back" href="/">← Zurück</Link><div className="eyebrow">Neue Runde</div><h2>Party vorbereiten</h2>
      <form onSubmit={createGame}>
        <label>Dein Spielername<input key={displayName} name="hostName" required maxLength={30} defaultValue={displayName} placeholder="z. B. Jannik" /></label>
        <label>Spotify-Playlist<input name="playlistUrl" type="url" required placeholder="https://open.spotify.com/playlist/…" /></label>
        <div className="field-row"><label>Ausschnitt (Sek.)<input name="clipSeconds" type="number" min="1" step="1" defaultValue="30" required /></label><label>Auflösung (Sek.)<input name="revealSeconds" type="number" min="1" step="1" defaultValue="8" required /></label></div>
        <label>Spotify-Gerät<select key={playbackDevices.map((device) => device.id).join(",")} name="deviceId" required defaultValue={playbackDevices.find((device) => device.is_active)?.id ?? ""}><option value="" disabled>Host-Gerät wählen</option>{playbackDevices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.type}{device.is_active ? " · aktiv" : ""}</option>)}</select></label>
        {!busy && !playbackDevices.length && <p className="warning">Öffne Spotify auf deinem Handy oder Computer, starte kurz einen Song und lade die Geräteliste neu.</p>}
        <button type="button" className="text-button" onClick={() => void loadDevices()} disabled={busy}>Geräteliste neu laden</button>
        <button className="primary" disabled={busy || !playbackDevices.length}>{busy ? "Spotify wird geprüft …" : "Lobby erstellen"}</button>
      </form>
    </section>
  </main>;
}
