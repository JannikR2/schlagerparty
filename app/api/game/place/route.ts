import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { currentIdentity, requireActiveGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { isPlacementCorrect } from "@/lib/game-engine";
import { spotifyFetchForGame } from "@/lib/spotify";

const schema = z.object({ gap: z.number().int().nonnegative(), version: z.number().int().positive() });

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    const game = await requireActiveGame();
    if (game.phase !== "playing" || game.version !== input.version || !game.current_track_id) throw new Error("Dieser Zug ist nicht mehr aktuell.");
    const identity = await currentIdentity(game.id);
    if (!identity.player || identity.player.seat !== game.current_seat) throw new Error("Nur der aktive Spieler darf platzieren.");
    const db = adminDb();
    const [{ data: cardRows }, { data: track }] = await Promise.all([
      db.from("cards").select("*,tracks(release_year)").eq("player_id", identity.player.id).order("position"),
      db.from("tracks").select("*").eq("id", game.current_track_id).single(),
    ]);
    const cards = (cardRows ?? []).map((card) => ({ year: card.tracks.release_year })) as Array<{ year: number }>;
    if (input.gap > cards.length) throw new Error("Diese Position gibt es nicht.");
    const correct = isPlacementCorrect(cards as never[], input.gap, track.release_year);
    const bettingEndsAt = new Date(Date.now() + 10_000).toISOString();
    const { data: updated, error } = await db.from("games").update({
      phase: "betting", selected_gap: input.gap, placement_correct: correct, betting_ends_at: bettingEndsAt,
      reveal_ends_at: null, clip_ends_at: null, version: game.version + 1,
    }).eq("id", game.id).eq("version", input.version).select().single();
    if (error) throw new Error("Der Tipp wurde bereits verarbeitet.");
    await spotifyFetchForGame(game, `/me/player/pause?device_id=${encodeURIComponent(game.spotify_device_id)}`, { method: "PUT" }).catch(() => undefined);
    return NextResponse.json({ game: await serializeGame(updated) });
  } catch (error) { return apiError(error); }
}
