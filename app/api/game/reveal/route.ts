import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { currentIdentity, requireActiveGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { spotifyFetchForGame } from "@/lib/spotify";

const schema = z.object({ version: z.number().int().positive() });

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    const game = await requireActiveGame();
    const identity = await currentIdentity(game.id);
    if (!identity.isHost) throw new Error("Nur der Host darf aufdecken.");
    if (game.phase !== "betting") throw new Error("Aufdecken ist nur in der HITSTER-Phase möglich.");

    const db = adminDb();
    const { error } = await db.rpc("resolve_hitster_turn", { p_game_id: game.id, p_version: input.version });
    if (error) throw new Error(error.message);

    await spotifyFetchForGame(game, `/me/player/pause?device_id=${encodeURIComponent(game.spotify_device_id)}`, { method: "PUT" }).catch(() => undefined);

    const updatedGame = await requireActiveGame();
    const { data: cardRows } = await db.from("cards").select("player_id").eq("game_id", updatedGame.id);
    const counts = new Map<string, number>();
    for (const card of cardRows ?? []) counts.set(card.player_id, (counts.get(card.player_id) ?? 0) + 1);
    const winnerIds = [...counts.entries()].filter(([, count]) => count >= 10).map(([playerId]) => playerId);
    if (!winnerIds.length) return NextResponse.json({ game: await serializeGame(updatedGame) });

    const { data: finished, error: finishError } = await db.from("games").update({
      phase: "finished",
      winner_ids: winnerIds,
      reveal_ends_at: null,
      turn_starts_at: null,
      version: updatedGame.version + 1,
    }).eq("id", updatedGame.id).eq("version", updatedGame.version).select().single();
    if (finishError) throw new Error("Das Spiel wurde bereits weitergeführt. Bitte aktualisieren.");

    return NextResponse.json({ game: await serializeGame(finished) });
  } catch (error) {
    return apiError(error);
  }
}
