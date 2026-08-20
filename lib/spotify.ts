import { getSpotifySession, setSpotifySession, seal, unseal, type SpotifySession } from "./session";
import { adminDb } from "./supabase";
import { serverEnv } from "./env";
import type { Track } from "./types";

type SpotifyError = { error?: { status?: number; message?: string; reason?: string } };

export class SpotifyApiError extends Error {
  constructor(public status: number, message: string, public reason?: string) { super(message); }
}

async function refresh(session: SpotifySession) {
  const env = serverEnv();
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken }),
    cache: "no-store",
  });
  if (!response.ok) throw new SpotifyApiError(response.status, "Spotify-Anmeldung ist abgelaufen.");
  const body = await response.json();
  const next = { ...session, accessToken: body.access_token, refreshToken: body.refresh_token ?? session.refreshToken, expiresAt: Date.now() + body.expires_in * 1000 };
  return next;
}

async function rawSpotifyFetch(session: SpotifySession, path: string, init: RequestInit = {}) {
  if (session.expiresAt < Date.now() + 30_000) session = await refresh(session);
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init, headers: { ...init.headers, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" }, cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as SpotifyError;
    throw new SpotifyApiError(response.status, body.error?.message ?? "Spotify-Anfrage fehlgeschlagen.", body.error?.reason);
  }
  return { response, session };
}

export async function spotifyFetch(path: string, init: RequestInit = {}) {
  const session = await getSpotifySession();
  if (!session) throw new SpotifyApiError(401, "Bitte zuerst mit Spotify verbinden.");
  const result = await rawSpotifyFetch(session, path, init);
  if (result.session.accessToken !== session.accessToken) await setSpotifySession(result.session);
  return result.response;
}

export async function spotifyFetchForGame(game: { id: string; spotify_session: string }, path: string, init: RequestInit = {}) {
  const original = await unseal<SpotifySession>(game.spotify_session);
  const { response, session } = await rawSpotifyFetch(original, path, init);
  if (session.accessToken !== original.accessToken) {
    const sealedSession = await seal(session);
    await adminDb().from("games").update({ spotify_session: sealedSession }).eq("id", game.id);
    game.spotify_session = sealedSession;
  }
  return response;
}

type SpotifyGame = { id: string; spotify_session: string; spotify_device_id: string };
type SpotifyDevice = { id: string | null; type: string; is_active: boolean; is_restricted: boolean };

export function choosePlaybackDevice(devices: SpotifyDevice[], preferredId: string) {
  const playable = devices.filter((device): device is SpotifyDevice & { id: string } =>
    Boolean(device.id) && !device.is_restricted && /^(smartphone|computer)$/i.test(device.type),
  );
  return playable.find((device) => device.id === preferredId)
    ?? playable.find((device) => device.is_active)
    ?? (playable.length === 1 ? playable[0] : null);
}

export async function playTrackForGame(game: SpotifyGame, uri: string, positionMs: number) {
  const devicesResponse = await spotifyFetchForGame(game, "/me/player/devices");
  const body = await devicesResponse.json() as { devices?: SpotifyDevice[] };
  const device = choosePlaybackDevice(body.devices ?? [], game.spotify_device_id);
  if (!device) {
    throw new SpotifyApiError(404, "Spotify-Handy nicht erreichbar. Öffne Spotify auf dem Host-Handy; die Runde versucht es gleich erneut.", "NO_ACTIVE_DEVICE");
  }

  if (device.id !== game.spotify_device_id) {
    await adminDb().from("games").update({ spotify_device_id: device.id }).eq("id", game.id);
  }

  // Explicitly activating the selected Connect device prevents mobile clients from
  // disappearing between the pause after a guess and the next turn.
  await spotifyFetchForGame(game, "/me/player", {
    method: "PUT",
    body: JSON.stringify({ device_ids: [device.id], play: false }),
  });
  await spotifyFetchForGame(game, `/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
    method: "PUT",
    body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
  });
}

export function playlistIdFromUrl(input: string) {
  const match = input.trim().match(/(?:playlist\/|spotify:playlist:)([A-Za-z0-9]+)/);
  if (!match) throw new Error("Bitte eine gültige Spotify-Playlist-URL eingeben.");
  return match[1];
}

type PlaylistItem = { item?: { id?: string; uri?: string; name?: string; duration_ms?: number; is_playable?: boolean; is_local?: boolean; external_urls?: { spotify?: string }; artists?: Array<{ name?: string }>; album?: { release_date?: string; images?: Array<{ url?: string }> } } };

export async function importPlaylist(playlistId: string) {
  const metaResponse = await spotifyFetch(`/playlists/${playlistId}?fields=name,owner(id),items(total)`);
  const meta = await metaResponse.json();
  const tracks: Track[] = [];
  let skipped = 0;
  let offset = 0;
  for (;;) {
    const response = await spotifyFetch(`/playlists/${playlistId}/items?limit=50&offset=${offset}&additional_types=track`);
    const page = await response.json() as { items: PlaylistItem[]; next: string | null };
    for (const row of page.items) {
      const item = row.item;
      const year = Number(item?.album?.release_date?.slice(0, 4));
      if (!item?.id || !item.uri || !item.name || !item.duration_ms || item.is_local || item.is_playable === false || !year || !item.artists?.length) { skipped++; continue; }
      tracks.push({
        id: item.id, spotifyUri: item.uri, name: item.name,
        artist: item.artists.map((artist) => artist.name).filter(Boolean).join(", "), year,
        durationMs: item.duration_ms, coverUrl: item.album?.images?.[0]?.url ?? null,
        spotifyUrl: item.external_urls?.spotify ?? `https://open.spotify.com/track/${item.id}`,
      });
    }
    if (!page.next) break;
    offset += 50;
  }
  return { name: meta.name as string, tracks: [...new Map(tracks.map((track) => [track.id, track])).values()], skipped };
}

export async function playTrack(deviceId: string, uri: string, positionMs: number) {
  await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT", body: JSON.stringify({ uris: [uri], position_ms: positionMs }) });
}

export async function pause(deviceId: string) {
  await spotifyFetch(`/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT" });
}
