# Design

## Theme
Dark by default ("night reading nook"), light mode available. Surfaces are deep indigo-tinted
neutrals; the single brand accent is Ember, a warm coral. Restrained color strategy: accent
only on primary actions, selection and live state.

## Color (OKLCH)
| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | 0.17 0.018 275 | 0.985 0.004 275 | app background |
| `--panel` | 0.205 0.022 275 | 0.955 0.008 275 | sidebar, toolbars |
| `--surface` | 0.235 0.024 275 | 1 0 0 | cards, bot bubbles |
| `--surface-2` | 0.28 0.026 275 | 0.93 0.01 275 | hover, inputs |
| `--line` | 0.32 0.022 275 | 0.88 0.012 275 | borders |
| `--ink` | 0.95 0.008 275 | 0.22 0.02 275 | primary text |
| `--ink-2` | 0.78 0.014 275 | 0.42 0.02 275 | secondary text (≥4.5:1) |
| `--ember` | 0.70 0.19 40 | 0.60 0.20 38 | brand / primary action |
| `--ember-ink` | 0.18 0.03 40 | 1 0 0 | text on ember |
| `--user-bubble` | 0.32 0.05 275 | 0.90 0.035 275 | user message bubble |
| `--ok/--warn/--err` | semantic | semantic | status |

## Typography
One family: Figtree (variable, bundled). Scale 1.2: 12 / 14 / 15 (body) / 18 / 22 / 26 / 32.
Weights 400 / 500 / 650 / 750. Chat text 15px/1.6, max 70ch.

## Shape & depth
Radii: 10 (controls), 16 (cards), 22 (bubbles), full (avatars, pills). Depth via surface
steps, not shadows; one soft shadow for floating menus.

## Components
Buttons (primary ember, secondary surface, ghost), icon buttons 36px (44px touch on mobile),
pill chips for tags, character card (avatar 72px circle, name, tagline 2 lines, creator,
interaction count), message bubble, composer, sidebar list rows, menus via fixed popovers.

## Motion
150 to 220ms ease-out-quart for state; streaming caret blink; swipe slides 180ms; all
reduced to fades under `prefers-reduced-motion`.
