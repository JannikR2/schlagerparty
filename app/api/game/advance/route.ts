import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { requireActiveGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { beginTurn, finishOrScheduleNext } from "@/lib/turns";

const schema = z.object({ version: z.number().int().positive() });

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    const game = await requireActiveGame();
    if (game.version !== input.version) return NextResponse.json({ game: await serializeGame(game) });
    if (game.phase === "countdown") {
      if (!game.turn_starts_at || new Date(game.turn_starts_at).getTime() > Date.now()) throw new Error("Der Countdown läuft noch.");
      const started = await beginTurn(game, game.current_seat ?? 0);
      return NextResponse.json({ game: await serializeGame(started) });
    }
    if (game.phase === "betting") {
      if (!game.betting_ends_at || new Date(game.betting_ends_at).getTime() > Date.now()) throw new Error("Das Token-Tippfenster läuft noch.");
      const { error } = await adminDb().rpc("resolve_token_round", { p_game_id: game.id, p_version: game.version });
      if (error) throw new Error(error.message);
      return NextResponse.json({ game: await serializeGame(await requireActiveGame()) });
    }
    if (game.phase !== "revealing") return NextResponse.json({ game: await serializeGame(game) });
    if (!game.reveal_ends_at || new Date(game.reveal_ends_at).getTime() > Date.now()) throw new Error("Die Auflösung läuft noch.");
    if (game.placement_correct) {
      const { data: reviewing, error } = await adminDb().from("games").update({
        phase: "reviewing", reveal_ends_at: null, version: game.version + 1,
      }).eq("id", game.id).eq("version", game.version).select().single();
      if (error) throw new Error("Die Runde wurde bereits fortgesetzt.");
      return NextResponse.json({ game: await serializeGame(reviewing) });
    }
    const next = await finishOrScheduleNext(game);
    return NextResponse.json({ game: await serializeGame(next) });
  } catch (error) { return apiError(error); }
}
