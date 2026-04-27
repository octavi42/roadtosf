// Hardcoded onboarding-as-narrative scenes. Pre-paywall (1–3) is a FaceTime
// from a friend already in SF. Post-paywall (4) is a single Q&A car-ride
// scene with Jordan that captures the structured facts the LLM needs:
// team, funding model, and current concern.

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

export const HOME_BACKGROUND = "/intro-v2/03-airport-bar.png";
export const SF_BACKGROUND = "/intro-v2/05-sfo-arrival.png";

export const SCENES: SceneData[] = [
  // -------- Pre-paywall: home, FaceTime with a friend already in SF --------
  {
    id: 1,
    title: "Scene 1 · The Call",
    background: HOME_BACKGROUND,
    dialogue: [
      {
        speaker: "Jordan · Friend, SF",
        text: "Look at you. One a.m. again. Some things never change.",
      },
      {
        speaker: "Jordan · Friend, SF",
        text: "You said you'd come out by spring. It's spring.",
      },
      {
        speaker: "Jordan · Friend, SF",
        text: "I've watched you almost-do-this for two years. Are you actually doing it, or you gonna ghost me on this one too?",
      },
    ],
    choices: [
      {
        id: "a",
        label: "I'm coming. Done overthinking it.",
        hype: 1,
        integrity: 0,
      },
      {
        id: "b",
        label: "I'm trying to do it right.",
        hype: 0,
        integrity: 1,
      },
      {
        id: "c",
        label: "Easy for you to say. You sold yours.",
        hype: -1,
        integrity: 0,
      },
    ],
  },
  {
    id: 2,
    title: "Scene 2 · The Pitch",
    background: HOME_BACKGROUND,
    dialogue: [
      {
        speaker: "Jordan · Friend, SF",
        text: "Okay. Walk me through it again.",
      },
      {
        speaker: "Jordan · Friend, SF",
        text: "Not the deck pitch. The version you tell yourself in the shower.",
      },
      {
        speaker: "Jordan · Friend, SF",
        text: "What are you actually building?",
      },
    ],
    textInput: {
      placeholder: "Your startup, in your own words…",
      extractAs: "startupDescription",
    },
  },
  {
    id: 3,
    title: "Scene 3 · The Ultimatum",
    background: SF_BACKGROUND,
    dialogue: [
      {
        speaker: "Jordan · Friend, SF",
        text: "Hey. I love you. So I'm gonna say it straight.",
      },
      {
        speaker: "Jordan · Friend, SF",
        text: "Two years you've been not-doing this. Two.",
      },
      {
        speaker: "Jordan · Friend, SF",
        text: "Book the flight tonight. Or stop telling me about it.",
      },
    ],
    ctaLabel: "Book the flight →",
  },
  // -------- Paywall fires here: boarding pass to SFO --------
  // -------- Post-paywall: Jordan picks you up at SFO; the car-ride Q&A --------
  {
    id: 4,
    title: "Scene 4 · The Car Ride",
    background: SF_BACKGROUND,
    dialogue: [
      {
        speaker: "Jordan · Friend, SF",
        text: "Throw your bag in the back. We're driving over the bridge.",
      },
      {
        speaker: "Jordan · Friend, SF",
        text: "Honest answers, no pitch deck. I'm getting you up to speed before anyone else asks.",
      },
    ],
    questions: [
      {
        prompt: {
          speaker: "Jordan · Friend, SF",
          text: "Who's with you on this? Cofounder, team, or solo?",
        },
        placeholder:
          "e.g. solo, or 'my cofounder Anna, ex-Stripe engineer'…",
        extractAs: "team",
      },
      {
        prompt: {
          speaker: "Jordan · Friend, SF",
          text: "Money. Raising, bootstrapping, paying yourself? How much runway?",
        },
        placeholder: "e.g. pre-seed, 4 months runway, no revenue yet…",
        extractAs: "fundingModel",
      },
      {
        prompt: {
          speaker: "Jordan · Friend, SF",
          text: "Last one. What's actually broken right now?",
        },
        placeholder: "What keeps you up at night?",
        extractAs: "concern",
      },
    ],
  },
];
