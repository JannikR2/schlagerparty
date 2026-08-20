import { adminDb } from "./supabase";
import { getPlayerTokenHash, getSpotifySession } from "./session";
import type { PublicGame, Track } from "./types";

const toTrack = (row: Record<string, unknown>): Track => ({
  id: row.spotify_id as string, spotifyUri: row.spotify_uri as string, spotifyUrl: row.spotify_url as string,
  name: row.name as string, artist: row.artist as string, year: row.release_year as number,
  durationMs: row.duration_ms as number, coverUrl: row.cover_url as string | null,
});

export async function activeGame() {
  const db = adminDb();
  const { data, error } = await db.from("games").select("*").is("closed_at", null).maybeSingle();
  if (error) throw error;
  return data;
}

export async function currentIdentity(gameId: string) {
  const db = adminDb();
  const hash = await getPlayerTokenHash();
  const spotify = await getSpotifySession();
  const player = hash ? (await db.from("players").select("*").eq("game_id", gameId).eq("reconnect_token_hash", hash).maybeSingle()).data : null;
  return { player, isHost: Boolean(player?.is_host && spotify) };
}

export async function serializeGame(game: Record<string, unknown>): Promise<PublicGame & { viewerPlayerId: string | null; viewerIsHost: boolean }> {
  const db = adminDb();
  const [{ data: players }, { data: cards }, { data: tracks }, { data: tokenBets }, identity] = await Promise.all([
    db.from("players").select("id,name,seat,is_host,tokens").eq("game_id", game.id).order("seat"),
    db.from("cards").select("player_id,track_id,position").eq("game_id", game.id).order("position"),
    db.from("tracks").select("*").eq("game_id", game.id),
    game.current_track_id
      ? db.from("token_bets").select("player_id,gap,correct").eq("track_id", game.current_track_id).order("gap")
      : Promise.resolve({ data: [] }),
    currentIdentity(game.id as string),
  ]);
  const trackMap = new Map((tracks ?? []).map((track) => [track.id, track]));
  const publicPlayers = (players ?? []).map((player) => ({
    id: player.id, name: player.name, seat: player.seat, tokens: player.tokens,
    cards: (cards ?? []).filter((card) => card.player_id === player.id).map((card) => ({ ...toTrack(trackMap.get(card.track_id)!), position: card.position })),
  }));
  const current = game.current_track_id ? trackMap.get(game.current_track_id as string) : null;
  const currentPlayer = publicPlayers.find((player) => player.seat === game.current_seat);
  return {
    id: game.id as string, phase: game.phase as PublicGame["phase"], version: game.version as number,
    clipSeconds: game.clip_seconds as number, revealSeconds: game.reveal_seconds as number,
    playlistName: game.playlist_name as string, hostPlayerId: (players ?? []).find((player) => player.is_host)?.id ?? "",
    currentPlayerId: currentPlayer?.id ?? null, revealEndsAt: game.reveal_ends_at as string | null,
    bettingEndsAt: game.betting_ends_at as string | null,
    clipEndsAt: game.clip_ends_at as string | null,
    turnStartsAt: game.turn_starts_at as string | null,
    selectedGap: game.selected_gap as number | null,
    revealedTrack: ["revealing", "reviewing", "finished"].includes(game.phase as string) ? (current ? toTrack(current) : null) : null,
    placementCorrect: ["revealing", "reviewing", "finished"].includes(game.phase as string) ? game.placement_correct as boolean | null : null,
    realLifeCorrect: game.phase === "reviewing" || game.phase === "finished" ? game.real_life_correct as boolean | null : null,
    tokenBets: (tokenBets ?? []).map((bet) => ({
      playerId: bet.player_id, gap: bet.gap,
      correct: ["revealing", "reviewing", "finished"].includes(game.phase as string) ? bet.correct : null,
    })),
    players: publicPlayers, winnerIds: game.winner_ids as string[],
    poolRemaining: (tracks ?? []).filter((track) => track.state === "pool").length,
    viewerPlayerId: identity.player?.id ?? null, viewerIsHost: identity.isHost,
  };
}

export async function requireActiveGame() {
  const game = await activeGame();
  if (!game) throw new Error("Es gibt keine aktive Runde.");
  return game;
}
