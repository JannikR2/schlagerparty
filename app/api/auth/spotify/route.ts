import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

export async function GET() {
  const env = serverEnv();
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("spotify_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: env.SPOTIFY_REDIRECT_URI, state,
    scope: "playlist-read-private user-read-playback-state user-modify-playback-state",
  }).toString();
  return NextResponse.redirect(url);
}
