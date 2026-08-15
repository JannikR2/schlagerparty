import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { currentIdentity, requireActiveGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";

const schema = z.object({ version: z.number().int().positive() });

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    const game = await requireActiveGame();
    const identity = await currentIdentity(game.id);
    if (!identity.isHost || !identity.player) throw new Error("Nur der Host darf Tokens vergeben.");
    if (game.phase !== "revealing") throw new Error("Der Bonus kann nur während der Auflösung vergeben werden.");

    const db = adminDb();
    const { error } = await db.rpc("award_title_artist_token", {
      p_game_id: game.id,
      p_host_player_id: identity.player.id,
      p_version: input.version,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ game: await serializeGame(await requireActiveGame()) });
  } catch (error) {
    return apiError(error);
  }
}
