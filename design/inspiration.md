# Inspiration research

Screenshots captured with Playwright (headless Chromium, 1440×900) on 2026-11-18 and saved in `design/inspiration/`.
We borrow principles only. No code, logos or exact layouts are copied.

| Site | File | Borrow | Avoid |
|---|---|---|---|
| Our World in Data, grapher chart | `owid-chart.png` | A serif title with the year as a quieter suffix; a one-line plain-English subtitle under the title; direct labels on the bars instead of a legend hunt; a **"Data source:" line attached to every chart**; a play/scrub timeline under the chart | A chart framed in a box with a heavy side panel of checkboxes; cookie-banner yellow |
| Our World in Data, article | `owid-article.png` | Playfair-style serif headline over a humanist sans body; a byline plus a "first published / last updated" line as a trust signal; deep navy text instead of pure black | Section tiles with icons; the generic "Data / Writing" cards |
| Drought.gov current conditions | `drought-gov.png` | The date range stated right under the H1 (the reader always knows *when*); plain-language status paragraphs **before** the numbers; big numerals with a "since last week" delta | Three identical navy stat cards with drop shadows (a banned pattern for us); social-icon clutter |
| USGS National Water Dashboard | `usgs-nwd.png` | A percentile legend that **states the rule** ("25th–75th percentile = normal") right next to the colors; source and service links in the legend | A slippy tile basemap; rainbow categorical markers; the error toast covering the map |
| Climate Central | `climate-central.png` | A light-weight serif display at large size reads as authoritative without shouting; a narrow reading measure | A centered banner hero with no content in it |
| IWQIS (Iowa) | `iwqis.png` | The domain vocabulary: nitrate, discharge, sensors, plainly named | Map-thumbnail tiles, orange buttons with drop shadows, rounded beige nav cards |
| Global Forest/Nature Watch map | `gfw.png` | A thin left rail and a map-first workspace; a scale and coordinates in the corner; an analysis panel that docks beside the map | A modal welcome wall that blocks the tool; neon pink against satellite imagery |
| The Pudding | `pudding.png` | Issue number plus date in a mono face, like a publication; a confident, opinionated headline type | Cartoon logo and icon nav: too playful for a judged science entry |
| Reuters Graphics | `reuters-graphics.png` | A clean grotesk, generous whitespace, a newsroom index | n/a (index page only) |
| waterdata.usgs.gov | (403 for headless browsers) | n/a | n/a |

## Principles we take into Flush Alert

1. **Every chart carries its source and its rule.** There's a "Data: USGS … Historical backtest." line under each figure, and legends state the threshold behind each color (OWID, NWD).
2. **Say when.** The replay date sits in large type beside the map, and every number states its period (Drought.gov).
3. **Serif headlines, sans body, mono for data labels.** An editorial serif for authority, a highly readable sans for prose, and tabular numerals for every figure (OWID, Pudding).
4. **Direct labels over legends** wherever the line can carry its own name (OWID).
5. **One accent reserved for alerts.** Every reference with a rainbow of statuses reads as noisy. We use slate and river blue for everything, plus one alert color.
6. **No boxes around everything.** Separate sections with rules and whitespace, not shadowed cards (we avoid what Drought.gov and IWQIS do).
7. **The tool is never blocked.** No welcome modal, no spinner wall. Data are static JSON and the replay renders on first paint (we avoid what GFW does).
