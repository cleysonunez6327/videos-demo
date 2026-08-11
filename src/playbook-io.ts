import fs from "node:fs";
import path from "node:path";
import { parse, parseDocument, isMap, isSeq } from "yaml";
import { PlaybookSchema } from "./schema.js";
import type { Playbook } from "./schema.js";

function loadPlaybook(filePath: string): Playbook {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Playbook not found: ${absPath}`);
  }

  const raw = fs.readFileSync(absPath, "utf-8");
  const data = parse(raw);
  const result = PlaybookSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid playbook:\n${issues}`);
  }

  return result.data;
}

interface SegmentDurations {
  readonly id: string;
  readonly audioDuration?: number | undefined;
  readonly videoDuration?: number | undefined;
}

/**
 * Write measured durations back into the playbook, touching nothing else.
 *
 * Editing the parsed document in place is what keeps the file intact:
 * comments, key order, quoting style and blank lines all survive, because
 * every node the render did not measure is left exactly as authored.
 * Reserializing the validated object instead would silently strip every
 * comment in the file on each render.
 */
function saveSegmentDurations(
  filePath: string,
  segments: readonly SegmentDurations[],
  preSegmentDuration?: number
): void {
  const absPath = path.resolve(filePath);
  const doc = parseDocument(fs.readFileSync(absPath, "utf-8"));

  if (doc.errors.length > 0) {
    throw new Error(
      `Cannot update ${absPath}: ${doc.errors[0]?.message ?? "unparseable YAML"}`
    );
  }

  const seq = doc.get("segments");
  if (!isSeq(seq)) {
    throw new Error(`Cannot update ${absPath}: "segments" is not a list`);
  }

  const byId = new Map(segments.map(s => [s.id, s]));

  for (const item of seq.items) {
    if (!isMap(item)) continue;
    const id = item.get("id");
    if (typeof id !== "string") continue;

    const durations = byId.get(id);
    if (!durations) continue;

    if (durations.audioDuration !== undefined) {
      item.set("audioDuration", durations.audioDuration);
    }
    if (durations.videoDuration !== undefined) {
      item.set("videoDuration", durations.videoDuration);
    }
  }

  if (preSegmentDuration !== undefined) {
    doc.set("preSegmentDuration", preSegmentDuration);
  }

  fs.writeFileSync(absPath, doc.toString({ lineWidth: 0 }), "utf-8");
}

export { loadPlaybook, saveSegmentDurations };
export type { SegmentDurations };
