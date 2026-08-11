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

const TtsSchema = z.object({
  provider: z.enum(["llm4agents"]).default("llm4agents"),
  model: z.string().min(1).default(GROK_TTS_MODEL),
  voice: z.string().min(1).default("sal"),
  speed: z.number().positive().max(4).default(1.0),
}).superRefine((tts, ctx) => {
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
});

// ─── Title Card ─────────────────────────────────────

const TitleCardSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  duration: z.number().positive().default(3000),
});

// ─── Playbook ────────────────────────────────────────

const PlaybookSchema = z.object({
  titleCard: TitleCardSchema.optional(),
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
  tts: TtsSchema.default({}),
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
};
export type {
  Playbook, Segment, Action, Target, DoneCondition,
  Condition, SetupStep, TtsConfig,
};
