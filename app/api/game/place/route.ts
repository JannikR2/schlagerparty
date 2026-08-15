import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { currentIdentity, requireActiveGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
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
    const { data: cardRows } = await db.from("cards").select("id").eq("player_id", identity.player.id).order("position");
    const cards = cardRows ?? [];
    if (input.gap > cards.length) throw new Error("Diese Position gibt es nicht.");
    const { data: updated, error } = await db.from("games").update({
      phase: "betting",
      selected_gap: input.gap,
      placement_correct: null,
      reveal_ends_at: null,
      clip_ends_at: null,
      title_artist_awarded: false,
      version: game.version + 1,
    }).eq("id", game.id).eq("version", input.version).select().single();
    if (error) throw new Error("Der Tipp wurde bereits verarbeitet.");
    await spotifyFetchForGame(game, `/me/player/pause?device_id=${encodeURIComponent(game.spotify_device_id)}`, { method: "PUT" }).catch(() => undefined);
    return NextResponse.json({ game: await serializeGame(updated) });
  } catch (error) { return apiError(error); }
}
