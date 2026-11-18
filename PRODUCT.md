# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + TypeScript static site, D3 (d3-geo + us-atlas TopoJSON for the SVG map), reading JSON exported by the Python pipeline into `site/public/data/`. Deployed to GitHub Pages. Chosen by Claude when the user asked which choice gives the best chance of winning: fastest load, fewest moving parts, and code sitting next to the live site.

## Users

- **Primary:** judges of the Xylem Global Student Innovation Challenge 2026 (High School track, Problem Statement #2: Water Quality) and Xylem engineers. They review many entries in a short sitting and want to see within seconds whether the claim is real and the method is sound.
- **Implied end user (shown, not served live):** water-quality sampling programs and drinking-water utilities (for example Des Moines Water Works) that decide when to collect nitrate samples.

## Product Purpose

Flush Alert shows that after a drought, monthly nitrate sampling misses the surge in the first wet spring, and that a trigger using **only river flow** can tell sampling programs, weeks ahead, when and where to take extra samples. A few triggered samples fix most of the load-estimation error. Success means a judge understands the blind spot, believes the backtest, and sees that the method scales to gauges with no nitrate sensor.

## Positioning

The method needs only river flow. It works at any USGS discharge gauge, in any state, with no new hardware, and it targets **sampling schedules** rather than concentration forecasts. It complements the University of Iowa's nitrate forecasting system (about 60 Iowa sensors) rather than competing with it.

## Operating Context

- Judges open a public URL, sometimes on a phone, often from the project page or the 3:30 video.
- A replay of past springs (2025 by default, 2013 if the data covers it) is the demo. Live November data will show few alerts, and that is expected.
- The alert preview is a mock-up. No real messages are ever sent.

## Capabilities and Constraints

- Free public data only (USGS Water Data APIs, parameter 99133 nitrate sensor and 00060 discharge). No paid APIs, no map-tile keys, no hardware.
- Every result is a **historical backtest on sensor data, not a live deployment**, and must be labeled that way.
- Interpolation is shown alongside a fair LOADEST-style regression baseline.
- Only sensor sites can be validated. Flow-only gauges are an extrapolation.
- Post-drought springs are rare, so results carry confidence ranges and a threshold sensitivity check.

## Brand Commitments

- Name: **Flush Alert**.
- Tone (from brief): formal, scientific, trustworthy, like a government data portal crossed with a top newsroom graphics desk.
- One alert color, reserved only for alerts.
- Banned: purple or blue gradients, glassmorphism, emoji, generic AI hero copy, three-icon feature rows, stock illustration, rounded cards with drop shadows, and filler text.

## Evidence on Hand

- USGS daily nitrate and discharge cached in `data/raw/`, with results CSVs in `results/`.
- Real-world hook: Des Moines' 2025 lawn-watering ban during the nitrate crisis.
- Team name: **Mustangs** (confirmed by the user). Member names: not yet provided. Use a placeholder, never invent them.
- No testimonials, partners or deployments exist. Do not imply any.

## Product Principles

1. Every number on screen traces to a CSV in `results/`.
2. Honesty over impact: label the backtest, show the limitations, show the fair baseline.
3. The demo never breaks: static files, instant load, works on a 375 px phone.
4. Show the mechanism, not slogans.

## Accessibility & Inclusion

WCAG AA contrast, keyboard-operable controls (including the map and scrubber), `prefers-reduced-motion` honored, and Lighthouse accessibility ≥ 90.
