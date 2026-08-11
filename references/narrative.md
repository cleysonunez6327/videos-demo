# Narrative structure for demo videos

How to order segments and write narration so a demo holds attention.
Read this before writing a playbook — the structure is decided there, and
restructuring after a render means regenerating every narration.

Adapted from the retention and hook research in
[rediumvex/ai-video-generator-claude](https://github.com/rediumvex/ai-video-generator-claude)
(MIT). That project generates prompts for a generative video model; only
its narrative layer transfers here. Its camera, lighting and sound-design
templates do not apply — ndemo records a real browser, so there is no
camera to orbit and no scene to light. Do not write camera directions
into a playbook.

## The retention clock

| Window | What is happening | What the demo must do |
|---|---|---|
| 0–2s | The gate. Most abandonment happens here. | Something moves and the stakes are stated. |
| 2–5s | Hook confirmation. The viewer decides. | Deliver on what the first two seconds promised. |
| 5–15s | Peak attention. | The main reveal. |
| 15s+ | Attrition. | Each remaining segment must earn its place. |

Two consequences for a playbook:

**The first segment is the hook, not the introduction.** A title card
followed by "X is a tool that lets you…" spends the gate on a definition.
Open on the problem the product solves, or on the product doing the one
thing it is best at.

**Something must move before the 2 second mark.** A static screen while
narration ramps up reads as a dead video. Give the first segment
`timing: parallel` so its action runs while the narration plays, and put
the scroll or click first in the list.

Keep the title card short — around 1200ms. It exists so link previews
have a frame to show, not to be watched.

## Hook patterns that work with a real browser

These are segment structures, not visual effects.

**Problem first.** Scroll straight to whatever part of the page states
the pain, name it in one sentence, then reveal the product as the answer.
Strongest when the page already has a problem/solution section — the
comparison is on screen and the narration only has to point at it.

**One action, large result.** Open on a single click that visibly
transforms the screen: data populates, a panel fills, a result appears.
Works when the product has one high-leverage interaction.

**Speed.** If the product is fast, show the whole operation start to
finish in real time and say how long it took. The demo is the proof.

**Side by side.** If the page has a comparison — old way against new way,
competitor against product — hold on it. It does the persuading.

## Writing narration

**The interface is the protagonist, not the narrator.** Narration adds
what the screen cannot show: why this matters, what just happened, what
it costs. It should never describe what is plainly visible. If the
narration says "here we click the pricing link" while the cursor clicks
the pricing link, delete the sentence.

**One idea per segment.** If a narration needs a semicolon, it is
probably two segments.

**Short sentences.** TTS reads punctuation as pacing. Long subordinate
clauses come out rushed and flat.

**End on an instruction, not a summary.** The last segment should say
what to do next, not restate what was shown.

## Checklist before rendering

- [ ] Does the first segment state a problem or show a result, rather than defining the product?
- [ ] Does something move before the 2 second mark?
- [ ] Is the title card 1200ms or less?
- [ ] Does any narration describe what is already visible on screen?
- [ ] Could any segment be removed without losing an idea?
- [ ] Does the last segment tell the viewer what to do?
