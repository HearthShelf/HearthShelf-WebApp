---
name: HearthShelf
description: A warm, fire-lit listening room for your own audiobook and ebook library.
colors:
  ember-coral: "#e0654a"
  hearth-gold: "#bd863f"
  shelf-cream: "#f0e6d6"
  ink: "#1b1a18"
  paper: "#f4f1ea"
  surface-lowest: "#131211"
  surface-low: "#201e1c"
  surface: "#242220"
  surface-high: "#2a2825"
  surface-highest: "#322f2b"
  sheet: "#222120"
  text-muted: "#aba498"
  text-faint: "#756f64"
  border: "#383530"
  destructive: "#c4463a"
  affirm-green: "#5a9c52"
  chart-tide: "#4f9db0"
  chart-moss: "#7fa86b"
  chart-dusk: "#5e76c4"
  chart-brass: "#d9a45a"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "4.75rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5625rem"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 300
    lineHeight: 1.2
    letterSpacing: "0.32em"
  wordmark:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  quote:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "1.3rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  cover: "10px"
  row: "12px"
  card: "16px"
  sheet: "24px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  s6: "24px"
  s8: "32px"
  s10: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ember-coral}"
    textColor: "#fffaf6"
    rounded: "{rounded.card}"
    padding: "14px 26px"
  button-primary-hover:
    backgroundColor: "#e57a62"
    textColor: "#fffaf6"
  button-ghost:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "11px 20px"
  button-ghost-hover:
    backgroundColor: "rgba(255, 255, 255, 0.1)"
  button-small:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "{colors.paper}"
    rounded: "10px"
    padding: "9px 16px"
  button-danger:
    backgroundColor: "#b03f34"
    textColor: "#ffffff"
    rounded: "10px"
    padding: "9px 16px"
  pill:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
  pill-selected:
    textColor: "{colors.ember-coral}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
  input:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "{colors.paper}"
    rounded: "10px"
    padding: "10px 13px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.row}"
    padding: "11px 14px"
  nav-item-active:
    textColor: "{colors.ember-coral}"
    rounded: "{rounded.row}"
    padding: "11px 14px"
  card:
    backgroundColor: "{colors.surface-high}"
    textColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "16px"
  icon-button:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "42px"
    width: "42px"
---

# Design System: HearthShelf

> **Inherits `DESIGN.shared.md` in `@hearthshelf/core`** — the cross-surface
> contract covering the palette, the three type voices, the radius ladder, the
> cover glow, themes, and the accent. Those live there because theme,
> `accentHex` and `glow` are account-scoped settings that sync between this app
> and the mobile app: drift is a bug, not a dialect.
>
> This file owns the **web platform layer** — the display type scale, hover and
> right-click grammar, keyboard affordances, the chart palette, admin density,
> and the car shell. The mobile app neither has nor should inherit those. Values
> repeated from the shared contract are noted as such; when they disagree, the
> shared file wins.

## Overview

**Creative North Star: "The Fireside Listening Room"**

A warm room at night with one fire in it, furnished for listening. Everything in
this system follows from that single image. The fire is literal: a
`radial-gradient` bloom (`.app-glow`) sits fixed behind the content column,
tinted live by the current cover art, and it is the only real light source in
the interface. Surfaces are warm near-neutrals stepped up from an ink base
(`#1b1a18`) - R >= G >= B by a hair, never navy, never muddy brown - so the room
reads as firelight on plaster rather than as a dark-mode inversion of a white
app. Dark is home; light is a daytime option, not the default.

The room is furnished for one activity. Cover art is the only saturated colour
most screens contain, and the chrome around it is deliberately quiet: fills at
6% white, hairlines at 8%, muted warm-grey type. Controls are soft to the touch
- generous 16px card radii, a 0.98 press-scale on every button, 150-180ms
transitions - so the interface feels physically pressable rather than clicked.
Type is a two-voice pairing: Inter carries every functional surface, and Libre
Baskerville appears only where the product turns editorial (the wordmark,
pull-quotes, book copy), which keeps the serif meaningful instead of decorative.

The system spans an unusually wide range for one world: a listener's library at
one end, a 25-section server admin panel at the other, and a large-touchscreen
car shell in between. All three use the same tokens. Admin density is allowed to
be dense; it is not allowed to become a different visual world.

**Key Characteristics:**

- Warm near-neutral surfaces on an ink base, never navy or brown
- One live light source: a cover-tinted radial bloom behind the content
- Cover art supplies the colour; chrome stays at 6% fill and 8% hairline
- Soft-touch controls: 16px radii, press-scale feedback, 150-180ms easing
- Two type voices - Inter functional, Libre Baskerville editorial
- Four themes off one token set: dark (home), light, flat/OLED, plus a car shell

## Colors

**The palette is shared** — the ink base, the five-step surface ramp, paper and
muted/faint text, border and hairline, the two brand warms, and the state colours
all live in `DESIGN.shared.md` and must match the mobile app exactly. See it for
values and for The Warm Grey, Two Warms, Cover-Supplies-Colour,
Destructive-Is-Not-Ember, and Live Accent rules.

What is web-specific:

- **Role assignments in the ramp.** Lowest is the sidebar; high is a card;
  highest is a track or pressed state. Mobile assigns the same steps differently
  because it has no sidebar.
- **The brand anchors swap roles between themes.** Shelf Cream renders the
  "Shelf" half of the wordmark on dark and becomes the page ground in light.
- **Chart colours** — Tide (`#4f9db0`), Moss (`#7fa86b`), Dusk (`#5e76c4`),
  Brass (`#d9a45a`): data series only, drawn to sit beside cover art without
  fighting it. Never used as UI colour. **These are the shared chart palette**:
  if mobile ever charts, it borrows these rather than inventing its own.

### Named Rules

**The Accent-Is-Not-Accent Rule.** In shadcn's token convention `--accent` is a
*neutral hover surface*, not the brand accent; interactive colour is
`--primary` / `--ring`. This codebase overrides `--accent` to the brand accent at
runtime because ~287 rules in `design.css` already read `var(--accent)` that way.
That override is load-bearing — renaming it is its own migration, not a
drive-by fix.

## Typography

**Display / Body Font:** Inter (variable 100-900), self-hosted, with
`ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto` fallbacks.
**Editorial Font:** Libre Baskerville (variable 400-700), self-hosted, with
`Georgia, Times New Roman` fallbacks.
**Mono Font:** Geist Mono, with `ui-monospace, SFMono-Regular, Menlo, Consolas`.
**Icon Font:** Material Symbols Rounded, self-hosted, ligature-based, rendered
through `<span class="ms">` with `FILL 0` at rest and `FILL 1` when active.

No external CDN - every face is self-hosted and offline-safe.

**Character:** Inter does all the work and asks for no attention; Libre
Baskerville arrives only when the product is being a book rather than an app.
The pairing is deliberately lopsided - the serif is rare enough that seeing it
means something.

### Hierarchy

- **Display** (700, 76px / 4.75rem, line-height 1, tracking -0.03em): the stat
  hero on the Stats page. One per screen at most.
- **Headline** (700, 34px / 2.125rem, line-height 1.08, tracking -0.02em): page
  titles.
- **Title** (600, 25px / 1.5625rem, tracking -0.02em): sheet and detail titles.
- **Section** (600, 17px / 1.0625rem, tracking -0.01em): section headings inside
  a page.
- **Body** (400, ~14.5px / 0.9rem, line-height 1.6): running text.
- **Control** (600, 14-15px): buttons, list items, navigation rows.
- **Caption** (500, 13px / 0.8125rem): chips, secondary metadata.
- **Label / Eyebrow** (300, 11px / 0.6875rem, tracking 0.32em, uppercase): the
  tracked kicker above a page title. The extreme 0.32em tracking is a signature -
  do not reduce it toward a conventional 0.05em.
- **Quote** (Libre Baskerville, italic, 1.3rem, line-height 1.5): pull-quotes and
  book copy.
- **Mono** (Geist Mono, 13px, muted): identifiers, timestamps, technical values.

### Named Rules

**The Rare Serif Rule.** Libre Baskerville appears in the wordmark, pull-quotes,
and book prose. It never sets a heading, a button, or a label. Its scarcity is
the point.

**The Tracked Kicker Rule.** The eyebrow's 0.32em tracking and 300 weight are
load-bearing - it is the one place this system is overtly stylish. Keep it wide,
keep it light, keep it uppercase.

## Layout

The app is a fixed full-viewport CSS grid (`.app`), never the scrolling document
- `body` is `overflow: hidden` and the content pane scrolls itself. The grid is
two columns: a sidebar of `--sidebar-w` and the content column.

`--sidebar-w` is the single lever the whole shell tracks. It is **248px** at
rest, **76px** collapsed to an icon rail, **124px** in car mode, and collapses to
a single column in the car player takeover. The glow, the playbar, and the
content column all read it, so changing one variable moves the entire layout
coherently. New chrome that pins to the left edge must read `--sidebar-w` rather
than hardcoding a width.

Content is a vertical rhythm of `.section` blocks under a `.page-head` of
eyebrow, title, subtitle. The library is a two-column shell: a filter rail beside
an auto-filling cover grid
(`repeat(auto-fill, minmax(var(--tile,170px), 1fr))`, gap 24px x 20px) where
`--tile` is user-adjustable via the cover-size slider - density is a user
preference, not a fixed choice. The playbar is an 84px `320px 1fr 320px` grid
pinned to the bottom of the content column.

Spacing runs a strict **4px cadence** (4/8/12/16/20/24/32/48). Breakpoints in
active use are 1180px, 860px, 820px, 760px, 720px, 640px, 620px, 560px, and
420px, applied per component rather than as a global tier system.

### Named Rules

**The Single-Lever Rule.** Left-edge geometry is derived from `--sidebar-w`.
Anything that hardcodes 248px will desynchronise the moment the rail collapses or
the car shell mounts.

## Elevation & Depth

This system is a hybrid, and deliberately so: it has three separate depth
mechanisms and uses whichever suits the element.

**Tonal layering** is the workhorse. The `surface-lowest` to `surface-highest`
ramp separates sidebar from page from card from track without a single shadow.
Most chrome sits flat on its tonal step.

**Atmospheric light** is the signature. `.app-glow` is a fixed
`radial-gradient(120% 80% at 50% -18%)` bloom, 78vh tall (100vh in player mode),
tinted by `--glow-accent` - which JavaScript drives live from the current cover
art. Its intensity is a themed token: `--glow-strength` is **60** in dark, **14**
in light, and **0** in flat/OLED, so the same rule renders as a strong bloom, a
faint wash, or nothing at all.

**Real shadows** are reserved for things that behave like physical objects:
covers, floating overlays, and the primary button's coloured throw.

### Shadow Vocabulary

- **Card** (`0 1px 0 rgba(255,255,255,0.02)` dark /
  `0 2px 8px rgba(60,50,40,0.08)` light): barely a shadow in dark - a top
  highlight standing in for a lifted edge.
- **Lift** (`0 18px 48px rgba(0,0,0,0.55)` dark /
  `0 18px 48px rgba(60,50,40,0.18)` light): popovers, menus, sheets, tooltips.
- **Cover** (`0 10px 28px rgba(0,0,0,0.4)`): tile artwork. Covers are objects on
  a shelf and cast accordingly.
- **Ember throw** (`0 8px 24px color-mix(in oklab, accent 34%, transparent)`):
  the primary button only. A coloured glow, not a grey shadow - the button is lit
  by the same fire as the room.
- **Glass** (`backdrop-filter: blur(20px)` over an 86% surface): the playbar and
  cover badges. The only blur in the system.

### Named Rules

**The One Light Source Rule.** There is a single bloom, behind the content
column, tinted by the artwork. Adding a second glow elsewhere on the page breaks
the room.

**The Flat-Theme Rule.** Flat/OLED is not "dark with darker colours" - it sets
`--glow-strength: 0` and removes the atmosphere entirely. Any new effect that
depends on the bloom must still read with it switched off.

## Shapes

A soft, consistently rounded form language on a five-step radius scale: **cover
10px**, **row 12px**, **card 16px**, **sheet 24px**, **pill 999px**. Cards and
primary buttons share the 16px radius, which is what makes buttons feel like
objects rather than fields.

Covers are square (`aspect-ratio: 1/1`) with `isolation: isolate` and a layered
interior: a duotone `::before` wash (radial highlight over a 155deg gradient) for
missing artwork, an oversized monogram, typeset title/author fallback, and a
`cv-shine` diagonal specular at 10% white across the top-left. Real artwork hides
the fallback layers but keeps the shine - every cover in the system carries the
same light.

Lines are drawn one of two ways: an opaque `--border` on solid components, or the
translucent `--hairline` on layered surfaces. Circles are reserved for avatars,
icon buttons (42px), and cover badges (26px).

### Named Rules

**The No-Sharp-Corners Rule.** Nothing in this system has a 0px radius. The
smallest corner is 10px, on cover art.

## Components

Component character across the board is **soft-touch and tactile**: generous
radii, warm low-opacity fills, and a `scale(0.98)` press on anything actionable.
The primary button simply presses harder than everything else.

### Buttons

- **Shape:** Card radius (16px) on standard and primary; a tighter 10px on the
  small variant.
- **Base** (`.btn`): 6% white fill, no border, 14px/600, 11px x 20px padding, 9px
  icon gap. Transitions background, transform and shadow at 180ms.
- **Primary** (`.btn-primary`): Ember Coral ground, `--on-accent` text, 15px/650,
  14px x 26px padding, plus the ember throw shadow. Hover lightens the ground 12%
  toward white. Its icon is 21px, larger than the base 18px.
- **Ghost** (`.btn-ghost`): 6% fill plus a hairline border; hover goes to 10%.
- **Danger** (`.btn-danger`): Destructive darkened 10% toward black, white text.
- **Affirm** (`.btn-green`): Affirm Green; hover lightens to `#66a85d`.
- **Press:** every variant scales to 0.98 on `:active`. This is the system's
  primary tactile signal and must not be dropped from new buttons.

### Pills / Chips

- **Style:** 6% fill, hairline border, pill radius, 13px/500, 9px x 16px, with a
  17px muted icon.
- **State:** selected (`.pill.on`) takes a 55% accent border and accent text plus
  accent icon. The fill does *not* change - selection is communicated by outline
  and text, keeping selected chips visually light.

### Cards / Containers

- **Corner Style:** Card radius (16px).
- **Background:** `surface-high` (`#2a2825`), one step above the page.
- **Shadow Strategy:** none in dark beyond the 1px top highlight; depth comes
  from the tonal step. See Elevation & Depth.
- **Border:** hairline where separation is needed.
- **Internal Padding:** 16px, on the 4px cadence.

### Inputs / Fields

- **Structure** (`.field`): a 12.5px/600 muted label, the control, and an
  optional 12px faint hint, in a 7px stack with 16px bottom margin.
- **Style** (`.fld`): 6% fill, hairline border, 10px radius, 10px x 13px padding,
  14px text, no outline.
- **Focus:** the border becomes 55% accent and the fill lifts to the `surface`
  step. Focus is a *border and ground* change, never a ring.
- **Placeholder:** faint (`#756f64`).
- **Layout:** two-column `.form-grid`, with `.field.full` spanning both.

### Navigation

- **Rows** (`.nav-item`): 14px/500 muted, 21px icon, 14px gap, 11px x 14px
  padding, row radius (12px). Rendered as `<a>` so modified clicks open tabs.
- **Hover:** 6% fill, text lifts to full.
- **Active:** accent text on a 15% accent wash.
- **Collapsed rail:** at 76px, labels, badges, group headings and the user chip's
  metadata all hide; icons centre.
- **Car mode:** rows become vertical square tiles - 30px icon over a 12.5px/600
  label, 18px radius, 5% white ground, 16px x 6px padding, centred. Group labels
  and the collapse control are hidden as noise. Active is an 18% accent wash.

### Playbar

An 84px `320px 1fr 320px` grid pinned to the bottom of the content column,
tracking `--sidebar-w` on the left. Its ground is `surface-low` at 86% opacity
over `backdrop-filter: blur(20px)` with a hairline top border - the only glass in
the system. It hides by translating 110% down over 350ms on
`cubic-bezier(0.2, 0.7, 0.3, 1)`, this system's single easing curve. The
now-playing cover is 56px at an 8px radius.

### Cover (signature component)

The system's most distinctive piece. A square, `isolation: isolate` container
that degrades in four layers: real artwork on top; below it a `cv-shine` diagonal
specular; below that a typeset fallback of kicker, title, author and rule; and at
the base a duotone wash generated from a per-item `--cv` hue. A missing cover is
therefore never a grey box - it is a designed, typeset spine. Badges (26px
circles on a 62%-black blurred ground) float top-right for state, and a format
badge marks items that have an ebook file.

## Do's and Don'ts

### Do:

- **Do** use `--primary` / `--ring` (Ember Coral `#e0654a`) for every interactive
  and stateful colour.
- **Do** reserve Hearth Gold (`#bd863f`) for the wordmark alone.
- **Do** derive left-edge geometry from `--sidebar-w`, never from a literal
  248px.
- **Do** keep the `scale(0.98)` press on every new actionable control.
- **Do** design new surfaces against all four themes - dark, light, flat/OLED,
  and the car shell - since flat sets `--glow-strength: 0` and removes the bloom.
- **Do** give every cover a typeset fallback rather than an empty placeholder.
- **Do** honour the 4px spacing cadence and the five-step radius scale.
- **Do** use `cubic-bezier(0.2, 0.7, 0.3, 1)` for motion; it is the system's only
  easing curve.
- **Do** let cover art carry the colour on library surfaces.

### Don't:

- **Don't** use `--accent` for interactive colour. In this system `--accent` is a
  *neutral hover surface* (`#322f2b` dark / `#e7dcc9` light). **Known defect:**
  the ported shell in `src/styles/design.css` reads `var(--accent)` for
  `.btn-primary`, `.nav-item.active`, `.pill.on`, `.fld:focus` and the cover-size
  slider, so those render warm-grey instead of ember. Do not copy this pattern
  into new components - use `--primary`. Fixing the existing rules is tracked
  work, not settled intent.
- **Don't** add a second glow. There is one light source, behind the content
  column.
- **Don't** set headings, buttons or labels in Libre Baskerville.
- **Don't** reduce the eyebrow's 0.32em tracking toward a conventional value.
- **Don't** introduce navy or brown surfaces. Warm near-neutrals only - R >= G >=
  B by a hair.
- **Don't** use a 0px radius anywhere; 10px is the tightest corner in the system.
- **Don't** use chart colours as UI colours.
- **Don't** load a font from a CDN - every face is self-hosted and offline-safe.
- **Don't** add `overflow` to `body`; the shell is a fixed grid that scrolls its
  own content pane.
- **Don't** let admin density drift into a second visual world. `/config` and
  `/admin` may be dense, but they use these tokens.
