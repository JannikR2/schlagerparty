"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Etwas ist schiefgegangen.");
  return body;
}

export default function HomePage() {
  const router = useRouter();
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getJson<{ game: { id: string } | null }>("/api/game"),
      getJson<{ spotifyConnected: boolean }>("/api/session"),
    ]).then(([gameResult, session]) => {
      if (gameResult.game) {
        router.replace("/game");
        return;
      }
      setSpotifyConnected(session.spotifyConnected);
      setLoading(false);
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Unbekannter Fehler");
      setLoading(false);
    });
  }, [router]);

  return <main>
    <header className="brand"><span className="record">♪</span><div><h1>Schlagerparty</h1><p>Sortier den Soundtrack deines Lebens.</p></div></header>
    {error && <div className="toast error">{error}<button onClick={() => setError(null)}>×</button></div>}
    <section className="hero panel">
      <div className="eyebrow">Bereit für die Zeitreise?</div><h2>Wer kennt die Hits<br />in der richtigen Reihenfolge?</h2>
      <div className="actions">
        {spotifyConnected ? <Link className="button primary" href="/create">Runde erstellen</Link> : <a className="button primary" href="/api/auth/spotify">Mit Spotify verbinden</a>}
        <Link className="button secondary" href={loading ? "#" : "/game"} aria-disabled={loading}>Runde beitreten <small>{loading ? "Runde wird gesucht …" : "Aktive Runde suchen"}</small></Link>
      </div>
      <p className="hint">Der Host benötigt Spotify Premium und eine eigene oder kollaborative Playlist.</p>
    </section>
  </main>;
}
