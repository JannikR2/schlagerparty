import type { Card, Track } from "./types";

export function isPlacementCorrect(cards: Card[], gap: number, year: number) {
  if (!Number.isInteger(gap) || gap < 0 || gap > cards.length) return false;
  const before = cards[gap - 1];
  const after = cards[gap];
  return (!before || before.year <= year) && (!after || year <= after.year);
}

export function insertCard(cards: Card[], track: Track, gap: number): Card[] {
  const next = [...cards];
  next.splice(gap, 0, { ...track, position: gap });
  return next.map((card, position) => ({ ...card, position }));
}

export function randomClipStart(durationMs: number, requestedSeconds: number, random = Math.random) {
  const clipMs = Math.min(durationMs, Math.max(1, requestedSeconds) * 1000);
  const availableStart = Math.max(0, durationMs - clipMs);
  return { clipMs, positionMs: Math.floor(random() * (availableStart + 1)) };
}

export function winnersByScore(players: Array<{ id: string; cardCount: number }>) {
  const max = Math.max(...players.map((player) => player.cardCount));
  return players.filter((player) => player.cardCount === max).map((player) => player.id);
}

export function automaticPlacementGap(cards: Array<{ year: number }>, year: number) {
  return cards.filter((card) => card.year <= year).length;
}

export function tokenAfterBonus(tokens: number) {
  return Math.min(5, tokens + 1);
}

export function winnersAtTarget(players: Array<{ id: string; cardCount: number }>, target = 10) {
  return players.filter((player) => player.cardCount >= target).map((player) => player.id);
}
