import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { currentIdentity, requireActiveGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";

const schema = z.object({ gap: z.number().int().nonnegative() });

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    const game = await requireActiveGame();
    const identity = await currentIdentity(game.id);
    if (!identity.player) throw new Error("Bitte zuerst der Runde beitreten.");
    const { error } = await adminDb().rpc("place_token_bet", {
      p_game_id: game.id, p_player_id: identity.player.id, p_gap: input.gap,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ game: await serializeGame(await requireActiveGame()) });
  } catch (error) { return apiError(error); }
}
