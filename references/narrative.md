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

Keep the title card short — 600ms is enough. It exists so link previews
have a frame to show, not to be watched. Budget for it: the card plus the
navigation that follows it is dead air before the first segment, and the
navigation alone costs around 700ms. At the 3000ms default the video is
still static past the 3.5 second mark, which is the whole gate and half
the confirmation window spent on a logo.

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

## Leading with proof

A demo does not have to be a tour. When there is a concrete result to
show, the strongest order is **result, then method, then identity** — the
opposite of how most product videos are built.

**Open on the outcome.** Navigate straight to the finished state — the
populated dashboard, the clean extracted data, the completed export — and
only then go back and show how it was produced. The viewer spends the
whole demo watching a process whose payoff they already want. This costs
nothing to build: it is a `setup` step or a first segment that lands on
the result page.

**Open on a number.** If the product's value is quantitative, the title
card can lead with it instead of the product name:

```yaml
titleCard:
  stat:
    value: "10x"
    label: "menos tokens por página"
  title: "AiCrawl.io"      # se muestra debajo, como atribución
  duration: 900
```

The metric fills the frame and the name sits underneath, so the result
registers before anyone reads the brand. Give a stat card a little more
time than a plain one — a number needs to be read, not just seen.

**Show the old way first.** If the product replaces a painful process,
demonstrate the painful process. Real steps, real waiting, in real time.
Then do the same job with the product. The comparison argues on its own
and needs almost no narration.

What does not transfer from testimonial video: faces, interviews, split
screens and emotional close-ups. ndemo records a browser. A customer
story here is told through what the screen does, with the customer's
words as narration if you have them — not by filming anyone.

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

## Publishing to social platforms

**Vertical.** Do not crop a 16:9 recording — it throws away most of the
frame. Record vertically instead: set the viewport to `1080x1920` and the
page renders its own responsive layout, so nothing is cut off and
everything stays readable. The same selectors keep working as long as the
site does not switch to a mobile nav at that width.

**Burned-in captions.** Most feeds autoplay muted, so a demo without
visible text is a silent movie. `subtitles.burn: true` draws the SRT into
the picture. It forces a video re-encode, so keep it off while iterating
and turn it on for the final render.

**Music.** A bed at `volume: 0.10`–`0.15` fills the silence between
narration without competing with it. Above roughly 0.2 it starts to fight
the voice.

**End card.** The last thing on screen should be what to do next. An
`endCard` with the product name and a call to action costs two seconds
and is the only frame a paused video leaves behind.

## Checklist before rendering

- [ ] Does the first segment state a problem or show a result, rather than defining the product?
- [ ] Does something move before the 2 second mark?
- [ ] Is the title card 1200ms or less?
- [ ] Does any narration describe what is already visible on screen?
- [ ] Could any segment be removed without losing an idea?
- [ ] Does the last segment tell the viewer what to do?
