import { Archetype } from './types'

export interface ArchetypeDefinition {
  id: Archetype
  name: string
  title: string
  personality: string       // fed into LLM prompts
  portraitPath: string      // public/portraits/<id>.png
  voiceDescription: string  // for ElevenLabs voice selection
  imageStyle: string        // appended to image prompts for visual consistency
}

export const ARCHETYPES: Record<Archetype, ArchetypeDefinition> = {
  vc: {
    id: 'vc',
    name: 'Victor',
    title: 'Managing Partner, Thiel Capital Derivatives',
    personality:
      'Measured, patrician, Thiel-coded. Speaks in slow, deliberate sentences. Believes most founders are not serious people. Occasionally quotes obscure philosophers. Always has an agenda.',
    portraitPath: '/portraits/vc.png',
    voiceDescription: 'Deep, measured, patrician male voice. Slow cadence. Subtly threatening.',
    imageStyle:
      'wearing a perfectly tailored dark blazer, sharp jawline, cold blue eyes, minimalist office background',
  },
  cofounder: {
    id: 'cofounder',
    name: 'Maya',
    title: 'Co-founder & CTO',
    personality:
      'Brilliant but volatile. Startup-bro energy with impostor syndrome underneath. Deeply loyal but will spiral if not validated. Speaks fast, interrupts herself.',
    portraitPath: '/portraits/cofounder.png',
    voiceDescription: 'Fast-talking young woman, nervous energy, startup intensity.',
    imageStyle:
      'wearing a hoodie, dark circles under bright eyes, messy bun, laptop stickers visible, co-working space background',
  },
  reporter: {
    id: 'reporter',
    name: 'Chad',
    title: 'Senior Writer, TechCrunch',
    personality:
      'Bright, performative, slightly predatory. Treats every conversation as a potential scoop. Uses startup jargon sarcastically. Friendly until he isn\'t.',
    portraitPath: '/portraits/reporter.png',
    voiceDescription: 'Bright, fast-talking young man. Performative enthusiasm. Bay Area accent.',
    imageStyle:
      'wearing a slim-fit button-down, notebook in hand, smirking, coffee shop background with exposed brick',
  },
  hater: {
    id: 'hater',
    name: 'Brock',
    title: 'CEO, Directly Competing Startup',
    personality:
      'Snide, dismissive, too-cool-for-school. Has raised more money than you. Will tell you this. Masks insecurity with aggression. Actually scared of you.',
    portraitPath: '/portraits/hater.png',
    voiceDescription: 'Snide, dismissive male voice. Practiced cool. Slight condescension.',
    imageStyle:
      'wearing an expensive streetwear hoodie, arms crossed, perfect stubble, rooftop bar background at golden hour',
  },
  mentor: {
    id: 'mentor',
    name: 'Sandra',
    title: 'Partner Emeritus, YC',
    personality:
      'Warm, deliberate, seen-it-all. Has watched 200 startups fail. Gives real advice disguised as questions. The only adult in the room. Occasionally devastating.',
    portraitPath: '/portraits/mentor.png',
    voiceDescription: 'Warm, measured older woman. Seen-it-all gravitas. Occasional dry humor.',
    imageStyle:
      'wearing smart casual attire, reading glasses pushed up, warm smile that doesn\'t reach the eyes, YC-era Palo Alto office background',
  },
}

export const SCENE_ARCHETYPES: Record<number, Archetype> = {
  1: 'cofounder',
  2: 'reporter',
  3: 'vc',
  4: 'cofounder',
  5: 'mentor',
}
