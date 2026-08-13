---
name: testimonial
description: >
  Build customer testimonial and case-study demo videos — first-person
  narration over a real screen recording of the product doing what the
  customer says it does. Use for social proof, customer stories, case
  studies, before/after workflow comparisons and result-led product videos.
  Requires a provenance declaration before rendering. Triggers on
  testimonial, case study, social proof, customer story, success story,
  caso de éxito, testimonio, prueba social, historia de cliente.
---

# testimonial

A testimonial in ndemo is not a talking head. There is no camera, no face
and no set — there is a browser. So the format that plays to that strength
is different from the one a video model would produce:

> **The product doing exactly what the customer says it does, narrated in
> the first person.**

The viewer does not watch someone claim the tool saved them eleven hours.
They watch the eleven hours being saved, while a voice explains what the
work used to look like. The screen is real and checkable; only the voice is
synthesised, and `audioFile` removes even that once it lands.

## Read first

This skill decides **what** is told and in what order. It delegates **how**
to `ndemo`:

- `../ndemo/SKILL.md` — the execution workflow: open the browser, author
  actions from the accessibility tree, test each segment, render.
- `../ndemo/references/narrative.md` — the base doctrine: the retention
  clock, leading with proof, how to write narration, publishing formats.
  Do not restate any of it here; this skill only adds what is specific to
  a testimonial.

Then read, in this directory:

- `references/provenance.md` — **read before writing narration.** Which
  route applies decides what you are allowed to say.
- `references/formats.md` — the four formats that work on a screen.
- `references/voice-casting.md` — which voice belongs to whom.

## When this skill applies, and when `ndemo` does

Both skills trigger on video requests, so the line matters:

| The video is told from… | Skill |
|---|---|
| the customer's voice — first person, past tense | **testimonial** |
| the product's voice — features, capabilities, a tour | `ndemo` |

"Show what our app does" is `ndemo`. "Show how a customer uses it" is this.

## Workflow

**1. Establish provenance before anything else.** Ask the user whose words
these are. Do not start writing narration and sort the attribution out
later — the route changes what the narration may claim. See
`references/provenance.md`.

**2. Pick a format.** `references/formats.md` has four. For a first
testimonial, *Workflow Proof* is usually right.

**3. Find the moment worth proving.** A testimonial needs one concrete
before/after, not a feature list. Ask: what did this person do on a Monday
morning that they no longer do? That is the video.

**4. Write the narration in the first person.** Past tense for the pain,
present for the relief. Be specific — "three CSVs every Monday" lands,
"improved my workflow" does not. Never write marketing register into a
customer's mouth; if it sounds like an ad, it performs like one.

**5. Author the actions with `ndemo`.** Same loop as any other playbook:
open the browser, read `page-state`, write actions, test each segment.

**6. Render and check the disclosure is legible.** Not just present — legible
at 360p on a phone, which is where the video will actually be watched.

## Settings that differ from a product demo

```yaml
tts:
  voice: eve          # never `sal` — that is the product's voice
  speed: 0.96         # slightly under 1.0 reads as a person, not an announcer

app:
  zoom: 1.35          # a product demo uses 1.25; here the detail IS the proof

music:
  volume: 0.10        # the customer's voice leads; the bed stays under it

subtitles:
  burn: true          # feeds autoplay muted, and a testimonial is words
```

## Limits to state up front

**One voice per playbook.** `tts.voice` is global, so a customer voice plus
a neutral closing voice is not possible yet. Write the whole narration in
the customer's voice, or wait for per-segment voices.

**No mid-roll cards yet.** A pull-quote or a metric between segments needs
`segment.card`, which does not exist. Use the opening and closing cards.

**No split screen.** Before and after run one after the other, never side
by side. Sequence the contrast instead of compositing it.

## Optional: generated B-roll

Generated clips (`bytedance/seedance-1-5-pro` through llm4agents) can open
or close a testimonial with context a browser cannot show — a workspace, a
counter, an abstract of the transformation. It is an accessory, not part of
the format: the proof is the screen recording.

Two rules learned the hard way: **never generate a screen with content on
it** — the model renders unreadable text, and once put a confirmation tick
on the back of a phone — and **never generate a person who speaks or
testifies**. Interfaces come from ndemo; people are context, not witnesses.

## Checklist before rendering

- [ ] Is provenance declared, and does the narration stay within what that route allows?
- [ ] Is the narration first person, past tense for the pain, and specific?
- [ ] Does the opening card lead with the result rather than the person?
- [ ] Is the voice different from the product demo's?
- [ ] Does the video show one concrete before/after, not a feature tour?
- [ ] Is the disclosure legible at 360p, and present on the opening card when the route is illustrative?
- [ ] Does the last frame commit to something — a result, a next step — rather than a generic CTA?
