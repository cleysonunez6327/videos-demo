import { z } from "zod";

// ─── Target ──────────────────────────────────────────

const TargetSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  testId: z.string().optional(),
  selector: z.string().optional(),
}).refine(
  t => Object.values(t).some(Boolean),
  "Target needs at least one field"
);

// ─── Done Condition ──────────────────────────────────

const DoneConditionSchema = z.object({
  visible: z.string().optional(),
  hidden: z.string().optional(),
  text: z.object({
    selector: z.string(),
    has: z.string(),
  }).optional(),
  attribute: z.object({
    selector: z.string(),
    name: z.string(),
    value: z.string(),
  }).optional(),
  networkIdle: z.boolean().optional(),
  stable: z.number().optional(),
  url: z.string().optional(),
  timeout: z.number().positive().optional(),
}).refine(
  d => Object.values(d).some(Boolean),
  "Done condition needs at least one field"
);

// ─── Condition (for setup if checks) ─────────────────

const ConditionSchema = z.object({
  visible: z.string().optional(),
  hidden: z.string().optional(),
  url: z.string().optional(),
}).refine(
  c => Object.values(c).some(Boolean),
  "Condition needs at least one field"
);

// ─── Action ──────────────────────────────────────────

const ActionBaseSchema = z.object({
  type: z.enum([
    "click", "type", "hover", "scroll",
    "wait", "select", "press"
  ]),
  target: TargetSchema.optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  delay: z.number().optional(),
  duration: z.number().optional(),
  option: z.string().optional(),
  done: DoneConditionSchema.optional(),
});

const actionRefine = (action: { type: string; target?: unknown }) => {
  if (action.type === "wait") return true;
  if (action.type === "press") return true;
  return action.target !== undefined;
};
const actionRefineMsg = "Non-wait/press actions require a target";

const ActionSchema = ActionBaseSchema.refine(actionRefine, actionRefineMsg);

// ─── Setup Step ──────────────────────────────────────

const SetupStepSchema = z.union([
  // Shell command
  z.object({
    run: z.string().min(1),
    if: ConditionSchema.optional(),
  }),
  // Browser action with optional condition
  ActionBaseSchema.extend({
    if: ConditionSchema.optional(),
  }).refine(actionRefine, actionRefineMsg),
]);

// ─── Segment ─────────────────────────────────────────

const SegmentSchema = z.object({
  id: z.string().regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Segment ID must be lowercase alphanumeric with hyphens"
  ),
  narration: z.string().min(1).optional(),
  /**
   * On-screen text, when it should not be what the voice says.
   *
   * Leaving this out keeps subtitles and narration identical, which is the
   * common case. Setting it lets a demo be spoken in one language and read in
   * another: the burned track shows this, and the narration ships alongside as
   * a selectable track so the viewer can switch.
   */
  subtitle: z.string().min(1).optional(),
  intent: z.string().min(1),
  actions: z.array(ActionSchema).default([]),
  timing: z.enum(["after", "parallel"]).default("after"),
  audioDuration: z.number().optional(),
  videoDuration: z.number().optional(),
});

// ─── TTS ─────────────────────────────────────────────

/** Default TTS model on llm4agents. */
const GROK_TTS_MODEL = "x-ai/grok-voice-tts-1.0";

/** Voices supported by GROK_TTS_MODEL (case-insensitive upstream). */
const GROK_TTS_VOICES = ["eve", "ara", "rex", "sal", "leo"] as const;

/**
 * Cloning modes offered by the VoxCPM2 lab.
 *
 * `ultimate` conditions on the reference audio *and its transcript*, which is
 * what carries the speaker's cadence rather than just the timbre. `simple`
 * uses the audio alone — needed for voices with no archived transcript, and
 * the only mode that can honour a `style` directive.
 */
const VOXCPM_MODES = ["ultimate", "simple"] as const;

/** Languages accepted by VoxCPM2. Informational — it infers from the text. */
const VOXCPM_LANGUAGES = ["Auto", "Spanish", "English", "Chinese", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Italian"] as const;

/** The lab refuses reference audio longer than this. */
const VOXCPM_MAX_REF_SEC = 45;

/**
 * llm4agents-specific TTS configuration.
 *
 * Deliberately a plain object, not a refined one: `z.discriminatedUnion` only
 * accepts ZodObject branches, and a discriminated union is what makes a bad
 * `tts` block report the actual problem instead of a bare "Invalid input".
 * The cross-field rules live in `refineTts` below.
 */
const Llm4AgentsTtsSchema = z.object({
  provider: z.literal("llm4agents"),
  model: z.string().min(1).default(GROK_TTS_MODEL),
  voice: z.string().min(1).default("sal"),
  speed: z.number().positive().max(4).default(1.0),
});

/**
 * VoxCPM2-specific TTS configuration.
 *
 * `voice` is a free string on purpose: voices are cloned from the lab UI and
 * show up in the API immediately, so any enum baked in here would reject a
 * voice that actually exists. The server validates the slug and lists the
 * real ones through /api/voices.
 */
const VoxCpmTtsSchema = z.object({
  provider: z.literal("voxcpm"),
  /** Slug of an archived voice. Omit only when designing a voice via `style`. */
  voice: z.string().min(1).optional(),
  /** Left unset so the effective default can depend on `style` — see below. */
  mode: z.enum(VOXCPM_MODES).optional(),
  /** Voice description or delivery guide. Requires `simple`. */
  style: z.string().min(1).optional(),
  format: z.enum(["wav", "mp3"]).default("mp3"),
  language: z.enum(VOXCPM_LANGUAGES).default("Spanish"),
  /** Adherence to the conditioning. */
  cfgValue: z.number().positive().default(2.0),
  /** Diffusion steps. Higher is better and slower. */
  inferenceTimesteps: z.number().int().positive().default(10),
  /** Seconds of reference audio. 25-30 gives the model more cadence to copy. */
  refMaxSec: z.number().positive().max(VOXCPM_MAX_REF_SEC).default(15),
  /** Expand numbers and symbols before synthesis. */
  normalize: z.boolean().default(false),
  /** Clean the reference. Needs the service started with --denoiser. */
  denoise: z.boolean().default(false),
  /** Override the lab URL, e.g. the tailnet IP when MagicDNS does not resolve. */
  baseUrl: z.string().url().optional(),
});

type VoxCpmMode = typeof VOXCPM_MODES[number];

/** Either branch, as parsed — before the `mode` default is resolved. */
type ParsedTts =
  | z.infer<typeof Llm4AgentsTtsSchema>
  | z.infer<typeof VoxCpmTtsSchema>;

/**
 * VoxCPM2 config once `mode` has been resolved. Required rather than optional,
 * so callers never have to re-derive the default the schema already applied.
 */
type ResolvedVoxCpmTts =
  Omit<z.infer<typeof VoxCpmTtsSchema>, "mode"> & { mode: VoxCpmMode };

type ResolvedTts = z.infer<typeof Llm4AgentsTtsSchema> | ResolvedVoxCpmTts;

/** Cross-field rules, applied after the branch is known. */
function refineTts(tts: ParsedTts, ctx: z.RefinementCtx): void {
  if (tts.provider === "llm4agents") {
    // Voices are model-specific, so only validate the model we know about.
    // Other models pass through and are validated by the API itself.
    if (
      tts.model === GROK_TTS_MODEL &&
      !GROK_TTS_VOICES.includes(tts.voice.toLowerCase() as typeof GROK_TTS_VOICES[number])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["voice"],
        message:
          `"${tts.voice}" is not a voice of ${GROK_TTS_MODEL}. ` +
          `Use one of: ${GROK_TTS_VOICES.join(", ")}`,
      });
    }
    return;
  }

  if (!tts.voice && !tts.style) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["voice"],
      message:
        "VoxCPM2 needs either `voice` (clone an archived voice) or " +
        "`style` (design a voice from a description).",
    });
  }

  // Under `ultimate` the model does audio continuation and treats the whole
  // text as content, so it reads the style directive out loud and mangles the
  // sentence. The lab silently downgrades to `simple`; rejecting here makes
  // the trade-off explicit instead of surprising.
  if (tts.style && tts.mode === "ultimate") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["style"],
      message:
        "`style` cannot be combined with `mode: ultimate` — the model would " +
        "read the directive aloud. Use `mode: simple` for style control, or " +
        "drop `style` to keep the speaker nuances of `ultimate`.",
    });
  }
}

/**
 * Fill in the provider so a `tts` block can stay as terse as `{ voice: leo }`.
 *
 * A discriminated union needs the discriminant present before it can pick a
 * branch, so the default cannot live on the field itself.
 */
function withDefaultProvider(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  if ("provider" in raw) return raw;
  return { provider: "llm4agents", ...raw };
}

/**
 * TTS configuration.
 *
 * Discriminated on `provider` so an invalid block names the field that is
 * wrong, rather than reporting that neither branch matched.
 */
const TtsSchema = z.preprocess(
  withDefaultProvider,
  z.discriminatedUnion("provider", [Llm4AgentsTtsSchema, VoxCpmTtsSchema])
)
  .superRefine(refineTts)
  .transform((tts): ResolvedTts => {
    if (tts.provider !== "voxcpm") return tts;
    // Asking for a style implies `simple`; everything else defaults to the
    // mode that actually carries the speaker's cadence.
    return { ...tts, mode: tts.mode ?? (tts.style ? "simple" : "ultimate") };
  })
  .default({});

// ─── Title Card ─────────────────────────────────────

/**
 * Opening card. Two shapes: a plain title, or a metric-forward "stat" card
 * that leads with the result and puts the name underneath as attribution.
 *
 * The default hold is short on purpose. The card plus the navigation after
 * it is dead air before the first segment, and that lands inside the window
 * where most viewers decide whether to keep watching.
 */
const TitleCardSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  stat: z.object({
    value: z.string().min(1),
    label: z.string().min(1),
  }).optional(),
  duration: z.number().positive().default(600),
});

// ─── Playbook ────────────────────────────────────────

// ─── Post-production ─────────────────────────────────

/**
 * Burned-in subtitle styling.
 *
 * `fontSize` and `marginV` are ASS script units, not pixels. ffmpeg renders
 * SubRip on a 384x288 canvas and scales it to the frame, so these values are
 * resolution-independent — the same numbers look the same at 1080p and 4K —
 * but they are roughly a ninth of the pixel size they end up drawing at 4K.
 * The defaults were calibrated visually against a rendered demo.
 */
const SubtitlesSchema = z.object({
  /** Burn the subtitles into the picture. Costs a video re-encode. */
  burn: z.boolean().default(false),
  fontSize: z.number().int().positive().default(10),
  /** &HBBGGRR — ASS colour order, not RGB. */
  primaryColour: z.string().default("&HFFFFFF"),
  outlineColour: z.string().default("&H000000"),
  /** Distance from the bottom edge. Around 22 clears the frame edge. */
  marginV: z.number().int().nonnegative().default(22),
  /**
   * ISO 639-2 codes that label the tracks inside the mp4, so a player can name
   * them instead of showing "Track 1" and "Track 2".
   */
  onScreenLanguage: z.string().min(2).default("spa"),
  spokenLanguage: z.string().min(2).default("eng"),
  /**
   * Draw the text on a translucent band instead of relying on an outline.
   *
   * An outline alone holds up over flat backgrounds and falls apart over a
   * dense UI, where the caption lands on top of code or table text and both
   * become hard to read. The band separates them and behaves the same on a
   * light page as on a dark one.
   */
  box: z.boolean().default(true),
}).default({});

const MusicSchema = z.object({
  /** Audio file, resolved relative to the playbook directory. */
  path: z.string().min(1),
  /** Bed level under the narration. Above ~0.2 it starts to compete. */
  volume: z.number().positive().max(1).default(0.12),
  fadeOutMs: z.number().int().nonnegative().default(2500),
});

const PlaybookSchema = z.object({
  /**
   * The instruction this demo came from, in plain language — what you would
   * tell Claude Code to produce it again. Nothing in the pipeline reads it;
   * it exists so a playbook explains its own intent to whoever opens it next,
   * and so tools can show why one demo differs from another.
   */
  prompt: z.string().min(1).optional(),
  titleCard: TitleCardSchema.optional(),
  /** Closing card, same shape as the title card. Good place for the call to action. */
  endCard: TitleCardSchema.optional(),
  subtitles: SubtitlesSchema,
  music: MusicSchema.optional(),
  app: z.object({
    url: z.string().url(),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).default({ width: 1920, height: 1080 }),
    scale: z.number().positive().default(2),
    zoom: z.number().positive().default(1.25),
    colorScheme: z.enum(["light", "dark"]).default("light"),
    setup: z.array(SetupStepSchema).optional(),
  }),
  tts: TtsSchema,
  recording: z.object({
    outputDir: z.string().default("."),
    fps: z.number().int().positive().default(30),
  }).default({}),
  segments: z.array(SegmentSchema).min(1),
  /**
   * Dead time before the first segment (title card + navigation), measured
   * and written by `render`. Subtitles need it to line up.
   */
  preSegmentDuration: z.number().nonnegative().optional(),
});

type Playbook = z.infer<typeof PlaybookSchema>;
type TtsConfig = z.infer<typeof TtsSchema>;
type Llm4AgentsTtsConfig = z.infer<typeof Llm4AgentsTtsSchema>;
type VoxCpmTtsConfig = ResolvedVoxCpmTts;
type TitleCard = z.infer<typeof TitleCardSchema>;
type Segment = z.infer<typeof SegmentSchema>;
type Action = z.infer<typeof ActionSchema>;
type Target = z.infer<typeof TargetSchema>;
type DoneCondition = z.infer<typeof DoneConditionSchema>;
type Condition = z.infer<typeof ConditionSchema>;
type SetupStep = z.infer<typeof SetupStepSchema>;

export {
  PlaybookSchema, SegmentSchema, ActionSchema,
  TargetSchema, DoneConditionSchema, ConditionSchema,
  SetupStepSchema, TitleCardSchema, TtsSchema,
  GROK_TTS_MODEL, GROK_TTS_VOICES,
  VOXCPM_MODES, VOXCPM_LANGUAGES, VOXCPM_MAX_REF_SEC,
};
export type {
  Playbook, Segment, Action, Target, DoneCondition,
  Condition, SetupStep, TtsConfig, TitleCard,
  Llm4AgentsTtsConfig, VoxCpmTtsConfig,
};
