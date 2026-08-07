import { randomInt } from "node:crypto";
import { adminDb } from "./supabase";
import { randomClipStart, winnersByScore } from "./game-engine";
import { spotifyFetchForGame } from "./spotify";

export async function beginTurn(game: Record<string, unknown>, seat: number) {
  const db = adminDb();
  const { data: pool, error } = await db.from("tracks").select("*").eq("game_id", game.id).eq("state", "pool");
  if (error) throw error;
  if (!pool?.length) return finishByScore(game.id as string, game.version as number);
  const track = pool[randomInt(pool.length)];
  const { clipMs, positionMs } = randomClipStart(track.duration_ms, game.clip_seconds as number);
  const now = Date.now();
  const { data: updated, error: updateError } = await db.from("games").update({
    phase: "playing", current_seat: seat, current_track_id: track.id, selected_gap: null, placement_correct: null,
    reveal_ends_at: null, turn_starts_at: null, clip_ends_at: new Date(now + clipMs).toISOString(), version: (game.version as number) + 1,
  }).eq("id", game.id).eq("version", game.version).select().single();
  if (updateError) throw new Error("Der Spielzustand wurde bereits verändert. Bitte aktualisieren.");
  await db.from("tracks").update({ state: "current" }).eq("id", track.id).eq("state", "pool");
  try {
    await spotifyFetchForGame(game as { id: string; spotify_session: string }, `/me/player/play?device_id=${encodeURIComponent(game.spotify_device_id as string)}`, {
      method: "PUT", body: JSON.stringify({ uris: [track.spotify_uri], position_ms: positionMs }),
    });
  } catch (error) {
    await db.from("tracks").update({ state: "pool" }).eq("id", track.id);
    await db.from("games").update({ phase: "lobby", current_track_id: null, clip_ends_at: null, version: updated.version + 1 }).eq("id", game.id);
    throw error;
  }
  return updated;
}

export async function scheduleTurn(game: Record<string, unknown>, seat: number) {
  const db = adminDb();
  const { data, error } = await db.from("games").update({
    phase: "countdown", current_seat: seat, current_track_id: null, selected_gap: null,
    placement_correct: null, reveal_ends_at: null, clip_ends_at: null,
    turn_starts_at: new Date(Date.now() + 5000).toISOString(), version: (game.version as number) + 1,
  }).eq("id", game.id).eq("version", game.version).select().single();
  if (error) throw new Error("Der Spielzustand wurde bereits verändert. Bitte aktualisieren.");
  return data;
}

export async function finishByScore(gameId: string, version: number) {
  const db = adminDb();
  const { data: players } = await db.from("players").select("id").eq("game_id", gameId);
  const { data: cards } = await db.from("cards").select("player_id").eq("game_id", gameId);
  const scores = (players ?? []).map((player) => ({ id: player.id, cardCount: (cards ?? []).filter((card) => card.player_id === player.id).length }));
  const winnerIds = winnersByScore(scores);
  const { data, error } = await db.from("games").update({ phase: "finished", winner_ids: winnerIds, reveal_ends_at: null, clip_ends_at: null, turn_starts_at: null, version: version + 1 }).eq("id", gameId).eq("version", version).select().single();
  if (error) throw error;
  return data;
}
