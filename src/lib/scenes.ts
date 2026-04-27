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
export const GROUP1_BACKGROUND = "/groups/01-exploring-sf.png";

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
  // -------- Group 1: First Steps in SF (4 scenes, one shared image) --------
  // Narrator-led, no archetype yet. The player has just been dropped off
  // and is alone in the city for the first time. All four scenes share
  // GROUP1_BACKGROUND — proves out the "one image per group of scenes"
  // architecture, and gives the most important first impression a zero-
  // latency landing. Choices feed into the LLM tail as recentChoices.
  {
    id: 5,
    title: "Scene 5 · 4th & King",
    background: GROUP1_BACKGROUND,
    dialogue: [
      {
        speaker: "Narrator",
        text: "Jordan's car peels off. The Caltrain rumbles past. You are standing on a sidewalk with a backpack and a startup name.",
      },
      {
        speaker: "Narrator",
        text: "Three streets fork off from this corner. The city is already deciding who you are.",
      },
    ],
    choices: [
      {
        id: "a",
        label: "Walk into the Mission",
        hype: 0,
        integrity: 1,
      },
      {
        id: "b",
        label: "Cut up toward SoMa",
        hype: 1,
        integrity: 0,
      },
      {
        id: "c",
        label: "Drift along the Embarcadero",
        hype: 0,
        integrity: 0,
      },
    ],
  },
  {
    id: 6,
    title: "Scene 6 · The Walk",
    background: GROUP1_BACKGROUND,
    dialogue: [
      {
        speaker: "Narrator",
        text: "The city takes you in like it's done this a thousand times. Posters for AI summits. Founders on phones. A homeless camp three blocks from a Tesla showroom.",
      },
      {
        speaker: "Narrator",
        text: "It hits you somewhere specific.",
      },
    ],
    choices: [
      {
        id: "a",
        label: "The energy. You feel it.",
        hype: 2,
        integrity: 0,
      },
      {
        id: "b",
        label: "The contradictions. Loud.",
        hype: 0,
        integrity: 1,
      },
      {
        id: "c",
        label: "How alone you are here.",
        hype: -1,
        integrity: 1,
      },
    ],
  },
  {
    id: 7,
    title: "Scene 7 · A Place to Land",
    background: GROUP1_BACKGROUND,
    dialogue: [
      {
        speaker: "Narrator",
        text: "Eventually you stop walking. A window seat. A laptop on the table. Steam off a cup you don't remember ordering.",
      },
      {
        speaker: "Narrator",
        text: "You have ten minutes before you need to be a person on purpose.",
      },
    ],
    choices: [
      {
        id: "a",
        label: "Open the deck. Read it cold.",
        hype: 1,
        integrity: 0,
      },
      {
        id: "b",
        label: "Text someone you know here",
        hype: 1,
        integrity: 0,
      },
      {
        id: "c",
        label: "Just look out the window",
        hype: 0,
        integrity: 1,
      },
    ],
  },
  {
    id: 8,
    title: "Scene 8 · The City Notices",
    background: GROUP1_BACKGROUND,
    dialogue: [
      {
        speaker: "Narrator",
        text: "Your phone buzzes. A flyer slides across the table from somewhere. A stranger glances over and doesn't quite look away.",
      },
      {
        speaker: "Narrator",
        text: "The city has already started reading you. The next move is yours.",
      },
    ],
    choices: [
      {
        id: "a",
        label: "Lean in. Whatever's coming, take it.",
        hype: 2,
        integrity: 0,
      },
      {
        id: "b",
        label: "Hold steady. Let it come to you.",
        hype: 0,
        integrity: 1,
      },
      {
        id: "c",
        label: "Pretend you didn't see it.",
        hype: -1,
        integrity: 0,
      },
    ],
  },
];
