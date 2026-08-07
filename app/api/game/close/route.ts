import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase";
import { currentIdentity, requireActiveGame } from "@/lib/game-data";
import { apiError } from "@/lib/http";

export async function POST() {
  try {
    const game = await requireActiveGame();
    const identity = await currentIdentity(game.id);
    if (!identity.isHost) throw new Error("Nur der Host kann die Runde schließen.");
    await adminDb().from("games").update({ closed_at: new Date().toISOString(), version: game.version + 1 }).eq("id", game.id).eq("version", game.version);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
