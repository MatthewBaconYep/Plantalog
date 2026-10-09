# Handoff: Leaf Log

## Overview
Leaf Log lets a user record the date each new leaf appears on a plant (best for climbing and upright plants) and see the rhythm of growth over time. It is a per-plant feature, **off by default**, switched on in Edit Plant. When on, the View Plant card gains a Leaf Log button; tapping it (or swiping left) slides the card over to reveal a Leaf Log panel attached to its right edge.

Target codebase: `MatthewBaconYep/Plantalog` (branch `main`), file `plantalog.jsx`. Relevant existing pieces: `PlantDetail` (View card, `.detail-hero`, `.detail-panel`, `.sheet-grab`), `PlantModal` (Edit card, `.pm-*`), the existing calendar popup (`.cal-popup-overlay`), and the `.dark` token block.

## About the Design Files
`Plantalog Leaf Log.dc.html` is a **design reference built in HTML**, a prototype showing intended look and behavior. It is not production code. Recreate it inside `plantalog.jsx` using the app's existing patterns (its CSS classes, tokens, date helpers, Supabase save path). Open the file in a browser (keep `support.js` and `img/` beside it).

The file contains several turns of exploration. **Only these are final:**
- **3a**: View Plant + Leaf Log, light
- **3b**: Edit Plant switch, light ("Action row" tab is the chosen placement; "Health card" is kept only for comparison)
- **4a / 4b**: the same two screens in dark mode
- From **2a**, only the plant card leaf badge (see below). The rest of Turns 1 and 2 is superseded.

Use the "How much data" switcher above each turn to view: No leaves, 1 leaf, 3 leaves, 1 year, 3 years.

## Fidelity
**High fidelity.** Final colors, type, spacing and interactions. Match pixel values below, mapping to existing app tokens where they already exist.

## Data model
No schema change. Plants are stored as one `data` JSON record per plant in Supabase. Add two fields:
- `leafLog: boolean`, default `false`
- `leaves: string[]`, ISO dates (`YYYY-MM-DD`), kept sorted ascending. Duplicate dates are allowed (two leaves the same day).

Turning `leafLog` off hides the UI but **keeps** `leaves`. Leaf dates are **not** included in spreadsheet export/import for now.

## Screens / Views

### 1. View Plant card with Leaf Log (3a light, 4a dark)
Phone viewport in mock: 372px wide content. The View card and the Leaf Log panel sit side by side on one horizontal track (View 372px + panel 279px = 651px).

**Closed state (Leaf Log on)**
- View card top corners: normally `30px 30px 0 0`. With Leaf Log on, the top right corner is square: `border-radius: 30px 0 0 0`, reading as the card continuing off screen to the right. With Leaf Log off, unchanged.
- Hero (photo variant shown, 216px tall). Header buttons, top right, `top: 24px; right: 16px`, row with `gap: 6px`, placed low enough to clear the 4px sheet-grab bar:
  - **Leaf Log** (only when `leafOn`): pill, `padding: 8px 16px`, Figtree 13px / 800, `line-height: normal`, `white-space: nowrap`, no icon. Light and dark: bg `#2f7d52`, text `#fff` (light uses `#f2fbf5`).
  - **Edit**: same size as Edit Plant's Save button: `padding: 8px 20px`, Figtree 13px / 800, `line-height: normal`. Light bg `#a3450a`; dark bg `#8c491a`; text `#fff`.
  - Leaf Log sits left of Edit. Both buttons are ~32px tall.

**Open state**
- Track translates `-279px`; the panel occupies the right 75% of the screen and the View card's right ~25% (93px) stays visible.
- The visible strip of View is **not dimmed or blurred**. Tapping it closes Leaf Log.
- Hero right edge fades out via a mask: last 56px, 12-stop smoothstep (`e = t*t*(3-2t)`), alpha `1 - p*e` where `p` is open progress 0..1. No fade when closed. Do not use an overlay gradient (it produced visible seams).
- Leaf Log + Edit header buttons fade out: `opacity = max(0, 1 - p*2.5)`, `pointer-events: none` once `p > 0.05`.

**Leaf Log panel** (279px wide, bg = page ground, `border-radius: 0 35px 0 0`, column)
- **Title row**: `padding: 12px 10px 0 14px`, flex, `align-items:center`, `gap: 6px`.
  - "Leaf Log": Caprasimo 30px, line-height 1.05, `--text`, nowrap. No plant name, no header band.
  - Right slot 104px wide (same as tile column) containing **New Leaf** button: `width: 100%; height: 36px`, pill, Figtree 13px / 800, nowrap, plus icon 14px stroke 3, `gap: 4px`. Light: bg `#0f4438`, text `#f2f0d8`, hover `#15644a`, shadow `0 1px 2px rgba(46,43,37,.14)`. Dark: bg `#2f7d52`, text `#fff`, hover `#37905f`, no shadow.
- **Body**: `padding: 10px 10px 12px`, row, `gap: 6px`, stretch. Timeline (flex 1) on the left; 104px column on the right. Top of Timeline aligns with top of the first tile.

**Timeline card**
- bg `--surface` (light `#fffdf8`, dark `#2b2823`), radius 16px, border `1.5px solid` sage (light `#7a8a5e`, dark `#8fa070`), `padding: 10px 4px 10px 2px`, no shadow.
- "Timeline": Caprasimo 15px, `padding: 0 8px`.
- Empty state (`leaves.length === 0`): Figtree 12px / 600, `--muted`, margin `8px 8px 0`: "No leaves recorded yet. Tap New Leaf to record the first one."
- Scroll area: `flex:1; overflow-y:auto`, **scrollbar hidden**, `margin-top: 8px`, `padding-bottom: 12px`. Newest first.
- **Leaf row** (min-height 26px): 52px rail column + date.
  - Rail: 2px line at x=25px, light `#e6dbc7`, dark `#6e665a`. Top half hidden for the newest row; bottom half hidden for the oldest.
  - Marker: Lucide `leaf` icon 14px, stroke 2.75, inside a 20px circle filled with `--surface` (masks the rail). Newest: growth green (light `#2f7d52`, dark `#5fbf8a`). Older: light `#8fb79c`, dark `#5f8a6e`.
  - Date: button, Figtree 13px / 800, `--text`, format `Sep 6, 2026`, `padding: 3px 6px; margin-left:-6px; radius 8px`. Hover bg light `#f2ece0`, dark `#3b362f`. **Tap opens Edit Leaf popup.**
- **Gap segment** between consecutive leaves:
  - Height `gapPx = max(yearBreak ? 70 : 0, round(30 + min(d,120)*1.4 + max(0,d-120)*0.4))`, d = days between.
  - Rail continues through it.
  - Day pill centered on the rail: text `49d` (days + "d"), Figtree 11.5px / 800, `line-height:1`, `height: 20px`, `padding: 1.5px 8px 0` (the 1.5px top nudge optically centers Figtree digits), radius 999px, `border: 2px solid --surface`. Light bg `#f2ece0` text `#4a453c`; dark bg `#3b362f` text `#e8dfcd`. Default vertical position 50%; if a year break is within 22% of center, move pill to 26% or 74%.
  - **Year break**: for each Jan 1 crossed, a horizontal line positioned proportionally (clamped 8%..92%): two 1.5px lines (rail color) either side of the year label (Figtree 10px / 800, letter-spacing 1.1px, `--muted`). A 10x16px `--surface` patch interrupts the rail around it so the line never crosses the rail.
  - The newest row in a new calendar year also gets a year header row (20px) above it.

**Right column (104px, column, gap 6px)**
- **Five stat tiles**, each exactly `height: 58px`, `padding: 9px 10px`, radius 16px, column `justify-content: space-between`, nowrap.
  - Light: bg `#e3f2e6`, border `1.5px solid #9ccaa9`, value `#1c5436`, label `#3f6b4e`.
  - Dark: bg `#143a2c`, border `1.5px solid #2a6a4c`, value `#b6e3c6`, label `#8fc4a3`.
  - Value: Caprasimo 19px, line-height 1.1. Label: Figtree 8.5px / 800, uppercase, letter-spacing .6px (Leaves Recorded uses .3px to clear the edge), line-height 1.25.
  - Tiles, in order:
    1. **Leaves Recorded**: count.
    2. **Average gap**: `round((last - first) / (n - 1))` + "d"; "--" if n < 2.
    3. **Since last**: days from newest leaf to today + "d"; "--" if n = 0.
    4. **First recorded**: `M/D/YY`, no leading zeros (e.g. `3/4/24`); "--" if none.
    5. **History**: days from first leaf to today: `< 60` then "N days"; `< 12 months` then "N mo" (days/30.44, rounded); else years to 1 decimal + " yr"/" yrs". "--" if none.
- **Last Year graph** (fills remaining height, `flex:1`): bg `--surface`, border `1.5px solid` sage (same as Timeline), radius 16px, `padding: 10px 9px 10px 10px`, gap 8px.
  - Title "Last Year": Figtree 8.5px / 800 uppercase, letter-spacing .6px; light `#6f6658`, dark `#a99e8c`.
  - 12 rows, current month first, back 11 months, distributed with `justify-content: space-between`. Row height 15px, gap 5px: month label (24px wide, Figtree 9.5px / 800), track (flex 1, 8px tall, pill), count (9px wide, right aligned, 9.5px / 800, blank when 0).
  - Track light `#efe4cd`, dark `#3b362f`. Fill sage, light `#7a8a5e`, dark `#8fa070`. Fill width `max(14%, count/maxCount*100%)`, 0 when empty.
  - Label ink: has leaves, light `#201e1d` / dark `#f0e9dc`; empty, light `#8a8071` / dark `#7d7464`. Count ink light `#4a453c`, dark `#d8cfbf`.

**Confirmation toast** (after Add): bottom of the panel, `left/right 10px; bottom 12px`, bg `--text`, text `--ground`, radius 12px, `padding: 11px 13px`, Figtree 12.5px / 600, text "Leaf recorded today" (relative: today / yesterday / Sep 6). Auto-dismiss 4s. **No Undo.**

### 2. New Leaf / Edit Leaf popup (full screen)
Covers the whole phone, not just the panel; behaves like the app's other date fields (`.cal-popup-overlay`).
- Backdrop: `rgba(28,25,20,.52)`, centered, `padding: 22px`. Tap backdrop = Cancel.
- Card: full width, radius 22px, `padding: 16px 14px`. Light bg `#f2e6d2`; dark bg `#35302a`. Shadow light `0 18px 50px rgba(28,25,20,.42)`, dark `rgba(0,0,0,.55)`.
- Header (centered): kicker "New leaf" or "Edit leaf" (Figtree 9px / 800 uppercase, letter-spacing 1.1px, muted); date (Caprasimo 19px) shown as **"Today" / "Yesterday" / "Tomorrow"**, otherwise `Sep 6, 2026`.
- Month nav: 30px round prev/next buttons (light bg `#fffdf8` ink `#474238`; dark bg `#3b362f` ink `#e8dfcd`), month title Figtree 13px / 800. Next disabled beyond the allowed future window.
- Weekday row S M T W T F S (10px / 800, `#8a8071`). Day grid 7 cols, gap 3px, cells 34px tall, radius 12px. In-month light bg `#fffdf8` + small shadow, dark bg `#3b362f` no shadow. Out-of-month light `#f7eeda`, dark `#2b2823`. Today: inset 1.5px growth-green ring. Selected: growth-green fill (light `#2f7d52`, dark `#5fbf8a`) with ink light `#fff` / dark `#04210f`. A 4px dot under days that already have a leaf. Days more than 7 days in the future are disabled (opacity .38).
- Buttons row (gap 6px, each flex 1, min-height 40px, pill, Figtree 13px / 800):
  - **Delete** (Edit only, leftmost): light bg `#f6d6d0`, text + 1.5px border `#a32e22`; dark bg `#4a1f1a`, text + border `#ffb3a8`.
  - **Cancel**: light bg `#fffdf8`, border `1.5px #c9bda6`, text `#201e1d`; dark transparent, border `#5a5346`, text `#e8dfcd`.
  - **Add** (new) / **Save** (edit): light bg `#0f4438` text `#f2f0d8`; dark bg `#3f9d6d` text `#04210f`.
- New Leaf opens on today. Edit opens on the tapped leaf's date and month.

### 3. Delete confirmation
Over the popup, full screen. Backdrop `rgba(28,25,20,.4)`, padding 22px. Card radius 22px, `padding: 16px 14px 13px`; light bg `#fffdf8`, dark `#35302a`.
- Title: "Delete this leaf log?" Caprasimo 18px.
- Subtitle: the leaf's date (`Sep 6, 2026`), Figtree 12.5px / 600, muted.
- Buttons: **Cancel** (light bg `#e9dcc3` text `#201e1d`; dark transparent, border `1.5px #5a5346`, text `#e8dfcd`) and **Delete** (light bg `#a32e22` text `#fff`; dark bg `#7d2e24` text `#ffd5cc`).
- Confirm removes that one entry (one instance if duplicates) and closes both layers.

### 4. Edit Plant switch (3b light, 4b dark)
In the bottom action row, left of Clone and Delete: a pill (`flex: 1.25`, min-height 44px, Figtree 13px / 800, nowrap, `gap: 8px`, no icon) reading "Leaf Log" with a 34x19px switch (15px thumb, 2px inset).
- Light: pill bg `#e3f2e6`, text `#1c5436`; switch on `#0f4438`, off `#d8ccb6`.
- Dark: pill bg `#143a2c`, text `#b6e3c6`; switch on `#3f9d6d`, off `#544e43`. Clone dark bg `#3b362f`; Delete dark bg `#4a1f1a` text `#ffb3a8`.
- **Tapping the switch** toggles `leafLog`. **Tapping anywhere else on the pill** shows a tooltip above it (left aligned, 214px wide, radius 14px, `padding: 10px 12px`, Figtree 12.5px / 600, line-height 1.45, 10px rotated-square caret at left 28px): leaf icon (14px) on the left, then "Record new leaves. Best for climbing and upright plants." Light: bg `#201e1d`, text `#f5ead8`, icon `#8fd6ac`. Dark: bg `#f0e9dc`, text `#201e1d`, icon `#15644a`. Dismiss on tap or after 4s.

### 5. Plant card leaf badge (from 2a)
On Home list cards, after the age text (`gap: 5px`): a 16px circle, bg `#e3f2e6`, leaf icon 10px stroke 3 in `#2f7d52`, title "N leaves recorded". Show only when `leafLog` is on **and** at least one leaf is recorded.

## Interactions & Behavior
- **Open**: tap Leaf Log, or swipe left on the card. **Close**: tap the visible View strip, or swipe right.
- Swipe: horizontal drag starts after 8px of movement when |dx| > |dy|; a vertical move of more than 8px first hands off to normal scroll / sheet drag-down. During drag the track follows the finger, clamped to [-279, 0]. On release: from closed, open if dragged past 50px; from open, stay open unless dragged more than 50px back. Suppress the click that follows a drag.
- Track transition `transform .38s cubic-bezier(.22,.8,.24,1)`; none while dragging. Corner radius change `.2s`.
- Swipe is only active when `leafLog` is on. Must coexist with the existing sheet drag-to-dismiss on `PlantDetail`.
- Turning `leafLog` off closes the panel and any popup.
- Popup entry: `panelDown .2s cubic-bezier(.16,.84,.44,1)`. Toast/tooltip entry: `toastUp .2s cubic-bezier(.34,1.28,.64,1)`.
- No Undo anywhere in this feature.

## State
- Persisted per plant: `leafLog`, `leaves`.
- UI: `open` (panel), `drag` (px or null), `sheet` (`null | {mode:'add'} | {mode:'edit', orig: date}`), `pickedDate`, `calMonth`, `confirmDelete`, `toast`, `tooltip`.
- Save on Add / Save / Delete through the existing plant save path (with the app's existing offline / sync-failed handling).

## Design tokens
Light (Organic, as used by the app): ground `#f5ead8`, surface `#fffdf8`, text `#201e1d`, muted `#6f6658`, border `#e6dbc7`, strong border `#c9bda6`, primary `#0f4438`, primary ink `#f2f0d8`, terracotta action `#a3450a`, growth green `#2f7d52`, sage `#7a8a5e`.
Dark (from the app's `.dark` block): ground `#1f1d1a`, surface `#2b2823`, raised `#35302a`, input `#3b362f`, text `#f0e9dc`, muted `#a99e8c`, border `#3a352d`, strong `#544e43`, primary `#15644a`, primary button `#3f9d6d` / ink `#04210f`, terracotta `#8c491a`, danger `#ffb3a8` on `#4a1f1a`. Dark separates surfaces by color, no shadows.
Fonts: Caprasimo (display), Figtree (UI). Icons: Lucide at stroke 2.75. Radii: 16px tiles/cards, 22px popups, 999px pills.

## Assets
- `img/p1.jpeg`, `img/p4.jpeg`, `img/p6.jpeg`: sample plant photos for the mock only.
- Icons are inline Lucide (`leaf`, `plus`, `chevron-left/right`, `x`).

## Screenshots
`screenshots/` (2x, 3 years of sample data):
- 01 / 06: View Plant, Leaf Log closed (light / dark)
- 02 / 07: Leaf Log open
- 03 / 08: New Leaf popup
- 04 / 09: Edit Leaf popup
- 05 / 10: Delete confirmation
- 11 / 12: Edit Plant action row switch with tooltip

## Files
- `Plantalog Leaf Log.dc.html`: the design (open in a browser). Sections: Turn 4 (dark, 4a/4b), Turn 3 (light, 3a/3b), then earlier explorations.
- `support.js`: runtime needed to open the design file.
- `img/`: sample photos.
