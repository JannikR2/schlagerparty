import { describe, expect, it } from "vitest";
import { insertCard, isPlacementCorrect, randomClipStart, winnersByScore } from "./game-engine";
import type { Card, Track } from "./types";

const track = (id: string, year: number): Track => ({ id, year, spotifyUri: `spotify:track:${id}`, spotifyUrl: `https://open.spotify.com/track/${id}`, name: id, artist: "Artist", durationMs: 180_000, coverUrl: null });
const cards = (...years: number[]): Card[] => years.map((year, position) => ({ ...track(String(position), year), position }));

describe("isPlacementCorrect", () => {
  it("accepts before, between and after sorted cards", () => {
    const timeline = cards(1980, 2000);
    expect(isPlacementCorrect(timeline, 0, 1970)).toBe(true);
    expect(isPlacementCorrect(timeline, 1, 1990)).toBe(true);
    expect(isPlacementCorrect(timeline, 2, 2010)).toBe(true);
  });
  it("accepts either side of equal years", () => {
    expect(isPlacementCorrect(cards(1980, 1990), 0, 1980)).toBe(true);
    expect(isPlacementCorrect(cards(1980, 1990), 1, 1980)).toBe(true);
  });
  it("rejects unsorted and nonexistent gaps", () => {
    expect(isPlacementCorrect(cards(1980, 2000), 1, 1970)).toBe(false);
    expect(isPlacementCorrect(cards(1980), 2, 2000)).toBe(false);
  });
});

describe("insertCard", () => {
  it("inserts and renumbers the timeline", () => {
    expect(insertCard(cards(1980, 2000), track("new", 1990), 1).map((card) => [card.year, card.position])).toEqual([[1980, 0], [1990, 1], [2000, 2]]);
  });
});

describe("randomClipStart", () => {
  it("uses a deterministic valid start", () => {
    expect(randomClipStart(100_000, 30, () => 0.5)).toEqual({ clipMs: 30_000, positionMs: 35_000 });
  });
  it("shortens clips that exceed the track", () => {
    expect(randomClipStart(12_000, 30, () => 0.9)).toEqual({ clipMs: 12_000, positionMs: 0 });
  });
});

describe("winnersByScore", () => {
  it("returns all leaders on a tie", () => {
    expect(winnersByScore([{ id: "a", cardCount: 4 }, { id: "b", cardCount: 5 }, { id: "c", cardCount: 5 }])).toEqual(["b", "c"]);
  });
});
