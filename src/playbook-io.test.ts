import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPlaybook, saveSegmentDurations } from "./playbook-io.js";
import { first } from "./test-helpers.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndemo-io-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writePlaybook(contents: string): string {
  const filePath = path.join(dir, "demo.yaml");
  fs.writeFileSync(filePath, contents);
  return filePath;
}

const MINIMAL = `app:
  url: http://localhost:3000/
segments:
  - id: intro
    narration: "Hola"
    intent: "mostrar"
    actions:
      - type: wait
        duration: 1000
`;

describe("loadPlaybook", () => {
  test("applies defaults", () => {
    const playbook = loadPlaybook(writePlaybook(MINIMAL));
    assert.equal(playbook.tts.voice, "sal");
    assert.equal(playbook.tts.model, "x-ai/grok-voice-tts-1.0");
    assert.equal(playbook.app.viewport.width, 1920);
    assert.equal(playbook.recording.fps, 30);
  });

  test("reports the offending field on invalid input", () => {
    const filePath = writePlaybook(`app:\n  url: not-a-url\nsegments: []\n`);
    assert.throws(() => loadPlaybook(filePath), /app\.url/);
  });

  test("throws a clear error when the file is missing", () => {
    assert.throws(
      () => loadPlaybook(path.join(dir, "nope.yaml")),
      /Playbook not found/
    );
  });
});

describe("saveSegmentDurations", () => {
  test("writes both durations onto the matching segment", () => {
    const filePath = writePlaybook(MINIMAL);
    saveSegmentDurations(filePath, [
      { id: "intro", audioDuration: 6360, videoDuration: 7864 },
    ]);

    const segment = first(loadPlaybook(filePath).segments, "segment");
    assert.equal(segment.audioDuration, 6360);
    assert.equal(segment.videoDuration, 7864);
  });

  test("preserves comments — the whole point of not reserializing", () => {
    const filePath = writePlaybook(`# encabezado que debe sobrevivir
app:
  url: http://localhost:3000/
segments:
  # por qué este selector es así
  - id: intro
    narration: "Hola"
    intent: "mostrar"
    actions:
      - type: wait
        duration: 1000
`);
    saveSegmentDurations(filePath, [{ id: "intro", audioDuration: 100 }]);

    const after = fs.readFileSync(filePath, "utf-8");
    assert.match(after, /# encabezado que debe sobrevivir/);
    assert.match(after, /# por qué este selector es así/);
  });

  test("leaves untouched segments byte-identical", () => {
    const filePath = writePlaybook(`app:
  url: http://localhost:3000/
segments:
  - id: intro
    narration: "Hola"
    intent: "mostrar"
    actions:
      - type: click
        target: { selector: 'nav a[href="#x"]:not(.block)' }
  - id: otro
    narration: "Chau"
    intent: "cerrar"
    actions:
      - type: wait
        duration: 1000
`);
    const before = fs.readFileSync(filePath, "utf-8");
    saveSegmentDurations(filePath, [{ id: "intro", audioDuration: 100 }]);
    const after = fs.readFileSync(filePath, "utf-8");

    // The flow-style target and its single quotes must come through intact.
    assert.match(after, /target: \{ selector: 'nav a\[href="#x"\]:not\(\.block\)' \}/);
    // Only one line added, nothing removed.
    assert.equal(after.split("\n").length, before.split("\n").length + 1);
  });

  test("updates an existing duration instead of duplicating it", () => {
    const filePath = writePlaybook(`app:
  url: http://localhost:3000/
segments:
  - id: intro
    narration: "Hola"
    intent: "mostrar"
    actions:
      - type: wait
        duration: 1000
    audioDuration: 999
`);
    saveSegmentDurations(filePath, [{ id: "intro", audioDuration: 4242 }]);

    const after = fs.readFileSync(filePath, "utf-8");
    assert.equal((after.match(/audioDuration:/g) ?? []).length, 1);
    assert.equal(first(loadPlaybook(filePath).segments, "segment").audioDuration, 4242);
  });

  test("ignores ids that are not in the file", () => {
    const filePath = writePlaybook(MINIMAL);
    saveSegmentDurations(filePath, [{ id: "fantasma", audioDuration: 1 }]);
    assert.equal(first(loadPlaybook(filePath).segments, "segment").audioDuration, undefined);
  });

  test("skips undefined durations rather than writing null", () => {
    const filePath = writePlaybook(MINIMAL);
    saveSegmentDurations(filePath, [{ id: "intro", audioDuration: 500 }]);

    const after = fs.readFileSync(filePath, "utf-8");
    assert.match(after, /audioDuration: 500/);
    assert.doesNotMatch(after, /videoDuration/);
  });

  test("stores the pre-segment lead-in at the top level", () => {
    const filePath = writePlaybook(MINIMAL);
    saveSegmentDurations(filePath, [{ id: "intro", videoDuration: 100 }], 3742);

    assert.equal(loadPlaybook(filePath).preSegmentDuration, 3742);
  });

  test("leaves the lead-in alone when it is not supplied", () => {
    const filePath = writePlaybook(MINIMAL);
    saveSegmentDurations(filePath, [{ id: "intro", videoDuration: 100 }]);

    assert.doesNotMatch(fs.readFileSync(filePath, "utf-8"), /preSegmentDuration/);
  });

  test("refuses to write to a malformed file", () => {
    const filePath = writePlaybook("segments: [oops\n");
    assert.throws(
      () => saveSegmentDurations(filePath, [{ id: "intro", audioDuration: 1 }]),
      /Cannot update/
    );
  });
});
