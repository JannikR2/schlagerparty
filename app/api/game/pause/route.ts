import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";
import { spotifyFetchForGame } from "@/lib/spotify";

const schema = z.object({ version: z.number().int().positive() });
export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    const game = await requireActiveGame();
    if (game.phase !== "playing" || game.version !== input.version || !game.clip_ends_at || new Date(game.clip_ends_at).getTime() > Date.now()) return NextResponse.json({ ok: true });
    await spotifyFetchForGame(game, `/me/player/pause?device_id=${encodeURIComponent(game.spotify_device_id)}`, { method: "PUT" });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
