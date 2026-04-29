import { elevenLabsClient } from "@/lib/elevenlabs-server";

export const dynamic = "force-dynamic";

// Mint a 15-minute single-use token the browser uses to open a direct
// Scribe Realtime WebSocket. Keeps ELEVENLABS_API_KEY server-side.
export async function POST() {
  try {
    const res = await elevenLabsClient().tokens.singleUse.create(
      "realtime_scribe",
    );
    return Response.json(
      { token: res.token },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown scribe-token error";
    console.error("scribe-token route failed:", message);
    return Response.json(
      { error: "Failed to mint scribe token" },
      { status: 500 },
    );
  }
}
