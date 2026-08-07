import { NextResponse } from "next/server";
import { getSpotifySession } from "@/lib/session";

export async function GET() {
  const spotify = await getSpotifySession();
  return NextResponse.json({ spotifyConnected: Boolean(spotify), displayName: spotify?.displayName ?? null });
}
