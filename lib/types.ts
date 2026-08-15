export type GamePhase = "lobby" | "countdown" | "playing" | "betting" | "revealing" | "finished";

export interface Track {
  id: string;
  spotifyUri: string;
  name: string;
  artist: string;
  year: number;
  durationMs: number;
  coverUrl: string | null;
  spotifyUrl: string;
}

export interface Card extends Track {
  position: number;
}

export interface Player {
  id: string;
  name: string;
  seat: number;
  tokens: number;
  cards: Card[];
}

export interface HitsterBet {
  playerId: string;
  gap: number;
}

export interface PublicGame {
  id: string;
  phase: GamePhase;
  version: number;
  clipSeconds: number;
  revealSeconds: number;
  playlistName: string;
  hostPlayerId: string;
  currentPlayerId: string | null;
  revealEndsAt: string | null;
  clipEndsAt: string | null;
  turnStartsAt: string | null;
  selectedGap: number | null;
  revealedTrack: Track | null;
  placementCorrect: boolean | null;
  titleArtistAwarded: boolean;
  hitsterBets: HitsterBet[];
  players: Player[];
  winnerIds: string[];
  poolRemaining: number;
}
