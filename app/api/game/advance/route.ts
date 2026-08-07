import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { requireActiveGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { beginTurn, finishByScore, scheduleTurn } from "@/lib/turns";

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
    if (game.phase !== "revealing") return NextResponse.json({ game: await serializeGame(game) });
    if (!game.reveal_ends_at || new Date(game.reveal_ends_at).getTime() > Date.now()) throw new Error("Die Auflösung läuft noch.");
    const db = adminDb();
    const [{ count: poolCount }, { data: players }] = await Promise.all([
      db.from("tracks").select("id", { count: "exact", head: true }).eq("game_id", game.id).eq("state", "pool"),
      db.from("players").select("seat").eq("game_id", game.id).order("seat"),
    ]);
    const next = !poolCount ? await finishByScore(game.id, game.version) : await scheduleTurn(game, ((game.current_seat ?? 0) + 1) % (players?.length ?? 1));
    return NextResponse.json({ game: await serializeGame(next) });
  } catch (error) { return apiError(error); }
}
