import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase";
import { requireActiveGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { hashToken, newReconnectToken, setPlayerToken } from "@/lib/session";

const schema = z.object({ name: z.string().trim().min(1).max(30) });

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    const game = await requireActiveGame();
    if (game.phase !== "lobby") throw new Error("Diese Runde läuft bereits.");
    const db = adminDb();
    const { data: players } = await db.from("players").select("seat,name").eq("game_id", game.id).order("seat", { ascending: false });
    if (players?.some((player) => player.name.toLocaleLowerCase("de") === input.name.toLocaleLowerCase("de"))) throw new Error("Dieser Name ist bereits vergeben.");
    const token = newReconnectToken();
    const { error } = await db.from("players").insert({ game_id: game.id, name: input.name, seat: (players?.[0]?.seat ?? -1) + 1, reconnect_token_hash: hashToken(token) });
    if (error) throw error;
    await setPlayerToken(token);
    return NextResponse.json({ game: await serializeGame(game) });
  } catch (error) { return apiError(error); }
}
