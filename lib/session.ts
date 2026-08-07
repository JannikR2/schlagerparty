import { cookies } from "next/headers";
import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { serverEnv } from "./env";

export interface SpotifySession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  spotifyUserId: string;
  displayName: string;
}

const key = () => new TextEncoder().encode(serverEnv().SESSION_SECRET);

export async function seal(value: object) {
  return new EncryptJWT({ value })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt().setExpirationTime("30d").encrypt(key());
}

export async function unseal<T>(token: string): Promise<T> {
  const { payload } = await jwtDecrypt(token, key());
  return payload.value as T;
}

export async function setSpotifySession(session: SpotifySession) {
  const token = await seal(session);
  (await cookies()).set("spotify_session", token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getSpotifySession(): Promise<SpotifySession | null> {
  const token = (await cookies()).get("spotify_session")?.value;
  if (!token) return null;
  try {
    return await unseal<SpotifySession>(token);
  } catch { return null; }
}

export async function clearSpotifySession() {
  (await cookies()).delete("spotify_session");
}

export function newReconnectToken() { return randomBytes(32).toString("base64url"); }
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function setPlayerToken(token: string) {
  (await cookies()).set("player_token", token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
}

export async function getPlayerTokenHash() {
  const token = (await cookies()).get("player_token")?.value;
  return token ? hashToken(token) : null;
}
