// Hardcoded onboarding-as-narrative scenes.
//
// Scenes 1–3 are pre-paywall — the NARRATOR addresses the player directly
// (cold-open / Disco-Elysium-coded WORLD voice). No human character speaks
// until after the paywall.
//
// Scene 4 is post-paywall — Jordan appears for the first time at SFO
// arrivals and walks the player through a Q&A car ride that captures the
// structured facts the LLM needs: team, funding model, and current concern.
//
// After scene 4, the NarratorLobby (src/components/NarratorLobby.tsx)
// bridges the wait while episode 0 generates — in-character Q&A with
// the Narrator until the player clicks Continue.
//
// Speaker convention: "Narrator" routes to NARRATOR_VOICE_ID, "Jordan ..."
// routes to JORDAN_VOICE_ID (see src/lib/voices/speaker.ts). Lines without
// a speaker would not be voiced — every authored line carries one.

export interface DialogueLine {
  speaker?: string;
  text: string;
}

export interface Choice {
  id: string;
  label: string;
  hype: number;
  integrity: number;
}

export type IntroExtractField =
  | "startupDescription"
  | "selfDescription"
  | "stage"
  | "team"
  | "fundingModel"
  | "targetCustomer"
  | "concern";

export interface TextInputConfig {
  placeholder: string;
  extractAs: IntroExtractField;
}

export interface QuestionStep {
  prompt: DialogueLine; // the in-character question text
  placeholder: string;
  extractAs: IntroExtractField;
}

export interface SceneData {
  id: number;
  title: string;
  background?: string;
  dialogue: DialogueLine[];
  choices?: Choice[];
  textInput?: TextInputConfig;
  // Multi-step Q&A: scene plays its `dialogue` once, then walks through these
  // questions sequentially in the same scene before advancing.
  questions?: QuestionStep[];
  // When the scene has no choices and no textInput, render a single CTA
  // button that advances the scene. Used for cinematic-pivot beats like
  // scene 3 (the dare → paywall).
  ctaLabel?: string;
}

export const HOME_BACKGROUND = "/intro-v3/02-cafe-planning.png";
export const BOARDING_PASS_BACKGROUND = "/intro-v3/03-confirm-flight.png";
export const SF_BACKGROUND = "/intro-v3/04-sfo-arrival.png";
export const GROUP1_BACKGROUND = "/groups/01-exploring-sf.png";

const NARRATOR = "Narrator";
const JORDAN = "Jordan · Friend, SF";

export const SCENES: SceneData[] = [
  // -------- Pre-paywall: NARRATOR voice. Player is alone with the city
  // in their head until they buy in. --------
  {
    id: 1,
    title: "Who you are",
    background: HOME_BACKGROUND,
    dialogue: [
      {
        speaker: NARRATOR,
        text: "Before we get to the company, who are you?",
      },
      {
        speaker: NARRATOR,
        text: "First-timer, second exit, somewhere weirder?",
      },
      {
        speaker: NARRATOR,
        text: "Three sentences. Skip the deck voice.",
      },
    ],
    textInput: {
      placeholder: "First-time. Burned out. Second exit. Whatever's true.",
      extractAs: "selfDescription",
    },
  },
  {
    id: 2,
    title: "What you've been telling strangers",
    background: HOME_BACKGROUND,
    dialogue: [
      {
        speaker: NARRATOR,
        text: "Now the other one.",
      },
      {
        speaker: NARRATOR,
        text: "The one with numbers. The one you'd say to a stranger sober.",
      },
      {
        speaker: NARRATOR,
        text: "What are you building?",
      },
    ],
    textInput: {
      placeholder: "Pretend you're at a coffee meeting. Go.",
      extractAs: "startupDescription",
    },
  },
  {
    id: 3,
    title: "The decision",
    background: BOARDING_PASS_BACKGROUND,
    dialogue: [
      {
        speaker: NARRATOR,
        text: "One ticket. One direction. Non-refundable.",
      },
      {
        speaker: NARRATOR,
        text: "Most people stop here.",
      },
      {
        speaker: NARRATOR,
        text: "The rest of you become the story.",
      },
    ],
    ctaLabel: "Book the one-way →",
  },
  // -------- Paywall fires here. --------
  // -------- Post-paywall: Jordan appears for the first time at SFO. --------
  {
    id: 4,
    title: "Pickup",
    background: SF_BACKGROUND,
    dialogue: [
      {
        speaker: JORDAN,
        text: "Jordan. Three years older on paper, ten in the head.",
      },
      {
        speaker: JORDAN,
        text: "I'm here because nobody else was going to drive at this hour.",
      },
      {
        speaker: JORDAN,
        text: "Bag in the back. The bridge takes thirty minutes.",
      },
      {
        speaker: JORDAN,
        text: "I have three questions, and you owe me honest answers.",
      },
    ],
    questions: [
      {
        prompt: {
          speaker: JORDAN,
          text: "Who's in this with you, if anyone?",
        },
        placeholder: "Solo. Cofounder. The intern your aunt found.",
        extractAs: "team",
      },
      {
        prompt: {
          speaker: JORDAN,
          text: "Who's paying for the next 90 days?",
        },
        placeholder: "Bootstrap, raise, parents, in denial…",
        extractAs: "fundingModel",
      },
      {
        prompt: {
          speaker: JORDAN,
          text: "What's the thing you don't say to investors?",
        },
        placeholder: "What you'd never tweet.",
        extractAs: "concern",
      },
    ],
  },
];
