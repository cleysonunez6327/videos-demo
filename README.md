# ndemo

> **About this repository.** This is a fork of
> [splitbrain/ndemo](https://github.com/splitbrain/ndemo) by Andreas Gohr,
> who wrote the toolkit and holds its copyright. It is hosted here as
> `videos-demo`, but the tool itself is still called `ndemo` — that is the
> name the CLI, the skill file and every command use, and keeping it makes
> pulling upstream changes straightforward.
>
> What this fork adds: text-to-speech through
> [llm4agents](https://api.llm4agents.com/docs) instead of OpenAI, `.env`
> support, a test suite, stricter TypeScript settings, and fixes for
> subtitle timing and playbook round-tripping.

A CLI toolkit and [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) for creating narrated demo videos of web applications. You describe what to show, Claude Code drives the browser, and the toolkit renders a polished mp4 with voiceover.

Claude Code is the agent. The toolkit provides browser management, page inspection, segment playback, and video rendering as CLI commands. The skill file (`SKILL.md`) teaches Claude Code how to use them.

## How it works

1. You write a **playbook** (YAML) that lists the segments of your demo — each with narration text and a description of what should happen on screen.
2. Claude Code opens a real browser, reads the page's accessibility tree, and fills in the concrete actions (clicks, typing, waits) for each segment.
3. You review each segment live in the browser, iterate with Claude Code until it looks right, then render the final video with TTS narration.

```
You: "Create a demo showing the new dashboard filters"
  → Claude Code writes the playbook, opens the browser,
    authors actions by inspecting the page, tests each
    segment, and renders the final mp4.
```

## Prerequisites

- **Node.js 20.12+**
- **ffmpeg** with libx264 and aac encoders (ffprobe ships with it)
- **LLM4AGENTS_API_KEY** (for TTS narration) — register an agent at
  [api.llm4agents.com](https://api.llm4agents.com/docs) to get a key
- **Claude Code** with skills support

Set it in your shell profile:

```bash
echo 'export LLM4AGENTS_API_KEY="your-key"' >> ~/.bashrc && source ~/.bashrc
```

An environment variable is the right place for it when ndemo is installed as
a plugin: the plugin lives in Claude Code's cache, which is replaced when the
plugin updates, so a key written inside it does not survive.

ndemo also reads a `.env` file — from the directory it is invoked in first,
then from its own — and a real environment variable wins over both. Use a
project-level `.env` when the key differs per project or when you are working
from a clone of this repository. `.env` is gitignored; never commit it.

## Installation

Install it as a Claude Code plugin — the repository is its own marketplace:

```
/plugin marketplace add cleysonunez6327/videos-demo
/plugin install ndemo@videos-demo
```

That is the whole install. The first time you ask for a demo, the skill
builds the toolkit and installs the Playwright browser on its own.

### From a local clone

Useful while developing the toolkit itself — changes apply without
reinstalling:

```bash
git clone https://github.com/cleysonunez6327/videos-demo
```

```
/plugin marketplace add ./videos-demo
/plugin install ndemo@videos-demo
```

### Layout

```
.claude-plugin/plugin.json   ← plugin manifest
.claude-plugin/marketplace.json
skills/ndemo/SKILL.md        ← the workflow Claude Code follows
skills/ndemo/references/     ← narrative guidance
ndemo                        ← the CLI, at the plugin root
src/                         ← toolkit source
```

## Quick start

In Claude Code, just say:

> Create a narrated demo of my app at http://localhost:3000

Claude Code will:
1. Build the toolkit (first time only)
2. Create a playbook YAML in your project
3. Open the browser and navigate to your app
4. Inspect the page and author actions for each segment
5. Test each segment live
6. Render the final mp4 with TTS narration

### Example prompt

Be specific about what the demo should show, what state needs restoring,
and how to authenticate:

> Create a narrated demo for editing a wiki page. The app runs at
> http://localhost:8080/wiki. The demo should: (1) show the start
> page, (2) click edit, (3) type some text, (4) save the page.
> The demo modifies data/pages/start.txt so save a copy for
> restoration. Login with admin/admin if needed.

Claude Code will create a playbook directory with this structure:

```
demo/
  edit-page/
    edit-page.yaml     ← playbook
    fixtures/          ← copies of files to restore during setup
    audio/             ← TTS files (generated)
    video-raw/         ← raw recording (generated)
    demo.mp4           ← final output (generated)
```

The `fixtures/` directory holds copies of files that the demo modifies.
Setup steps copy them back before each run so the demo is always
repeatable.

### Manual playbook

You can also create the playbook yourself and ask Claude Code to fill
in the actions:

```yaml
# demo/edit-page/edit-page.yaml
app:
  url: http://localhost:8080/wiki
  setup:
    - run: cp demo/edit-page/fixtures/start.txt data/pages/start.txt
    - type: click
      target: { role: link, name: "Login" }
      if:
        hidden: ".user-info"

segments:
  - id: intro
    narration: "Welcome to our wiki. Let's edit a page."
    intent: "show the start page"
    actions:
      - type: wait
        duration: 2000

  - id: open-editor
    narration: "Click the edit button to open the editor."
    intent: "click the edit button"
    actions: []
```

> Fill in the actions for my demo playbook at demo/edit-page/edit-page.yaml

## CLI reference

The skill file teaches Claude Code to run these commands automatically, but you can also run them directly:

```bash
<skill-directory>/ndemo <command>
```

| Command | Description |
|---------|-------------|
| `ndemo open <playbook>` | Launch a headed browser daemon and navigate to the app |
| `ndemo close` | Shut down the browser daemon |
| `ndemo reset` | Navigate back to the app URL with a fresh state |
| `ndemo page-state` | Print the current page's accessibility tree |
| `ndemo page-state --screenshot` | Same, plus save a screenshot |
| `ndemo play <playbook>` | Play all segments in the live browser |
| `ndemo play <playbook> --segment <id>` | Play just one segment (rewinds first) |
| `ndemo play <playbook> --from <id>` | Play from a segment to the end |
| `ndemo play <playbook> --from <id> --to <id>` | Play a range of segments |
| `ndemo play <playbook> --audio` | Play with TTS narration (combinable with other flags) |
| `ndemo render <playbook>` | Full pipeline: TTS, headless replay, merge to mp4 |
| `ndemo render <playbook> --output path.mp4` | Render to a specific output path |
| `ndemo doctor` | Check that all dependencies are installed |

## Playbook format

```yaml
app:
  url: https://myapp.dev           # required
  viewport:                         # optional, defaults shown
    width: 1920
    height: 1080
  scale: 2                          # device scale factor
  zoom: 1.25                        # real browser zoom
  colorScheme: light                # light or dark
  setup:                            # optional steps to run on load
    - run: cp fixtures/page.txt data/ # shell commands for file ops
    - type: click                     # browser actions
      target: { role: button, name: "Login" }
      if:                             # conditional (skip if not met)
        visible: ".login-form"

endCard:                            # optional closing card, same shape
  title: "myapp.dev"                #   as titleCard. Put the CTA here.
  subtitle: "Start free"
  duration: 2000

subtitles:                          # optional, defaults shown
  burn: false                       # draw the SRT into the picture
  fontSize: 10                      # ASS script units, not pixels
  marginV: 22                       # distance from the bottom edge

music:                              # optional background bed
  path: assets/bed.mp3              # relative to the playbook
  volume: 0.12                      # above ~0.2 it competes with the voice
  fadeOutMs: 2500

titleCard:                          # optional, adds a title frame
  title: "My Demo"
  subtitle: "Optional subtitle"     # optional
  stat:                             # optional, leads with a metric instead
    value: "10x"
    label: "fewer tokens per page"
  duration: 600                     # milliseconds (default 600)

tts:                                # optional, defaults shown
  provider: llm4agents
  model: x-ai/grok-voice-tts-1.0    # TTS model
  voice: sal                        # eve, ara, rex, sal or leo
  speed: 1.0                        # 0 < speed <= 4

recording:                          # optional, defaults shown
  outputDir: .                      # relative to playbook directory
  fps: 30

segments:
  - id: segment-name                # lowercase, hyphens, unique
    narration: "What the viewer hears."
    intent: "What happens on screen (for Claude Code's reference)."
    timing: after                    # after (default) or parallel
    actions:
      - type: click
        target: { role: button, name: "Settings" }
        done:
          visible: ".settings-panel"
      - type: wait
        duration: 2000
```

### Action types

| Type | Required fields | Notes |
|------|----------------|-------|
| `click` | `target` | |
| `type` | `target`, `text` | `delay: 60-100` for human-like typing |
| `hover` | `target` | |
| `scroll` | `target` | Scrolls the element into view |
| `wait` | `duration` (ms) | Pause so the viewer can see what happened |
| `press` | `key` | Keyboard key, e.g. `Enter`, `Escape` |
| `select` | `target`, `option` | Dropdown selection |

### Targets

Targets tell Playwright how to find an element. Use the output of `ndemo page-state` to pick the right one:

```yaml
target: { role: button, name: "Settings" }     # accessibility role + name
target: { label: "Email address" }              # form label
target: { placeholder: "Search..." }            # input placeholder
target: { text: "Learn more" }                  # visible text
target: { testId: "submit-btn" }                # data-testid attribute
target: { selector: "#my-element" }             # CSS selector (last resort)
```

### Done conditions

Every action that changes the page should have a `done` condition so the next action waits for the page to be ready:

```yaml
done:
  visible: ".panel"                  # element appears
  hidden: ".spinner"                 # element disappears
  networkIdle: true                  # no pending network requests
  stable: 500                        # DOM unchanged for 500ms
  url: "**/settings"                 # URL matches pattern
  text:                              # element contains text
    selector: ".status"
    has: "Saved"
  attribute:                         # element has attribute value
    selector: html
    name: data-theme
    value: dark
```

## Tests

```bash
npm test
```

Uses Node's built-in test runner — no test dependencies. Tests live next to
the code they cover (`src/*.test.ts`) and run against the compiled output.
They focus on the pure, easy-to-break parts: subtitle timing, playbook
round-tripping, gallery path resolution, and schema validation.

## Architecture

```
Claude Code (the agent)
  ├── reads SKILL.md (skill file) for workflow
  ├── reads the web app's source for context
  ├── edits playbook YAML
  └── runs ndemo CLI commands
        │
        ├── open ──── launches browser daemon
        ├── page-state ── reads accessibility tree
        ├── play ──── executes segments in live browser
        ├── render ── TTS + headless replay + merge
        └── close ─── kills browser daemon
```

The toolkit deliberately avoids building its own agent loop, conversation manager, retry logic, or element discovery. Claude Code already does all of that — the skill file just teaches it the workflow.

## License

MIT
