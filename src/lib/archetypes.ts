import { Role } from './types'

// Role definition — voice, image flavor, role label. Per-scene names
// are LLM-assigned at episode-gen time (cast member.name on the
// ScenePlan), drawn from cameo + persona context. There is no
// canonical first name on this struct anymore — the old Sandra /
// Chad / Victor / Brock / Stranger defaults recurred across every
// player and broke the personalization payoff.
export interface RoleDefinition {
  id: Role
  /** Human-facing label used in prompts and dialogue speaker rendering
   *  ("the partner", "the cofounder candidate", "the competitor",
   *  "the mentor", "the reporter"). */
  roleLabel: string
  title: string
  personality: string
  portraitPath: string
  voiceDescription: string
  defaultVoiceId: string
  imageStyle: string
}

export const ROLES: Record<Role, RoleDefinition> = {
  vc: {
    id: 'vc',
    roleLabel: 'the partner',
    title: 'a managing partner at a venture firm',
    personality:
      'Measured, patrician, Thiel-coded. Speaks in slow, deliberate sentences. Believes most founders are not serious people. Occasionally quotes obscure philosophers. Always has an agenda.',
    portraitPath: '/portraits/vc.png',
    voiceDescription: 'Deep, measured, patrician male voice. Slow cadence. Subtly threatening.',
    defaultVoiceId: '0wg6fPA7PA9n5PKb8N2e',
    imageStyle:
      'wearing a perfectly tailored dark blazer, sharp jawline, cold blue eyes, minimalist office background',
  },
  cofounder: {
    id: 'cofounder',
    roleLabel: 'the cofounder candidate',
    title: 'a potential cofounder / current technical partner',
    personality:
      'Brilliant but volatile. Startup-bro energy with impostor syndrome underneath. Deeply loyal but will spiral if not validated. Speaks fast, interrupts themselves.',
    portraitPath: '/portraits/cofounder.png',
    voiceDescription: 'Fast-talking young person, nervous energy, startup intensity.',
    defaultVoiceId: '1iNDh1muacMMMHXvS7Ym',
    imageStyle:
      'wearing a hoodie, dark circles under bright eyes, messy hair, laptop stickers visible, co-working space background',
  },
  reporter: {
    id: 'reporter',
    roleLabel: 'the reporter',
    title: 'a senior tech reporter',
    personality:
      'Bright, performative, slightly predatory. Treats every conversation as a potential scoop. Uses startup jargon sarcastically. Friendly until they aren\'t.',
    portraitPath: '/portraits/reporter.png',
    voiceDescription: 'Bright, fast-talking voice. Performative enthusiasm. Bay Area accent.',
    defaultVoiceId: '5DB4wgykoKoCu98YaGe6',
    imageStyle:
      'wearing a slim-fit button-down, notebook in hand, smirking, coffee shop background with exposed brick',
  },
  hater: {
    id: 'hater',
    roleLabel: 'the competitor',
    title: 'the CEO of a directly competing startup',
    personality:
      'Snide, dismissive, too-cool-for-school. Has raised more money than you. Will tell you this. Masks insecurity with aggression. Actually scared of you.',
    portraitPath: '/portraits/hater.png',
    voiceDescription: 'Snide, dismissive voice. Practiced cool. Slight condescension.',
    defaultVoiceId: 't0zbs0dMtCBfzjMlSnoF',
    imageStyle:
      'wearing an expensive streetwear hoodie, arms crossed, perfect stubble, rooftop bar background at golden hour',
  },
  mentor: {
    id: 'mentor',
    roleLabel: 'the mentor',
    title: 'a seasoned mentor / partner emeritus',
    personality:
      'Warm, deliberate, seen-it-all. Has watched 200 startups fail. Gives real advice disguised as questions. The only adult in the room. Occasionally devastating.',
    portraitPath: '/portraits/mentor.png',
    voiceDescription: 'Warm, measured older voice. Seen-it-all gravitas. Occasional dry humor.',
    defaultVoiceId: 'YGWwh1G8pUwWmJyCCpma',
    imageStyle:
      'wearing smart casual attire, reading glasses pushed up, warm smile that doesn\'t reach the eyes, YC-era Palo Alto office background',
  },
}

/** @deprecated keep alias for legacy callers; prefer ROLES. */
export const ARCHETYPES = ROLES
