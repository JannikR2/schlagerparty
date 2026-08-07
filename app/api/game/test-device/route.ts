import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase";
import { currentIdentity, requireActiveGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { spotifyFetchForGame } from "@/lib/spotify";

export async function POST() {
  try {
    const game = await requireActiveGame();
    const identity = await currentIdentity(game.id);
    if (!identity.isHost || game.phase !== "lobby") throw new Error("Der Verbindungstest ist nur für den Host in der Lobby verfügbar.");
    const { data: track } = await adminDb().from("tracks").select("spotify_uri").eq("game_id", game.id).eq("state", "pool").limit(1).single();
    if (!track) throw new Error("Kein Testtitel verfügbar.");
    const device = encodeURIComponent(game.spotify_device_id);
    await spotifyFetchForGame(game, `/me/player/play?device_id=${device}`, { method: "PUT", body: JSON.stringify({ uris: [track.spotify_uri], position_ms: 0 }) });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await spotifyFetchForGame(game, `/me/player/pause?device_id=${device}`, { method: "PUT" });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
