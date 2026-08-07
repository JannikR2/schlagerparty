import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";
import { setSpotifySession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const env = serverEnv();
  const jar = await cookies();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state || state !== jar.get("spotify_oauth_state")?.value) return NextResponse.redirect(new URL("/?error=spotify_state", request.url));
  jar.delete("spotify_oauth_state");
  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: env.SPOTIFY_REDIRECT_URI }),
  });
  if (!tokenResponse.ok) return NextResponse.redirect(new URL("/?error=spotify_token", request.url));
  const token = await tokenResponse.json();
  const meResponse = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${token.access_token}` } });
  const me = await meResponse.json();
  await setSpotifySession({ accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, spotifyUserId: me.id, displayName: me.display_name ?? "Host" });
  return NextResponse.redirect(new URL("/", request.url));
}
