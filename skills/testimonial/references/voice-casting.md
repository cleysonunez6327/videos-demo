# Voice casting

The TTS model is `x-ai/grok-voice-tts-1.0` through llm4agents. It offers
five voices: `eve`, `ara`, `rex`, `sal`, `leo`.

## `sal` is the product's voice

It is ndemo's default, so every ordinary product demo already uses it. **Do
not cast it as a customer.** If the testimonial sounds like the demo, the
viewer files it as marketing, and the whole point of a testimonial is that
it does not sound like the company talking.

Pick any of the other four. Keep one voice per persona across a catalogue —
the same customer should not change voice between videos.

## The voice varies even when it does not change

The model is generative, not a recording. The same voice id renders
differently on each call: measured across narrations in this repository,
`sal` ranged from **123 to 145 Hz** — roughly three semitones, enough to
hear as a different person.

Two consequences:

**Within a video it does not matter.** Audio is cached by content hash, so a
re-render reuses the same files and the voice is stable.

**Across videos it does.** A persona recorded in separate sessions will
drift. If consistency matters, generate all of a persona's narration in one
pass, and keep the audio files rather than regenerating them.

## Speed

`1.0` reads as an announcer. `0.94`–`0.97` reads as a person talking. Below
`0.9` it starts to sound tired.

## Writing for the voice, not the page

The model reads punctuation as pacing, so the narration is a script, not
prose:

- Short sentences. A comma is a breath; a full stop is a beat.
- Spell out what should be spoken: "punto io", not ".io"; "cuarenta y siete",
  not "47", when the number should land rather than scroll past.
- No parentheses, no semicolons, no lists. Nobody speaks them.
- Read it aloud before rendering. If you stumble, so will the model.

## Language

The five voices handle Spanish well and auto-detect from the text — there is
no language parameter. Write in the register of the audience: neutral Latin
American Spanish travels furthest, and voseo or peninsular forms will narrow
the audience to one region.
