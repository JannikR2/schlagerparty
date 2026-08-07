import { NextResponse } from "next/server";
import { activeGame, serializeGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const game = await activeGame();
    return NextResponse.json({ game: game ? await serializeGame(game) : null });
  } catch (error) { return apiError(error); }
}
