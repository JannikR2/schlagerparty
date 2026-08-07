import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { spotifyFetch } from "@/lib/spotify";

export async function GET() {
  try {
    const response = await spotifyFetch("/me/player/devices");
    const body = await response.json();
    return NextResponse.json({ devices: (body.devices ?? []).filter((device: { is_restricted: boolean }) => !device.is_restricted) });
  } catch (error) { return apiError(error); }
}
