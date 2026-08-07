import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { SpotifyApiError } from "./spotify";

export function apiError(error: unknown) {
  console.error(error);
  if (error instanceof ZodError) return NextResponse.json({ error: "Bitte prüfe deine Eingaben." }, { status: 400 });
  if (error instanceof SpotifyApiError) return NextResponse.json({ error: error.message, reason: error.reason }, { status: error.status });
  if (error instanceof Error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ error: "Unerwarteter Fehler." }, { status: 500 });
}
