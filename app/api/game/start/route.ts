import { NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { requireActiveGame, currentIdentity, serializeGame } from "@/lib/game-data";
import { adminDb } from "@/lib/supabase";
import { apiError } from "@/lib/http";
import { beginTurn } from "@/lib/turns";

export async function POST() {
  try {
    const game = await requireActiveGame();
    const identity = await currentIdentity(game.id);
    if (!identity.isHost) throw new Error("Nur der Host kann das Spiel starten.");
    if (game.phase !== "lobby") throw new Error("Das Spiel wurde bereits gestartet.");
    const db = adminDb();
    const [{ data: players }, { data: tracks }] = await Promise.all([
      db.from("players").select("*").eq("game_id", game.id).order("seat"),
      db.from("tracks").select("*").eq("game_id", game.id).eq("state", "pool"),
    ]);
    if (!players?.length || !tracks || tracks.length < players.length + 1) throw new Error("Die Playlist braucht mindestens eine Startkarte pro Spieler plus einen Ratetitel.");
    const available = [...tracks];
    const cards = players.map((player) => {
      const index = randomInt(available.length);
      const [track] = available.splice(index, 1);
      return { game_id: game.id, player_id: player.id, track_id: track.id, position: 0 };
    });
    const { error: cardError } = await db.from("cards").insert(cards);
    if (cardError) throw cardError;
    await db.from("tracks").update({ state: "card" }).in("id", cards.map((card) => card.track_id));
    const started = await beginTurn(game, 0);
    return NextResponse.json({ game: await serializeGame(started) });
  } catch (error) { return apiError(error); }
}
