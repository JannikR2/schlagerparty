# Schlagerparty

Eine mobile Mehrspieler-WebApp nach dem Musik-Zeitstrahl-Prinzip. Ein Spotify-Premium-Host steuert die Wiedergabe auf seinem Handy; Gäste spielen ohne Konto über ihre Browser mit.

## Lokale Einrichtung

1. Ein Supabase-Projekt erstellen und `supabase/migrations/202608070001_initial.sql` im SQL Editor ausführen.
2. Im Spotify Developer Dashboard eine App im Development Mode erstellen. Als Redirect URI exakt `http://127.0.0.1:3000/api/auth/spotify/callback` hinterlegen und den Premium-Host zur Allowlist hinzufügen.
3. `.env.example` nach `.env.local` kopieren und alle Werte eintragen. `SESSION_SECRET` muss mindestens 32 zufällige Zeichen enthalten.
4. Anwendung starten:

```bash
npm install
npm run dev
```

Spotify akzeptiert für Development Mode nur Playlists, die dem Host gehören oder an denen er mitarbeitet. Vor dem Erstellen einer Runde Spotify auf dem Host-Handy öffnen und kurz einen Titel starten, damit es als Spotify-Connect-Gerät erscheint.

## Vercel

- Repository importieren und die Werte aus `.env.example` als Environment Variables hinterlegen.
- Die produktive Callback-URL (`https://<domain>/api/auth/spotify/callback`) sowohl bei Spotify als auch als `SPOTIFY_REDIRECT_URI` eintragen.
- Supabase Realtime muss für die Tabelle `game_signals` aktiviert sein; die Migration erledigt dies normalerweise automatisch.

## Qualitätssicherung

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Die Spotify-End-to-End-Prüfung benötigt echte Zugangsdaten, eine eigene Playlist und ein aktives Premium-Gerät.
