import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { currentIdentity, requireActiveGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { finishOrScheduleNext } from "@/lib/turns";

const schema = z.object({ correct: z.boolean(), version: z.number().int().positive() });

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    const game = await requireActiveGame();
    const identity = await currentIdentity(game.id);
    if (!identity.isHost) throw new Error("Nur der Host darf den Real-Life-Check bestätigen.");
    if (game.phase !== "reviewing" || game.version !== input.version || !game.placement_correct) throw new Error("Dieser Real-Life-Check ist nicht mehr aktuell.");
    const db = adminDb();
    const { error } = await db.rpc("complete_real_life_check", {
      p_game_id: game.id, p_version: input.version, p_correct: input.correct,
    });
    if (error) throw new Error(error.message);
    const reviewed = await requireActiveGame();
    const next = await finishOrScheduleNext(reviewed);
    return NextResponse.json({ game: await serializeGame(next) });
  } catch (error) { return apiError(error); }
}
