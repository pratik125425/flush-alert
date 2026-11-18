---
name: Flush Alert
description: A field report you can replay. Government data portal crossed with a newsroom graphics desk.
colors:
  ink: "#18232e"
  ink-2: "#3a4855"
  ink-3: "#56636f"
  rule: "#d3dbe2"
  rule-strong: "#9fb0bf"
  wash: "#f0f3f6"
  wash-2: "#e3e9ee"
  ground: "#ffffff"
  on-ink-muted: "#c9d3dc"
  river: "#1d5c87"
  river-deep: "#123f60"
  river-soft: "#8fb2cc"
  river-mist: "#d6e4ef"
  ok: "#a9b7c3"
  alert: "#c43d12"
typography:
  display:
    fontFamily: "Source Serif 4 Variable, Source Serif 4, Georgia, serif"
    fontSize: "clamp(2.05rem, 1.2rem + 3.3vw, 4rem)"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.02em"
  numeral:
    fontFamily: "Source Serif 4 Variable, Source Serif 4, Georgia, serif"
    fontSize: "clamp(3.25rem, 2.2rem + 4vw, 5.5rem)"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "-0.03em"
    fontFeature: "lnum, tnum"
  datestamp:
    fontFamily: "Source Serif 4 Variable, Source Serif 4, Georgia, serif"
    fontSize: "clamp(2rem, 1.4rem + 2.4vw, 3.25rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "lnum, tnum"
  headline:
    fontFamily: "Source Serif 4 Variable, Source Serif 4, Georgia, serif"
    fontSize: "clamp(1.75rem, 1.2rem + 1.9vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Source Serif 4 Variable, Source Serif 4, Georgia, serif"
    fontSize: "clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem)"
    fontWeight: 600
    lineHeight: 1.2
  lede:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
  source:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  chart-label:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  none: "0px"
  dot: "50%"
spacing:
  gutter: "16px"
  gutter-wide: "32px"
  container: "1180px"
  measure: "68ch"
  section: "clamp(56px, 8vw, 112px)"
  control-min: "44px"
components:
  button-play:
    backgroundColor: "{colors.river}"
    textColor: "{colors.ground}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: "10px 18px 10px 16px"
    height: "44px"
  button-play-hover:
    backgroundColor: "{colors.river-deep}"
  segment:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
    height: "44px"
  segment-hover:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
  segment-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  select:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 10px"
    height: "44px"
  tag-watch:
    backgroundColor: "{colors.river-mist}"
    textColor: "{colors.river-deep}"
    rounded: "{rounded.none}"
    padding: "1px 6px"
  tag-alert:
    backgroundColor: "{colors.alert}"
    textColor: "{colors.ground}"
    rounded: "{rounded.none}"
    padding: "1px 6px"
  panel:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "18px 18px 20px"
  masthead:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    padding: "10px 0"
---

# Design System: Flush Alert

## Overview

**Creative North Star: "The Field Report You Can Replay"**

Flush Alert reads like a page a water agency and a newsroom graphics desk made together. The government-portal half gives it plain slate ink on white, a dark masthead that states what the page is ("Historical backtest… Not a live deployment."), a source line under every figure, and legends that state the rule behind each color. The newsroom half gives it a large editorial serif headline with a figure set in the sentence, direct labels on lines instead of legend hunts, and one interactive replay that runs on first paint.

The page is in Read mode: long, single-column, generous vertical rhythm, and dense only inside figures and tables. Sections are divided by hairline rules and whitespace, never boxed. Color carries meaning. River blue is the data, slate is everything else, and vermilion appears only when something is in Alert. Corners are square throughout. The only round shapes are data marks.

Rejected on purpose (from design/inspiration.md): identical shadowed stat cards, rainbow status markers, slippy tile basemaps, welcome modals or spinner walls in front of the tool, and section tiles with icons.

**Key Characteristics:**
- White ground, slate ink (#18232e), river blue for data, vermilion for alerts only.
- Source Serif 4 for headlines and big numbers, Public Sans for everything a reader scans or operates.
- Tabular, lining numerals on every figure.
- Flat. Hairline rules and one tinted band (the replay section) do the work of elevation.
- Square corners on every surface and control.
- Every figure carries a plain-language title, a key that names the rule, and a "Data:" source line.

## Colors

A cool, low-chroma slate-and-river palette in which one warm color is held back for alerts.

### Primary
- **River Blue** (river): the data color. It is used for the sensor nitrate line, the headline figure inside the H1, the result numbers, the big numeral, Watch dots on the maps, histogram bars, links, focus rings, the play button and the range-input accent.
- **Deep River** (river-deep): the pressed and emphasized form of River Blue. Used for link and play hover, the Watch tag text, the post-drought dot in the comparison chart, and the chosen "Timed by flow" series.
- **Soft River** (river-soft): secondary data. Used for raw daily discharge behind the 7-day mean, the 30-day-spread series, the negative-lead histogram bars and the masthead status square.
- **River Mist** (river-mist): area fills and quiet emphasis. Used for the shaded "nitrate the monthly record never sees" region, the Watch tag background and text selection.

### Tertiary
- **Alert Vermilion** (alert): the only warm hue. It is used for Alert map dots, the alert pulse and fire ring, the alert-date rule in every chart, the Alert tag, alert labels and the title of an alert message. Nothing else.

### Neutral
- **Slate Ink** (ink): body and headline text, the masthead and footer bands, the selected segment, the 10 mg/L EPA limit line, monthly-sample dot strokes, and the 2–3px top rules on steps and the site panel.
- **Slate Two** (ink-2): ledes, decks, secondary prose, legend text and unselected control text.
- **Slate Three** (ink-3): source lines, axis labels, metadata, step counters, the dotted "monthly record" line and the regression-estimate line.
- **Rule** (rule): hairline section dividers, table row lines and x-axis ticks.
- **Strong Rule** (rule-strong): control borders, the rule under the replay controls, state outlines on the map and list markers.
- **Wash** (wash): the replay section band, the message header, segment hover, inline code and the drought-memory span in the method chart.
- **Wash Two** (wash-2): y-axis gridlines only.
- **Ground** (ground): page background, the panel, controls at rest, and halos behind chart labels.
- **On-Ink Muted** (on-ink-muted): secondary text on the dark masthead and footer bands. White is used for primary text on those bands.
- **Gauge Grey** (ok): OK-status gauges on the maps and in the legend. It is a status color, so it is never used for text.

### Named Rules
**The Vermilion Means Alert Rule.** Alert Vermilion marks a gauge that is in Alert, the alert date, or an alert message. It never appears as decoration, as a link, as a button or as a highlight. If nothing on screen is in Alert, nothing on screen is vermilion.

**The Three States Rule.** Gauge status has exactly three colors: Gauge Grey (OK), River Blue (Watch), Alert Vermilion (Alert). Every legend that shows them says what each one means (for example "Watch: post-drought spring"), and shows a live count where one exists.

**The Ink Is Not Black Rule.** Text and dark bands use Slate Ink (#18232e), never pure black.

## Typography

**Display Font:** Source Serif 4 Variable (with Georgia, serif), optical sizing on
**Body Font:** Public Sans Variable (with system-ui, -apple-system, Segoe UI, sans-serif)
**Label/Mono Font:** inline code only, using ui-monospace, SF Mono, Menlo, Consolas

**Character:** A sturdy, slightly condensed text serif gives the headlines and big numbers authority. A plain federal-government grotesk keeps prose, controls and chart labels neutral and easy to scan.

### Hierarchy
- **Display** (600, clamp(2.05rem → 4rem), 1.06, max 19ch): the single opening H1. A key figure can sit inside the sentence at 1.32em in River Blue with tabular lining numerals.
- **Numeral** (600, clamp(3.25rem → 5.5rem), 0.95): the big River Blue number that opens a finding, followed by a sans sentence on the same baseline.
- **Datestamp** (600, clamp(2rem → 3.25rem), 1): the replay's current date, set large beside the map so the reader always knows when.
- **Headline** (600, clamp(1.75rem → 2.5rem), 1.12): section H2s, balanced wrap.
- **Title** (600, clamp(1.25rem → 1.5rem), 1.2): H3s, finding titles (up to 1.75rem), the panel title (1.375rem) and step titles (1.1875rem).
- **Lede** (400, 1.1875rem, 1.55, Slate Two): the paragraph under a section H2.
- **Body** (400, 1.0625rem, 1.6): prose, capped at 68ch with pretty wrap. Bold is weight 650.
- **Control** (600, 0.9375rem, line-height 1, tabular): segment buttons, season buttons and the play button. 0.875rem in the evidence toggles.
- **Source** (400, 0.8125rem, 1.5, Slate Three): figure captions and "Data:" lines, up to 90ch.
- **Chart Label** (400, 12px, tabular, Slate Three): axis text. Direct labels are weight 600 in Slate Ink, River Blue or Alert Vermilion to match their series.

### Named Rules
**The Tabular Figures Rule.** Every number that a reader compares (headline figures, big numerals, the datestamp, tables, legends, axis labels, panel loads) uses tabular lining numerals.

**The Serif Is for Statements Rule.** Source Serif 4 is used for headlines, big numbers, the datestamp, and the masthead and footer wordmark. Labels, controls, captions and prose stay in Public Sans.

## Layout

The page is a single column in a 1180px container with a 16px gutter (32px from 720px). Prose is capped at 68ch, so most sections read as a left-aligned column with open space to the right at desktop widths. Sections stack with clamp(56px, 8vw, 112px) vertical padding and a 1px Rule on top. The replay section is the one full-bleed band (Wash).

Responsive behavior, as built:
- **Opening:** one column on mobile. From 1080px it becomes a 1.25fr / 1fr grid: the H1 on the left with the context paragraph bottom-aligned on the right, the hero chart spanning both columns, then the result line left and the deck right.
- **Steps:** a numbered list of four. One column, two columns from 720px, four from 1080px.
- **Replay stage:** controls in an auto / auto / 1fr row (season segments, play, scrubber), collapsing to two rows below 720px. From 1000px the stage splits 1.35fr / minmax(320px, 1fr), map left and panel right, with the datestamp and legend overlaid at the map's top left.
- **Findings:** from 960px each finding is a two-column grid, with the title in a minmax(220px, 0.8fr) left column and the body in a 2.2fr right column.
- **Tables:** scroll horizontally inside a focusable region. Below 560px optional columns are hidden and cell padding tightens.
- **Footer:** three columns from 900px.

Touch targets on controls are at least 44px tall (40px in the evidence toggles).

## Elevation & Depth

Flush Alert is flat. There are no box shadows anywhere. Depth comes from three things: hairline rules (1px Rule between sections and table rows, 1px Strong Rule around controls), heavier top rules that mark a unit (2px Slate Ink on each step, 3px Slate Ink on the site panel), and tonal bands (the Wash replay section with white panel and controls sitting on it, the Slate Ink masthead and footer).

### Named Rules
**The Rules, Not Boxes Rule.** Separate content with a rule and whitespace. A surface gets a fill only when it is a working tool (the replay band, the panel, the message preview), never to make content look like a card.

**The No Shadow Rule.** No box-shadow, drop shadow or blur on any surface. The only stroke "halo" in the system is the 4px white paint-order stroke behind chart labels, and it exists for legibility over lines.

## Shapes

Every rectangle is square-cornered (0px): controls, the select, tags, the panel, the message, table cells and bands. Circles (50%) are reserved for data marks: gauge dots, monthly-sample dots, legend keys and the numbered step pins in the method chart. Line marks follow a fixed vocabulary. A solid 2–2.25px River Blue line means measured data. A thin dotted Slate Three line means what monthly sampling records. A 4 3 dashed line means a regression estimate or a calendar median. A 5 4 dashed Slate Ink line means the 10 mg/L EPA limit. A 2px solid vertical Alert Vermilion rule means the alert date.

## Components

### Buttons
Plain, square and confident. Only the play button is filled.
- **Shape:** square (0px), at least 44px tall.
- **Play (primary):** River Blue fill, white Control-weight text, an inline 14px SVG play/pause icon in currentColor, padding 10px 18px 10px 16px. It toggles aria-pressed and swaps the icon and label.
- **Hover / Focus:** hover deepens to Deep River. Focus everywhere is a 2px River Blue outline with a 3px offset.

### Segmented controls
- **Style:** a row of text buttons inside a 1px Strong Rule border on Ground, divided by 1px Strong Rule lines. Control type, Slate Two text.
- **State:** hover shows Wash with Slate Ink text. The selected segment (aria-checked) is a solid Slate Ink fill with white text. Built as role="radiogroup" with radios. Used for season choice and for chart options.

### Tags
- **Style:** inline status words in running text, weight 650, 0.8125rem, letter-spacing 0.02em, padding 1px 6px, square.
- **Variants:** Watch is River Mist with Deep River text. Alert is an Alert Vermilion fill with white text. They are only for status words, never for categories.

### Inputs / Fields
- **Select:** Ground fill, 1px Strong Rule border, square, 44px tall, Slate Ink 0.9375rem weight 500, with a sans label beside it.
- **Range scrubber:** the native range input with a River Blue accent, full width, and month ticks below in 0.75rem Slate Three.

### Navigation
There is no nav bar. The masthead is a thin Slate Ink band (0.8125rem) holding the serif wordmark in white (1.125rem, 650), a status line marked by a 7px Soft River square, and the team credit pushed right (it wraps under on mobile). A skip link to the replay appears on focus.

### Site panel
The replay's reading surface: Ground fill, a 3px Slate Ink top rule, padding 18px 18px 20px. It holds a serif title, tabular metadata, a small multi-series chart with its own line-type key, a three-column load table (label, value, delta) and a message preview.

### Message preview
- A 1px Strong Rule box. The header is a Wash strip in 0.75rem Slate Three ("Preview. No message is sent." and the date). The title is bold Alert Vermilion when an alert fires and Slate Ink when quiet. A new message rises in over 320ms.

### Figure
The repeating unit of the page: a plain-language figure title in Slate Two (0.9375rem) with inline line and dot keys, the chart with direct end labels, then a Source-style caption that explains shading and line types and ends with "Data: …" and, where relevant, a link to the results CSV.

### Finding
A numbered piece of evidence: a 1px Rule on top, the serif title on the left, and the body on the right. The body opens with a River Blue Numeral or a short paragraph, then a chart or table, then a source line.

### Tables
Right-aligned tabular figures, left-aligned row headers, 1px Rule row lines, and a 1px Slate Ink rule under small Slate Three column heads. The row for the chosen setting is bold Slate Ink.

### Motion
Motion explains state changes and stays out of the way. UI and state transitions run 150–400ms on the ease-out curve cubic-bezier(0.16, 1, 0.3, 1) and animate only transform and opacity:
- Section content reveals once on scroll (opacity plus a 14px rise, 400ms). Content that is already on screen at load does not animate.
- The replay cursor and its shaded "future" mask slide 150ms.
- A new message rises in over 320ms.
- The hero chart plays once when it scrolls into view: the line draws on by clip scaleX over 1400ms, sample dots fade in at a 160ms stagger, and the alert rule fades in at 1200ms. This one-shot data reveal is the single exception to the 150–400ms band.
- When a gauge first enters Alert during the replay, a one-shot vermilion ring scales out over 700ms.
- **The One Loop Rule.** The pulse on an active Alert gauge (1.6s, scale 1 → 3.2 with fading opacity) is the only animation that loops.
- **Reduced motion:** all animations and transitions are removed, reveals render in place, charts render complete, the fire ring is skipped, and the alert pulse becomes a static ring (scale 1.9, opacity 0.9) so the alert stays marked.

## Do's and Don'ts

### Do:
- **Do** keep Alert Vermilion (#c43d12) for alert state only: alert gauges, the alert-date rule, the Alert tag and alert message titles.
- **Do** give every figure a plain-language title, a key that states the rule behind each color or line, and a Source line ending in "Data: …".
- **Do** label lines directly at their ends (weight 600, matching the series color, with a white halo) rather than relying on a separate legend.
- **Do** set every compared number in tabular lining numerals.
- **Do** separate sections with a 1px Rule and clamp(56px, 8vw, 112px) of space.
- **Do** keep controls square, at least 44px tall, and show selection as a solid Slate Ink fill.
- **Do** state the period with every number and keep the replay date large beside the map.
- **Do** keep motion on transform and opacity, 150–400ms ease-out, and give reduced-motion readers a static equivalent of every state cue.

### Don't:
- **Don't** use vermilion, or any other warm color, for links, buttons, highlights or decoration.
- **Don't** add box shadows, drop shadows, rounded cards or tile grids of identical stat cards.
- **Don't** add a fourth status color or a rainbow categorical palette to the maps.
- **Don't** put a welcome modal, overlay or loading wall in front of the replay.
- **Don't** round the corners of controls, panels, tags or tables. Circles are for data marks only.
- **Don't** set labels, controls or captions in the serif, or headlines in the sans.
- **Don't** add looping motion beyond the active-alert pulse.
- **Don't** use pure black text.
