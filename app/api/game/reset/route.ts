import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireActiveGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { getSpotifySession } from "@/lib/session";
import { spotifyFetchForGame } from "@/lib/spotify";

export async function POST() {
  try {
    const game = await requireActiveGame();
    const spotify = await getSpotifySession();
    if (!spotify || spotify.spotifyUserId !== game.host_spotify_id) {
      throw new Error("Nur der angemeldete Spotify-Host kann die Runde zurücksetzen.");
    }

    if (game.spotify_device_id) {
      await spotifyFetchForGame(
        game,
        `/me/player/pause?device_id=${encodeURIComponent(game.spotify_device_id)}`,
        { method: "PUT" },
      ).catch(() => undefined);
    }

    const { error } = await adminDb().from("games").update({
      closed_at: new Date().toISOString(),
      reveal_ends_at: null,
      clip_ends_at: null,
      turn_starts_at: null,
      version: game.version + 1,
    }).eq("id", game.id).eq("version", game.version);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
