import { NextRequest } from "next/server";

import { isArchetype } from "@/lib/agents";
import { getSignedUrlForArchetype } from "@/lib/elevenlabs-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const archetype = request.nextUrl.searchParams.get("archetype");

  if (!archetype || !isArchetype(archetype)) {
    return Response.json(
      { error: "Unknown or missing archetype" },
      { status: 400 },
    );
  }

  try {
    const signedUrl = await getSignedUrlForArchetype(archetype);
    return Response.json(
      { signedUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown signed-url error";
    console.error("signed-url route failed:", message);
    return Response.json(
      { error: "Failed to mint signed URL" },
      { status: 500 },
    );
  }
}
