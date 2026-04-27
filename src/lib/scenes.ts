// Hardcoded onboarding-as-narrative scenes. Pre-paywall (1–3) is a FaceTime
// from a friend already in SF. Post-paywall (4–5) is the cofounder waiting
// when you land. Single source of truth for both the page renderer and the
// dev panel transcript viewer.

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
  | "stage";

export interface TextInputConfig {
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
        text: "Real talk. Five years from now — the version where you didn't come.",
      },
      {
        speaker: "Jordan · Friend, SF",
        text: "Where are they? What are they doing on a Tuesday night?",
      },
      {
        speaker: "Jordan · Friend, SF",
        text: "Tell me, then open the airline app. I'll wait.",
      },
    ],
    textInput: {
      placeholder: "The version of you that didn't come…",
      extractAs: "selfDescription",
    },
  },
  // -------- Paywall fires here: boarding pass to SFO --------
  // -------- Post-paywall: arrived in SF, the co-founder is waiting --------
  {
    id: 4,
    title: "Scene 4 · Baggage Claim",
    background: SF_BACKGROUND,
    dialogue: [
      { text: "The carousel stops. Yours wasn't on it." },
      {
        speaker: "Maya · Co-founder",
        text: "sorry got held up at the place. just take an uber. key's under the mat",
      },
      { text: "No apology. No call. The phone goes dark in your hand." },
    ],
    choices: [
      {
        id: "a",
        label: "Let it slide. They're stressed.",
        hype: 0,
        integrity: 1,
      },
      {
        id: "b",
        label: "Send something sharp.",
        hype: 1,
        integrity: -1,
      },
      {
        id: "c",
        label: "Call. Talk like adults.",
        hype: 0,
        integrity: 0,
      },
    ],
  },
  {
    id: 5,
    title: "Scene 5 · The Spreadsheet",
    background: HOME_BACKGROUND,
    dialogue: [
      {
        speaker: "Maya · Co-founder",
        text: "Sit down. Open this.",
      },
      {
        speaker: "Maya · Co-founder",
        text: "We don't do the pitch-deck version anymore. Where are we, actually?",
      },
      {
        speaker: "Maya · Co-founder",
        text: "Stage. Runway. What's broken. Be honest.",
      },
    ],
    textInput: {
      placeholder: "Stage, runway, what's broken…",
      extractAs: "stage",
    },
  },
];
