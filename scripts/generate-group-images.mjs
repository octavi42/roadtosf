import OpenAI, { toFile } from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STYLE_REF = path.join(ROOT, "references", "style-ref.png");

const QUALITY = process.env.QUALITY ?? "medium";
const SIZE = process.env.SIZE ?? "1536x1024";
const OUT_DIR = path.join(ROOT, "public", "groups");

const NO_CHARACTER_DIRECTIVE =
  "STRICT — do NOT add any central foreground character with a visible face. Any human presence is limited to anonymous silhouettes seen from behind or at a distance. The subject of this frame is the city and the mood, not a person.";

const SHOTS = [
  {
    id: "01-exploring-sf",
    title:
      "the player's first afternoon in San Francisco — alone on a Mission District sidewalk, just dropped off, taking the city in",
    imageStyle:
      "A wide cinematic shot of a Mission District street at golden hour. Victorian rowhouses on the left in flat painted color shapes, telephone poles and tangled overhead wires drawn as clean inked lines, a Caltrain or BART train barely visible in the deep distance behind a chain-link fence. Posters and stylized graffiti on a brick wall in the midground. A single anonymous founder-shaped silhouette with a backpack walking away from camera, drawn small, occupying maybe one tenth of the frame, just left of center. Palm trees frame the right side as graphic stylized shapes. A sliver of bay and bay bridge cables visible at the back of the frame.",
    composition:
      "Wide horizontal cinematic frame, sidewalk leading the eye toward the deep midground, founder silhouette small enough that the city is the subject. Hard one-point perspective.",
    lighting:
      "Strong golden-hour palette — warm orange-amber wash from the right, long cool blue-purple shadows pulling left. Rendered as flat color zones with hard-edged cel shadows. No gradients, no glow, no lens flare.",
    textRule:
      "Allow at most ONE small stylized graffiti tag or poster word on the brick wall. All other text is drawn as abstract squiggles only.",
  },
  {
    id: "02-clipboard-stranger",
    title:
      "the player's first sidewalk encounter — a clipboard-toting hustler has appeared on the corner, ninety seconds after being dropped off",
    imageStyle:
      "A tight street-corner composition in the Mission, mid-afternoon. A SoMa-style brick storefront on the left with a pinned-up flyer wall, a hand-painted bodega awning across the street in the deep midground, scuffed asphalt and a bent parking sign in the foreground. Two anonymous figures in mid-conversation at the corner — both seen from the back / over-shoulder, one holding a clipboard, the other carrying a backpack — drawn as flat silhouettes occupying maybe a fifth of the frame, off-center to the right. A dirty white work van and a Lyft sticker on a parked sedan visible behind them. Crumpled newspaper and a pair of city pigeons in the gutter for satirical detail.",
    composition:
      "Slight low angle from the curb, street vanishing diagonally to the right, the two figures positioned at the intersection of thirds so the city street still dominates the frame.",
    lighting:
      "Late-afternoon overcast SF haze — cool desaturated grey-blue base, with one warm shaft of sun cutting between buildings to land on the brick wall. Flat color zones, hard-edged cel shadows, no gradients.",
    textRule:
      "Allow at most ONE legible word on the brick flyer wall (e.g. 'HIRING' or 'FOUNDERS'). All other text — flyers, signage, sticker — drawn as abstract squiggles only.",
  },
  {
    id: "03-recognized-founder",
    title:
      "the player spots a Twitter-famous founder a half-block ahead on the sidewalk, taking a phone call too loudly — recognition without contact",
    imageStyle:
      "A long-lens telephoto-feel sidewalk composition pushing down a Hayes Valley block. In the deep midground a single anonymous figure in an Allbirds-and-soft-hoodie silhouette stands at the curb with a phone pressed to his ear, head tilted, drawn small and clearly the focal point but with no face visible (turned three-quarters away). A sliver of a Tesla parked behind him. Closer to camera, the back of the player's shoulder and a corner of a backpack strap intrude on the bottom-right of the frame as foreground bokeh shape. Boutique storefronts line the right side — flat-painted facades with awnings, a planter box, a leashed dog tied outside one shop. Power lines criss-crossing the sky.",
    composition:
      "Compressed telephoto perspective, sidewalk receding into a stack of overlapping color shapes, the famous founder placed dead-center but small enough that the architecture overwhelms him. Foreground player-shoulder shape on the bottom-right adds POV.",
    lighting:
      "Mid-afternoon high-contrast SF light — a sharp diagonal of sun across the upper-left buildings, a cool blue-grey shadow falling over the sidewalk where the founder stands. Flat color, hard-edged cel shadows, no glow.",
    textRule:
      "Allow at most ONE legible word on a small storefront sign (e.g. 'COFFEE' or 'TARTINE'). All other shop signs drawn as abstract squiggles only.",
  },
  {
    id: "04-cafe-interview",
    title:
      "the player sits at a window seat in a SF third-wave cafe — the next table over is two laptops, two espressos, and a founder being interviewed by a journalist",
    imageStyle:
      "A cafe interior shot from a corner window seat. Foreground left: the back of an open laptop and a half-drunk pour-over on a reclaimed-wood table — the player's own table, anchoring the POV. Across a narrow aisle, the next table is the focal subject — two anonymous figures hunched over MacBooks across from each other, one gesturing big with both hands ('the thing with their hands'), the other in horn-rimmed glasses leaning forward with a phone recording between them. Both drawn from a three-quarter angle, faces turned away or partially obscured. Espresso cups, an open notebook, a Stripe sticker on one laptop lid. Through the window behind them, a stylized Mission Street scene — a bus stop, a passing cyclist, a stretch of overhead wires — flattened into background color shapes.",
    composition:
      "Eye-level interior frame, foreground laptop occupying lower-left third, the interview table dominant in the center, window light behind it. Strong horizontal layering — table, table, window, street.",
    lighting:
      "Warm interior tungsten on the foreground tables, contrasted against cooler daylight bleeding through the window. Cel-shaded — flat warm browns and amber on the wood, cool blue-grey wash through the glass. No gradients, no haze, no lens blur.",
    textRule:
      "Allow at most ONE legible word on a chalkboard menu in the deep background (e.g. 'POUR OVER'). Stickers, notebook pages, and street signs all drawn as abstract squiggles only.",
  },
  {
    id: "05-phone-lights-up",
    title:
      "the player walks alone and the phone in their hand lights up with three messages and a Hacker News link — a competitor just shipped",
    imageStyle:
      "A close-up over-the-shoulder POV of the player's own hand holding an iPhone mid-stride on an SF sidewalk. The phone screen is the visual anchor — clearly readable as a phone but with text rendered as stylized abstract squiggle-lines, three notification banners stacked at the top, an orange Hacker News-style logo recognizable in one banner. The screen glow casts a sharp cool light onto the player's thumb and the inside of their jacket sleeve. Behind the phone, the sidewalk extends away — slightly out-of-focus painted shapes of pavement, a fire hydrant, a tilted parked Vespa, a corner storefront. A second pedestrian's silhouette walking the opposite direction in the deep midground.",
    composition:
      "Tight foreground subject — the phone fills the lower-right quadrant — with the SF street stretching to a vanishing point in the upper-left. Shallow staging through scale, not blur. The hand and phone are the only sharply detailed element.",
    lighting:
      "Late-afternoon cool overcast on the street, contrasted by the bright cold blue-white glow of the phone screen up-lighting the hand. Flat-shaded cel style — clear hard light edge on the phone, soft cool ambient everywhere else. No bloom, no lens flare.",
    textRule:
      "Phone screen text is abstract squiggle lines only — no readable copy. Allow at most ONE legible word on a distant storefront sign (e.g. 'BAR'). All other signage as squiggles.",
  },
];

function buildPrompt(shot) {
  const { title, imageStyle, composition, lighting, textRule } = shot;
  return [
    `Hand-drawn establishing frame from a satirical adult-animation TV show: ${title}.`,
    imageStyle,
    `Composition: ${composition}.`,
    `Lighting: ${lighting}.`,
    textRule,
    NO_CHARACTER_DIRECTIVE,
    "OVERALL STYLE — match the reference frame exactly. Thick hand-inked outlines on EVERYTHING (buildings, vehicles, props, posters, fences). Flat cel-shaded color fills with simple hard-edged shadow shapes. Slight natural variation in line weight that reads as drawn-by-hand. NO photorealism. NO 3D rendering. NO lens blur, depth of field, bokeh, motion blur, or lens flare. NO smooth digital gradients. NO glow or bloom. NO polished Disney/Pixar look. NO soft indie animation feel. NO editorial illustration look. Target is satirical adult-animation TV — chunky, irreverent, atmospheric.",
    "No subtitles, no UI overlays, no watermarks.",
  ].join(" ");
}

async function loadRefs() {
  return [
    await toFile(fs.createReadStream(STYLE_REF), "style-ref.png", {
      type: "image/png",
    }),
  ];
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing. Run with: npm run generate:group-images");
  }
  if (!fs.existsSync(STYLE_REF)) {
    throw new Error(
      `style-ref.png not found at ${STYLE_REF}. Run npm run distill:style first.`,
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log(`[groups] quality=${QUALITY} size=${SIZE} out=${OUT_DIR}`);

  const runOne = async (shot) => {
    const outPath = path.join(OUT_DIR, `${shot.id}.png`);
    const refs = await loadRefs();
    const t0 = Date.now();
    const response = await openai.images.edit({
      model: "gpt-image-2",
      image: refs,
      prompt: buildPrompt(shot),
      size: SIZE,
      quality: QUALITY,
      output_format: "png",
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error(`No image data returned for ${shot.id}`);
    fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    console.log(`[groups] ${shot.id} done in ${dt}s -> ${outPath}`);
  };

  const filter = process.env.SHOT;
  const tokens = filter ? filter.split(",").map((t) => t.trim()).filter(Boolean) : null;
  const targets = tokens ? SHOTS.filter((s) => tokens.some((t) => s.id.includes(t))) : SHOTS;
  if (filter && targets.length === 0) {
    throw new Error(
      `SHOT="${filter}" matched no shots. Available: ${SHOTS.map((s) => s.id).join(", ")}`,
    );
  }

  const results = await Promise.allSettled(targets.map(runOne));
  const failed = results
    .map((r, i) =>
      r.status === "rejected" ? { shot: targets[i].id, reason: r.reason } : null,
    )
    .filter(Boolean);

  if (failed.length > 0) {
    console.error(`[groups] ${failed.length} failed:`);
    failed.forEach((f) => console.error(`  - ${f.shot}: ${f.reason}`));
    process.exit(1);
  }

  console.log(`[groups] all ${targets.length} shots written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("[groups] failed:", err);
  process.exit(1);
});
