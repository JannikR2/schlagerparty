import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { activeGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { getSpotifySession, hashToken, newReconnectToken, seal, setPlayerToken } from "@/lib/session";
import { importPlaylist, playlistIdFromUrl, spotifyFetch } from "@/lib/spotify";

const schema = z.object({ hostName: z.string().trim().min(1).max(30), playlistUrl: z.string().min(1), clipSeconds: z.coerce.number().int().positive(), revealSeconds: z.coerce.number().int().positive(), deviceId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const db = adminDb();
  let createdId: string | null = null;
  try {
    if (await activeGame()) throw new Error("Es läuft bereits eine Runde.");
    const session = await getSpotifySession();
    if (!session) throw new Error("Bitte zuerst mit Spotify verbinden.");
    const input = schema.parse(await request.json());
    const devicesResponse = await spotifyFetch("/me/player/devices");
    const devices = (await devicesResponse.json()).devices as Array<{ id: string; type: string; is_restricted: boolean }>;
    const device = devices.find((item) => item.id === input.deviceId && !item.is_restricted);
    if (!device) throw new Error("Das Spotify-Gerät ist nicht mehr verfügbar. Öffne Spotify auf dem Host-Handy erneut.");
    if (!/(smartphone|computer)/i.test(device.type)) throw new Error("Bitte die Spotify-App auf dem Host-Handy oder Computer auswählen.");
    const playlistId = playlistIdFromUrl(input.playlistUrl);
    const imported = await importPlaylist(playlistId);
    if (imported.tracks.length < 2) throw new Error("Die Playlist enthält nicht genug geeignete Titel.");
    const { data: game, error: gameError } = await db.from("games").insert({
      playlist_id: playlistId, playlist_name: imported.name, clip_seconds: input.clipSeconds, reveal_seconds: input.revealSeconds,
      host_spotify_id: session.spotifyUserId, spotify_session: await seal(session), spotify_device_id: input.deviceId,
    }).select().single();
    if (gameError) throw gameError;
    createdId = game.id;
    const token = newReconnectToken();
    const { error: playerError } = await db.from("players").insert({ game_id: game.id, name: input.hostName, seat: 0, reconnect_token_hash: hashToken(token), is_host: true });
    if (playerError) throw playerError;
    const { error: tracksError } = await db.from("tracks").insert(imported.tracks.map((track) => ({
      game_id: game.id, spotify_id: track.id, spotify_uri: track.spotifyUri, spotify_url: track.spotifyUrl, name: track.name,
      artist: track.artist, release_year: track.year, duration_ms: track.durationMs, cover_url: track.coverUrl,
    })));
    if (tracksError) throw tracksError;
    await setPlayerToken(token);
    return NextResponse.json({ game: await serializeGame(game), skipped: imported.skipped });
  } catch (error) {
    if (createdId) await db.from("games").delete().eq("id", createdId);
    return apiError(error);
  }
}
