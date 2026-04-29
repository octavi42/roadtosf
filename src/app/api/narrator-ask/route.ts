import { NextResponse } from "next/server";
import { z } from "zod";
import { completeJson, MODELS, extractJsonObject } from "@/lib/anthropic";

const NARRATOR_ASK_TIMEOUT_MS = 8000;
const MAX_ANSWER_TOKENS = 200;
const MAX_QUESTION_LENGTH = 280;

const responseSchema = z.object({
  answer: z.string().min(1).max(800),
});

type ParsedResponse = z.infer<typeof responseSchema>;

interface Body {
  question?: unknown;
  context?: {
    startupName?: unknown;
    startupDescription?: unknown;
    selfDescription?: unknown;
    team?: unknown;
    fundingModel?: unknown;
    concern?: unknown;
  };
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

const SYSTEM_PROMPT = [
  "You are the NARRATOR of Road to SF — a noir-tinged omniscient voice over a founder's first night in San Francisco.",
  "",
  "Style: dry, watchful, slightly amused. 1–2 sentences. Never longer.",
  "Tone reference: Disco Elysium's narrator if it had read Hacker News.",
  "",
  "RULES",
  "1. Stay in-world. SF, founders, the trip, the night, the player's startup, the Valley as a place — fair game. Politics, current news, math problems, code, anything outside that — politely deflect (e.g. 'Not what I'm here for. Ask me about the city.').",
  "2. NEVER spoil the story. You do not know which VCs, accelerators, or famous figures appear tonight. You do not know how the night ends. If asked who they will meet, deflect.",
  "3. NEVER break the fourth wall. Do not mention loading, generation, AI, models, latency, the game, or that you're 'waiting for' anything. Treat the gap as the player getting their bearings.",
  "4. NEVER use @handles. You may name public figures (Sam Altman, Paul Graham, Peter Thiel, Garry Tan, Marc Andreessen, etc.) — but only as in-world references, never tagged.",
  "5. NO unescaped double quotes inside the answer. Use single quotes (') for any in-text speech.",
  "",
  "OUTPUT — single JSON object, no prose before or after, no code fence:",
  '{ "answer": "<reply, 1–2 sentences>" }',
].join("\n");

function buildUserPrompt(
  question: string,
  context: NonNullable<Body["context"]>,
): string {
  const startupName = asString(context.startupName).trim();
  const startupDescription = asString(context.startupDescription).trim();
  const persona = asString(context.selfDescription).trim();
  const team = asString(context.team).trim();
  const funding = asString(context.fundingModel).trim();
  const concern = asString(context.concern).trim();

  const lines: string[] = ["Player context (use only if relevant; otherwise ignore):"];
  if (startupName) lines.push(`- Startup name: ${startupName}`);
  if (startupDescription) lines.push(`- What they're building: ${startupDescription}`);
  if (persona) lines.push(`- How they describe themselves: ${persona}`);
  if (team) lines.push(`- Team: ${team}`);
  if (funding) lines.push(`- Funding: ${funding}`);
  if (concern) lines.push(`- What they don't say to investors: ${concern}`);
  lines.push("");
  lines.push(`Player asks: ${question}`);
  lines.push("");
  lines.push("Reply as the Narrator. JSON object only.");
  return lines.join("\n");
}

function parseFromRaw(raw: string): ParsedResponse {
  const json = extractJsonObject(raw);
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const question = asString(body.question).trim();
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: "question too long" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  }

  const userPrompt = buildUserPrompt(question, body.context ?? {});

  try {
    const result = await Promise.race<ParsedResponse>([
      completeJson(
        {
          model: MODELS.scene,
          systemBlocks: [{ text: SYSTEM_PROMPT, cache: true }],
          userBlocks: [{ text: userPrompt }],
          maxTokens: MAX_ANSWER_TOKENS,
          temperature: 0.85,
        },
        parseFromRaw,
      ),
      new Promise<ParsedResponse>((_, reject) =>
        setTimeout(
          () => reject(new Error("narrator-ask timed out")),
          NARRATOR_ASK_TIMEOUT_MS,
        ),
      ),
    ]);
    return NextResponse.json({ answer: result.answer });
  } catch (err) {
    console.warn("narrator-ask failed", err);
    return NextResponse.json(
      { error: "narrator unavailable" },
      { status: 503 },
    );
  }
}
