# Plantalog: spec addendum and defect list

Companion to `Plantalog handoff.md`. Read this before touching `plantalog.jsx` again.

## How to use this document

1. **Read this file end to end before changing anything.** §1 says why the previous rounds drifted. §5 is the work order.
2. **Work from the screen extracts, never from prose.** `screens/` holds 55 standalone HTML files, one per design screen, with the real inline styles. Open the one screen you are working on. They are 2 to 20KB each; there is no reason to guess a value.
3. **Measure before you look**, per §4. Every defect in here was invisible at a glance and obvious in a measurement.
4. **When a comp names a hex, write the hex**, per §8.4. Do not map a one-off colour onto the nearest token.
5. **Copy is part of the design.** §10 exists because the previous rounds diffed styles and never read the words.
6. **Report what you did not do.** At the end, list the sections you completed, the sections you skipped, and why. A silent partial is what produced each of the last two rounds of findings.

Anything genuinely ambiguous: say so and stop, rather than deriving a value. Every question asked so far has turned out to have a real answer somewhere in the extracts.

---

## 1. Where the disconnect is

The build is not failing on judgement. It is failing on measurement and on collisions with the old code. Four things, in order of how much damage they do:

**1. The concept files are too large to actually read.** `Plantalog Concepts.dc.html` is roughly 900KB of inline-styled markup. Nothing reading it can hold a screen's worth of values in view, so the implementation was built from the prose spec instead. That explains the pattern exactly: everything the spec states as a *number* is correct in the code (the colour tokens, the five-step radius scale, all four easing curves, the 102px header, the 44px minimum), and everything the spec states as a *description* was approximated from the old build.

Fix: `handoff-assets/screens/` now holds 37 standalone HTML files, one per design screen, extracted verbatim from the concepts file with their inline styles intact. Each is 2 to 20KB. Open the one screen being worked on, read the real values, port them. Never work a screen from prose again when an extract exists.

**2. New classes were written to spec; old screens kept their old geometry.** The redesign added a correct shared vocabulary (`.score-tile`, `.plant-card`, `.pc-body`, `.health-edge`, `.plant-initial`, `.status-strip`, `.primer-card`, `.wake`) and Home uses it correctly: measured live, Home's plant card is 56px tall with a 5px health spine, the header is 102px, the column is 390px, all matching the design. But Water and Repot still wrap those shared parts in their own older rules, and the two fight. Section 3 lists the measured collisions.

**3. There is no feedback loop.** The implementation has never been compared against the design at the same size. Any single number can drift and nothing catches it. Section 4 gives a measurement pass that catches drift mechanically instead of by eye.

**4. Motion was implemented as CSS, not as sequence.** The curves and the keyframes are all present and correctly named. What is not verifiable from the code is the two rules that make the motion read as composed: exits shorter than entrances, and only one element moving at a time. Those need to be watched at speed against `Plantalog Motion.dc.html`, not diffed as values.

---

## 2. Measured against the design: what is already right

Do not touch these. Verified live in the current build:

- Column 390px, header 102px, wordmark-left / mark-right lockup, mark 30x46.
- All five colour token groups, light and dark, including the water and potting panel pairs and the four health bands.
- Radius scale: `--r-xs 6 / sm 12 / md 16 / lg 22 / xl 30 / pill 999`, and the elevation triplet.
- All four curves, with the correct names.
- Home filter tiles: 5-column grid, 6px gap, 16px radius, 21px Caprasimo number over an 8px/800/0.6px uppercase label.
- Health bar: 7px tall, 2px gaps, pill segments, 9px/1.1px uppercase label with the percentage at 13px/800.
- Home plant card: 16px radius, 5px spine, 42px thumbnail at 12px radius, 14px/700 name, three 33px stat columns.
- Nav: pill, 9px 6px padding, 4 equal columns, 20px icons at 2.75 stroke, 9px/800 labels.
- Reduced-motion block, and it correctly covers the new animations.

---

## 3. Verified defects

Measured in the running build, not inferred.

### 3.1 Water and Repot cards have no health spine

`.health-edge` renders at **0px wide** inside `.water-card` and `.repot-card`. The width lives only on `.plant-card > .health-edge`, and the checklist cards are not `.plant-card`. The element is in the DOM, so this reads as a missing detail rather than an error, but the health colour is the one thing that carries across all three lists.

```css
.plant-card > .health-edge,
.water-card > .health-edge,
.repot-card > .health-edge { width:5px; flex-shrink:0; }
```

### 3.2 Water and Repot rows are 72px tall; the design is 56px

`.water-card` sets `padding:8px 10px` and then contains `.pc-body`, which sets `padding:7px 10px 7px 9px`. The padding is applied twice. A 42px thumbnail plus 7px top and bottom is 56px, which is what Home measures and what the design draws. Every checklist row is 29% taller than designed, which compounds down the list and is the single most visible reason the checklists do not look like the comps.

Remove the padding from `.water-card` and `.repot-card`; let `.pc-body` own it, as it does on Home.

### 3.3 Copy drift on the Water header

Design (7a): **"3 plants are thirsty today"**. Build: "22 plants need water today". The design copy is the decided copy. Repot design (7c/14c): **"2 plants ready for a new home"**, which the build has right.

### 3.4 Check the same collision everywhere `.pc-body` is reused

3.1 and 3.2 are the same mistake twice: a shared part reused inside a container that still carries its own box. Audit every wrapper that contains `.pc-body`, `.plant-thumb`, `.health-edge`, or `.stat-tiles` for padding, gap, or radius of its own, and delete it. Suspects, from the class inventory: `.water-card`, `.repot-card`, `.grave-row`, `.rd-row`, `.sched-date-card`.

---

## 3.5 Filter tile selected states

Measured, not inferred. The design has one selection idiom: **the fill inverts to the band's deep step and the text goes near-white.** Unselected is tint-fill with deep text; selected swaps them. Home's All tile already does this (`#0f4438` on `#f2f0d8`), and the Health picker in `6a` does it for a band (`background:#0a7a43; color:#f2fbf5`).

| Band | Unselected fill / ink | Selected fill / ink |
| --- | --- | --- |
| All | — | `#0f4438` / `#f2f0d8` |
| Thriving | `#c8f2d9` / `#0a5c34` | `#0a7a43` / `#f2fbf5` |
| Good | `#e4f7c8` / `#3f6b16` | `#3f6b16` / `#f6faee` |
| Caution | `#ffe6c0` / `#8a4c06` | `#8a4c06` / `#fff8f2` |
| Dying | `#ffd7d2` / `#97281d` | `#97281d` / `#fdeceb` |

The selected fill is the band's deep **ink** step, never its bar colour. The bar colours (`#0f9d58`, `#7cc63f`, `#f2a13b`, `#e0483a`) are for the health bar and the card spine only, and none of them carries near-white text.

A second, louder idiom exists in the design for the same job, on the Health picker and the selected room chip: the inverted fill plus a double ring, `box-shadow: 0 0 0 2.5px <deep>, 0 0 0 4.5px <tint>` (`#0a7a43` / `#c8f2d9` on the picker, `#f2a13b` / `#ffe6c0` on the chip). The Home filter tiles do not use it. Fill inversion alone is the tile idiom; keep the ring for the picker and the chips so the two controls stay distinguishable.

---

## 4. How to verify, per screen

For each screen, in this order:

1. Open the matching file in `handoff-assets/screens/`.
2. Set the browser to a 390px column.
3. Measure, in the running app, and compare to the extract: outer height of the repeating row, thumbnail box, radius, the paddings and gaps of the row, every font size and weight in it, and the colour of every text run.
4. Only then look at it.

Numbers first, appearance second. Every defect in section 3 is invisible at a glance and obvious in a measurement.

Screen extracts, and what each is authoritative for:

| Extract | Authoritative for |
| --- | --- |
| `24a-home.html` | Home, mixed content. The reference for the whole shared vocabulary |
| `24b`, `24d` view-plant | Detail hero with a photo and the collapsed no-photo variant |
| `25a-name-field.html` | The 60-character cap, all three states |
| `23a-notification-primer.html` | Primer popup, left-aligned, exact copy |
| `21a`, `21b` water offline / sync-failed | Status strips |
| `7a`, `7b`, `7c`, `7d` | Water and Repot lists, both empty states |
| `6a`, `6b`, `14d` add / edit plant | Form cards, steppers, panels, bottom actions |
| `13a` … `13h` | Score tooltip, Rooms tab, Edit Room, photos, notes, date picker |
| `8a`, `8b`, `8c` | Delete choice, Graveyard, Recently Deleted |
| `19a`, `19c`, `19e`, `20a`, `20d` | Auth, loading, reset flow, field-level errors |
| `24e`, `7e`, `6c`, `5c`, `23b` | Dark counterparts |
| `util-9a` … `util-9e` | Utilities, grouped rows, and Notifications (`util-9c`) |
| `util-10a` … `util-10h` | Export, Import, import summary, OOT schedule sheets, light and dark |
| `util-11a`, `util-11b`, `util-12a` … `util-12c` | Printed watering guide |

The `util-` extracts come from `Plantalog Utilities.dc.html`. They were missing from the first pass, which is why the Utilities radii had to be guessed.

### Utilities radii, settled

`.sched-date-card`, `.util-section` and `.notif-panel` are all **16px**. There is no `22px` anywhere in `Plantalog Utilities.dc.html`: every grouped-row card, sheet inner card, segmented control, dashed CTA, and the import summary and warning boxes are 16px. `--r-lg` (22px) belongs to the score tooltip and the View Plant water and potting panels, not to Utilities.

Other measured Utilities values, since they were also never extracted: section label 10px/800 at 1.2px tracking (not 9px), 5px gap between cards within a group, an 11px spacer between groups, row padding 11px 14px, row label 14px/700. The data-sheet grab handle is 42x4 `#cfc0a6`, which is deliberately not the detail sheet's 38x4 `#d8cbb4`; keep both.

---

## 5. Order of work

Sections 3 and 5 are closed; §3.1 and §3.2 were verified fixed. This is the order for the current run, which is §6 through §10.

1. **§6, the six reported by the user.** Nav tint, crossfade flicker, Notifications header, OOT preview, Edit form, plus the badge question in 6.7.
2. **§7 and §8, the swept defects.** Status strips first: they are two components rendered as one and they are the most wrong things left.
3. **§8.4, the token-substitution audit.** Do this as a pass over the whole sheet, not per screen. It is the same error six times and it will keep recurring until it is named.
4. **§10, copy.** Mechanical, and it is the cheapest large win left. Start with the three Utilities sublabels and the missing empty states.
5. **§10, last block: reissue the printed watering guide.** The generator is still emitting the pre-redesign version. Its own task, with its own estimate, not a copy fix.
6. **§9, dark.** Four small items. Read 9.1 before touching any dark value.

Two rules for the run: measure before looking, per §4; and when a comp names a hex, write the hex, per §8.4.

Do not start a redesign pass. The vocabulary is correct. What is left is arithmetic.

---

## 6. Round two: defects found in the second build

Measured against the extracts in the build dated after the dark-mode pass.

### 6.1 The nav tints the active tab; the design never does

```css
.nav-btn.active.water { color:var(--water-ink); }   /* #12556e on #0f4438 */
.nav-btn.active.repot { color:var(--accent); }      /* #a3450a on #0f4438 */
```

Both sit on the green nav, where a dark navy and a rust read as a muddy fill rather than a selected state, and neither passes for legible. Every design screen uses one rule for all four tabs: active is `#f2f0d8`, inactive is `rgba(242,240,216,.78)`. Delete both rules. `.nav-btn.active { color:var(--primary-ink) }` is already correct and is the whole treatment. The tab-pick animation stays.

The domain colours belong to the Water and Repot *screens*, not to the nav. The nav is the one element that does not change between tabs.

### 6.2 The crossfade flicker is a blank frame, and it is one line

```css
.xfade-out { display:none !important; }
```

A later override kills the outgoing layer outright. The incoming layer is `xfadeIn .2s ... .06s backwards`, so it holds opacity 0 through its 60ms delay, and with the outgoing gone there is nothing on screen for those 60ms. Every tab switch flashes the bare ground colour. It is reproducible in a screenshot taken during the transition: header, list and all content absent, nav still painted.

Delete that override. The outgoing layer must stay mounted and absolutely positioned for its full 160ms, which is the entire point of the two layers and of exits being shorter than entrances. If the override was added to stop a scroll or layout jump from the absolutely positioned outgoing layer, fix that with `overflow:hidden` on `.xfade`, not by removing the layer.

### 6.3 Notifications header

Three things, from `util-9c`:

- Title is **26px**, not 24px. Remove the `:has(.rd-back) h1 { font-size:24px }` override.
- The back button and title block sit at the **bottom** of a fixed 102px header, as on every other header (`margin-top:auto`). The build centres them vertically, which is the main reason it reads wrong. The header is 102px fixed, not `height:auto; min-height:102px`.
- The time pill is a **white** `#fff` pill hugging its content, `padding:7px 15px`, 13px/800 in the panel ink, showing 12-hour time (`8:00 AM`). The build renders a wide tinted pill showing `08:00` from a native time input. Also: when a reminder is off, the design drops its whole Time row to `opacity:.45`.

Row dividers inside the panels are `1px` at 14% of the panel ink, inset 14px each side: `rgba(23,98,127,.14)` on water, `rgba(163,69,10,.14)` on potting.

### 6.4 OOT Water Schedule preview

```css
.sched-preview { background:var(--sand); border:1.5px solid var(--border-strong); border-radius:var(--r-sm); }
```

The design (`util-10a`) is `background:#efe6d4`, `border:1.5px solid #e0d4bd`, `border-radius:16px`, `padding:10px`, `height:150px`. So: 16px not 12px, and neither colour is the token it was mapped to. `--border-strong` (#c9bda6) is visibly darker than #e0d4bd and draws a hard box where the design draws a faint one.

The thumbnail itself is also wrong. In the design the SVG is `width:100% height:100%` on a `0 0 200 116` viewBox with `preserveAspectRatio="xMidYMid meet"`, so it fills the 150px box edge to edge. The build renders it at roughly half width, centred, leaving a wide empty margin.

### 6.5 Add and Edit Plant

The `pm-*` rules are close. Four real divergences:

1. **The name field rule is the wrong colour.** Design: a separate 2px bar in `#17627f` with `border-radius:999px` under the value. Build: `border-bottom:2px solid var(--border)` (sand) going to `var(--accent)` (rust) on focus. The rule is water blue, pill-rounded, at rest and on focus. Only the at-cap coral state overrides it.
2. **The Got card is a fixed 112px** and both cards in that row are `justify-content:center; gap:3px`. Value is 13px/800 with a 12px calendar icon; the age line under it is 10px/700 `#8a8071`.
3. **The Room card has asymmetric padding**, `9px 0 10px`, with the label inset `0 14px` and the chip scroller padded `6px 14px 7px`, so chips bleed to the card edge as they scroll. `.pm-card`'s uniform `9px 14px 10px` cuts the scroller short and makes the overflow look like a bug.
4. **No selected state exists for `.pm-room-chip`.** The design uses the double ring from §3.5: `box-shadow:0 0 0 2.5px <chip fill>, 0 0 0 4.5px <chip tint>`, keeping the chip's own fill.

### 6.6 Not a defect: the column proportions

The app is `max-width:390px; min-height:100dvh`, so in a desktop browser it is 390px wide by the full window height and therefore taller than the 390x800 mockups. That is correct and deliberate, per handoff §9. Compare proportions in a 390x800 viewport, not a desktop window.

### 6.7 Water tab badge, now specified

Keep it. It shows the number of plants due for water today. It was undesigned, so here it is, built from values the system already uses.

- Shape: pill, not circle. `border-radius:999px`, `height:16px`, `min-width:16px`, `padding:0 4px`, so two digits fit without crushing. Two digits are the common case in this app.
- Fill `#e0483a`, ink `#fffdf8`. `--danger` (#a32e22) is too dark to read against the nav green; `#e0483a` is the Dying bar colour and is already the app's "needs attention" red.
- Type 9px/800, matching the nav labels exactly. The badge is a label, not a number display.
- Position: top right of the icon, not of the button. The pill's left edge clears the icon's right edge by 1px and its top sits 2px above the icon's top.
- Above 99, show `99+`. Hidden at zero: never a `0` badge, never a bare dot.
- Dark: unchanged. `#e0483a` on `#15644a` reads the same.

The build has a 14px circle at 8px type in `--danger`. A circle plus two digits is why it currently reads as a smudge.

---

## 7. Round two, the sweep

Found by reading the extracts rather than by report. Same class of error as §3: the parts were built, the values drifted.

### 7.1 Both status strips are the wrong colour and the wrong shape

The build has offline on `--sand` with plain text, and sync failure on `--warn-tint`. Both are wrong, and they are wrong in a way that loses the distinction between the two.

| Strip | Fill | Ink | Sub-line ink |
| --- | --- | --- | --- |
| Offline (`21a`) | `#ffe6c0` | `#8a4c06` | `#a3450a` |
| Sync failed (`21b`) | `#ffd7d2` | `#97281d` | `#a3372a` |

Offline is the warning colour, sync failure is the error colour. `--sand` appears in neither.

Both are also **two lines, not one**: a 13px/800 headline over an 11.5px/600 sub-line at 1px margin, with a 16px icon at 10px gap, `border-radius:12px`, padding `10px 13px` (offline) and `10px 12px 10px 13px` (sync). The build renders a single 12.5px/600 run, which is why the strips read as a tooltip rather than a status bar.

The Retry button is a **solid** `#97281d` pill with white text, 12px/800, `padding:7px 14px`, not the outlined `1.5px solid currentColor` button in the build.

Copy, decided: "You are offline" / "Waterings you log now will sync when you are back." and "2 waterings did not sync" / "They are saved on this phone."

### 7.2 The primer icon is a 62px circle, not a glyph

```css
.primer-icon { font-size:34px; }
```

The design (`23a`) draws a 62px circle filled `#0f4438` (dark: `#15644a`) holding a 30px stroked icon in `#f2f0d8`. A 34px type glyph is a different object at a different size. While that card is open: headline is **23px** (build 22), body **14.5px** (build 13.5), the primary button is 15px/800 at `padding:16px 0` with `margin-top:24px`, and Not now is **13.5px** at `margin-top:16px` (build 13px).

### 7.3 The hero photo is missing its wash

Design: `filter:saturate(.92) contrast(.97)` on the hero image. The build paints the photo as a plain `background-image` with no filter, so it sits on top of the page instead of in it. This is the design system's `.washed` treatment and it applies to the hero specifically.

Two smaller ones in the same block: the hero content is inset **20px** left and right at the bottom while the close and Edit row above it is inset 16px, a deliberate asymmetry the build flattens to 16px; and the close button carries `backdrop-filter:blur(6px)` behind its `rgba(255,255,255,.22)` fill.

### 7.4 Detail panel stat labels

`.detail-panel-lbl` uses `opacity:.82` on the panel ink. The design names the colour: `#d6ecf7` on the water panel. Opacity on `#eaf6fc` lands near it but not on it, and the potting panel already special-cases itself back to full opacity, which is the tell that the opacity approach was a workaround. Set the colour.

### 7.5 Verified fixed

Water and repot rows now measure 56px with a 5px spine, both matching Home and the extracts. §3.1 and §3.2 are closed.

---

## 8. The rest of the sweep

Graveyard, Recently Deleted, Auth and the date picker, against `8b`, `8c`, `19a` and `13h`.

### 8.1 Auth has lost all of its air

This is the one screen where the spec says the brand gets room, and every vertical spacer on it is short:

| Element | Design | Build |
| --- | --- | --- |
| Spacer above the lockup | 88px | 64px |
| Gap between tagline and fields | 38px | 26px |
| Sign in button, margin-top | 20px | 6px |
| Footer padding-bottom | 26px | 6px |

Nothing else on the screen is wrong: the 42px wordmark, the 38x58 mark, the tagline at 15px on `rgba(242,240,216,.82)` capped at 270px, the 9px/1.1px labels, the pill inputs at `rgba(255,255,255,.1)` with a `1.5px rgba(242,240,216,.3)` border and `14px 20px` padding, the cream submit, the `#ffcb85` links and the footer all match exactly. It is only the spacing, and the spacing is the whole point of the screen.

### 8.2 Date picker

- Card background is `#f2e6d2`, not `--sand` (#efe4cd).
- The card is `width:100%` inside a 22px inset, so on a 390 column it is 346 wide. The build caps it at `max-width:300px`, which makes the whole picker read small.
- **The month header is two lines.** Above the 20px Caprasimo month sits a 9px/800/1.1px uppercase context label naming what is being picked, e.g. "Last watered". The build renders the month alone, so the picker never says which date you are setting. This is the substantive one.
- Weekday letters are 10px/**800** in `#8a8071`. There are two conflicting `.cal-weekdays span` rules in the sheet and the surviving one is 700 in `--text-muted`. Delete the loser.
- Day cells are 13px (build 13.5), and other-month cells are `#f7eeda` with `#b8ac97` text, not `--ground` / `--border-strong`.

### 8.3 Graveyard and Recently Deleted

Both are close. Three drifts:

- `.grave-year-row` padding is `0 2px 2px`, not `8px 2px 8px`. The build adds 14px of vertical space to every year divider, which spreads the list.
- The year rule is `#ddd0b8`, not `--border` (#e6dbc7).
- The days-left pill is `#efe6d4` with `#5d5546` text. The build uses `--sand` with `--text`, which is darker and heavier than designed.

Everything else in both screens matches, including the grayscale filter on graveyard photos, the `.72` opacity on deleted photos, the 46px thumbnails and the restore button.

### 8.4 A pattern worth naming

Six of the items in §7 and §8 are the same mistake: a design value that is *near* a token got mapped to that token. `#efe6d4` became `--sand`, `#ddd0b8` became `--border`, `#f2e6d2` became `--sand`, `#e0d4bd` became `--border-strong`, `#f7eeda` became `--ground`, `#d6ecf7` became an opacity.

The tokens exist for the values that repeat. A one-off colour in a comp is a one-off colour: write the hex. If a value looks like it wants to be a token, that is a question for the designer, not a substitution to make silently. Checking this class of error is fast: search the sheet for `var(--` inside any rule whose extract counterpart names a literal hex, and compare.

---

## 9. Dark mode

Mostly right, and one important correction that runs the other way.

### 9.1 The handoff's dark table was the stale document, not the build

`Plantalog handoff.md` §2 carried water `#0d4d66` and potting `#4a2a12`. The concept files no longer use those. The comps say:

| Dark | Fill | Ink | Label / heading |
| --- | --- | --- | --- |
| Water panel (`5c`, `7e`) | `#134b64` | `#dcf0f9` | `#a5cfe3` |
| Potting panel (`5c`) | `#5c2e10` | `#fbdcc4` | `#f7c9a3` |

The build followed the comps and is correct. **Do not revert these to the old table.** The handoff has been corrected so the stale values cannot resurface.

### 9.2 Verified correct in dark

Ground `#1f1d1a`, surface `#2b2823`, header `#15644a`, all four shadows removed rather than softened, health tints and inks, the full-saturation health spine on `#2b2823` cards, and the score tiles. Also correct, and easy to get wrong the other way: **room colours do not change in dark.** A room bar stays `#a3450a` with `#fff8f2` on both grounds, because the colour is the user's, not the theme's.

### 9.3 Dark defects

- `--potting-head:#ffc094` is the one dark value that disagrees with its comp. `5c` draws the View Plant potting title in `#f7c9a3`. Check `6c` before changing the token globally; if the two comps differ, the panel title needs its own value rather than the token.
- Dark `--border` is `#3a352d`, while `#3c3830` (the handoff's border value) is now `--sand`. One of the two moved. Worth confirming against a dark divider in `24e` before either is trusted.
- Header sub-lines in dark should use the named tint, not an opacity of the header ink: the Water header subtitle is `#a5cfe3` (`7e`), and the status row above it is the same.
- On desktop in dark, the page outside the 390 column stays cream: `body` keeps `--cream` while `.app` goes dark. Invisible on a phone, obvious on a laptop.

---

## 10. Copy

Copy lives in the JSX, not the stylesheet, so a CSS diff never sees it. These are design strings that appear in no form in the build. Sample data, plant names and note text are excluded; everything below is interface copy.

**Utilities rows** (`util-9a`, `util-10a`), all three shorter in the design than in the build:

- OOT: "A caretaker watering guide while you're traveling" (build inserts "plant")
- Export: "As a spreadsheet or a full backup"
- Import: "Add or update in bulk, or restore a backup"

**Empty and first-run states**

- Home, first run (`14b`): "Add your first plant and Plantalog will start tracking its watering and repotting schedule." and below the card, "Want to import your plants in bulk? Head over to Utilities to download the XLS import template!"
- Repot, nothing due (`14c`): "Nothing due for 3 months" and "in December. It'll show up here when it's close."
- Rooms tab footnote (`13b`): "Tap a room to see only its plants. Drag to reorder. Deleting a room moves its plants to Unassigned."
- Home, unassigned footnote (`14a`): "Rooms with no colour, and plants with no room, sort to the bottom."

**Auth**

- Create account (`19e`): "By creating an account you agree to the terms and privacy policy."
- Wrong password (`20d`): "That password does not match this email"

**Elsewhere**

- Watering tip (`14d`): "Not sure how often to water?" plus its body, which is currently absent entirely.
- Recently Deleted (`8c`): "3 plants · Permanently deleted after 30 days"
- Import summary (`util-10d`): "6 plants matched with no changes", "Row 14: unknown room "Studio", will be created", "Row 22: pot size blank, keeping the current value"

**Patterned, so match the pattern rather than the string:** "N plants are thirsty today", "N plants ready for a new home", "N waterings did not sync", "10 days · 14 waterings across 5 rooms", "every 5d · last watered Aug 7".

**The printed watering guide exists but was never updated.** Nothing from `util-11a`, `util-11b`, `util-12a`, `util-12b` or `util-12c` appears in the build, so the PDF generator is still emitting the pre-redesign guide. This is a real work item and the largest one left. The chosen layout is the **photo-tile** version (`util-11a`), not the compact row version (`util-11b`); `12a` to `12c` are the printed pages as decided.

Print values, since this is the one surface with no on-screen equivalent to measure against:

- Page 612x792 (US Letter at 72dpi) on `#fffdf8`. Header padding `34px 40px 0`, body `18px 40px 0`, footer `0 40px 26px`.
- Title "OOT Water Schedule" 32px Caprasimo in **`#2d6a4f`**, a print-only green lighter than the app's `#0f4438`. Range line beneath it 13px/700 `#7a6055`. Then a 2px `#e6dbc7` rule at `border-radius:999px`, 14px below.
- Day heading 19px Caprasimo `#241d18`, a 1px `#efe6d4` rule filling the gap, and the day's count at 10px/800/0.8px uppercase `#7a6055`.
- Room bar: the room's own colour, `border-radius:12px`, `padding:5px 11px`, name 11.5px/800 `#fffdf8` at 0.3px tracking.
- Photo tile: 158px column, photo 158x100 at `border-radius:12px`, name 12px/800 `#241d18`, meta 10px/600 `#7a6055`, then two checkboxes, 13px squares at `border-radius:6px` with a `1.6px #a89d8b` border, labelled "Watered" and "Not ready" at 9px/700 `#7a6055`. Tiles sit 19px apart, rows 13px apart.
- A day continuing onto the next page carries "Wednesday continues" at 9.5px/800/0.7px uppercase `#7a6055` beside a 1px `#efe6d4` rule.
- Footer: "Plantalog · Aug 12 – Aug 21" left, "Page 1 of 5" right, both 9.5px/700 `#7a6055`.


---

## 11. Round four: the four open decisions, settled

All four were open questions from the last round. They are decided here, with values, so nothing has to be inferred.

### 11.1 The selected room chip halo is derived from the room colour

Confirmed as the intent: the outer ring is a lighter version of the room's own colour, not a fixed cream. Room colours are arbitrary user hexes, so the tint is computed rather than looked up.

```css
.pm-room-chip.selected {
  /* fill and text stay exactly as the unselected chip */
  box-shadow: 0 0 0 2.5px var(--chip-colour),
              0 0 0 4.5px color-mix(in oklab, var(--chip-colour) 26%, transparent);
}
```

Set `--chip-colour` per chip from the room's hex. The alpha form is deliberate: composited over the cream card it produces the light tint the design shows, and over the dark card it produces the dark tint, from one rule. Check against the designed pair before shipping: `#f2a13b` should land within a hair of `#ffe6c0` on light (`6b`, `13h`, `14d`) and near `#5a3607` on dark (`6c`).

Two edge cases:

1. **A very pale room colour** (OKLCH L at or above 0.90) disappears at 26%. For those, raise the halo to 55% and leave everything else alone. One threshold, no per-room table.
2. **A room with no colour** keeps what the build already does: fill `var(--sand)`, inner ring `var(--accent)`, and the same computed halo off the accent.

The Health picker is unaffected. Its four colours are fixed, so it keeps the literal tints from §3.5 rather than a computed one.

### 11.2 The printed guide uses the app's own faces

Confirmed: Caprasimo for the title and day headings, Figtree for everything else, matching `12a` to `12c`. Helvetica in the generator is the last thing making the printed guide look like a different product.

- Embed `Caprasimo-Regular` (one weight, there is no other) and `Figtree-Regular` plus `Figtree-Bold`. Fetch each as an `ArrayBuffer`, base64 it, then `doc.addFileToVFS()` and `doc.addFont()` once per document.
- Register them as `caprasimo/normal`, `figtree/normal` and `figtree/bold`, then replace every `setFont("helvetica", …)` call: title 32pt and day heading 19pt go to `caprasimo/normal`; every other call goes to `figtree` at the weight it already asks for.
- Caprasimo has no bold. Where the current code sets `helvetica bold` at title or day-heading size, drop the bold rather than synthesising one.
- Load the fonts with the same lazy pattern as jsPDF itself, and **fall back to Helvetica if a fetch fails**. A missing font must never stop the guide from generating.
- Cost is roughly 40KB for Caprasimo and 60KB per Figtree weight, fetched only when someone actually creates a guide. Subset to Latin if that matters.

### 11.3 Both remaining copy blocks are in scope

**Watering tip (`14d`).** Opens from a `?` beside "Water every" on the Add and Edit Plant form, over a `rgba(31,29,26,.5)` scrim, as a `#fffdf8` card at `border-radius:22px` with a 9px caret pointing up at the `?`. The `?` itself is a 17px circle, `#17627f` on `#fff`, with the double ring `0 0 0 2.5px #e6f2f8, 0 0 0 4.5px #17627f`.

- Heading, 18px Caprasimo `#12556e`: "Not sure how often to water?"
- Body, 13px/1.55 `#474238`, with **7 days** bold: "Start at 7 days. When it comes due, check the soil first: if the top inch or two is dry, water it. If it's still moist, add a few days and check again. Repeat and you'll land on the right frequency for this plant."
- Button, full width, `#17627f` on white, 13px/800 pill: "Got it"

**Import summary (`util-10d`).** The result panel inside the Import sheet, above the Back and Import buttons.

- Success card `#e9f7ef` at 16px radius, `12px 14px`: headline 17px Caprasimo `#0a5c34` in the pattern "3 new · 12 updated"; names 12px/600 `#3f6b4e` in the pattern "Hoya, Peperomia, Alocasia, Monstera, Calathea + 10 more" (five names, then the remainder); then 11px/600 `#5d7a68`, "6 plants matched with no changes".
- Warning card `#fdeceb` with a `1.5px #e0483a` border at 16px radius, `11px 13px`: title 12.5px/800 `#9b1c1c` in the pattern "⚠ 2 warnings", then one line per warning at 11.5px/600/1.45 `#9b1c1c`, each naming its row: "Row 14: unknown room "Studio", will be created" and "Row 22: pot size blank, keeping the current value".
- The warning card is omitted entirely when there are none. It never renders empty.
- Buttons: "← Back" is the outlined `#fffdf8` pill hugging its content, "Import" is the solid `#0f4438` pill filling the rest, both 13.5px/800.

### 11.4 Dark re-measurement, the checklist

The round-three additions were written from the token system but never compared side by side with a dark comp. Measure these four, against `6c`, `7e`, `23b` and the dark screens generally:

- **First-run card and Repot empty state.** Surface `#2b2823` with no shadow, body text on the dark muted step, not an opacity of the ink. The footnote under the card is the same muted step, not dimmer.
- **Both status strips.** The fills in §7.1 are light-mode values; in dark they take the dark warn and danger tints, and the Retry button stays a solid fill rather than becoming an outline.
- **Date picker.** `#f2e6d2` is a light-mode card. In dark it sits on `#2b2823`, other-month cells go to the dark muted pair, and the days-left pill loses its cream fill.
- **Selected room chip halo (11.1).** The alpha rule should produce the dark tint automatically. Confirm it does rather than assuming it.

Two things not to re-derive: room colours do not change in dark (§9.2), and the panel values in §9.1 are correct as built.

### 11.5 Two follow-ups: dark strips and the dark halo

**Dark strip colours: use these, not the pre-rebuild ones.** There is no dedicated dark comp for the two strips, but the dark palette already carries both tints. `23b` and `6c` draw the dark warn pair as `#5a3607` fill with `#ffcb85` ink, and the dark danger pair as `#5e1c14` fill with `#ffb3a8` ink. The strips take those:

| Strip | Dark fill | Dark ink | Dark second line |
| --- | --- | --- | --- |
| Offline | `#5a3607` | `#ffcb85` | `#e0ac6e` |
| Sync failed | `#5e1c14` | `#ffb3a8` | `#e08d80` |

The Retry button stays a solid fill on both grounds. In dark it is `#c0392b` with `#fff2f0` text, since the light `#97281d` disappears into the `#5e1c14` card. Everything else about the strips, the two-line structure, the icon and the copy, is unchanged from §7.1.

**Dark halo: yes, tune it.** The single alpha rule was mixing the room colour toward the neutral ground, which drops its chroma. The dark comps darken the colour instead: `6c` pairs the `#f2a63e` chip with a `#5a3607` halo, which is that same orange taken down in lightness with its saturation intact, not an orange greyed toward brown. So split the rule by mode:

```css
/* light: lift toward the card */
0 0 0 4.5px color-mix(in oklab, var(--chip-colour) 26%, transparent)
/* dark: darken the colour itself (48% measured against 6c, not estimated) */
0 0 0 4.5px color-mix(in oklab, var(--chip-colour) 48%, #000)
```

Check it against `#f2a63e`, which should land on or beside `#5a3607`. 48% is the measured match; an earlier draft of this section said 38%, which was an estimate and comes out too dark. The pale-colour exception in §11.1 applies to light only; in dark a pale room colour darkens to something visible on its own.


---

## 12. Round four: measured against the current build

Everything below was measured in the running build (the preview at 1:1, 390px column), not inferred. Four are yours, five came out of the sweep.

### 12.1 Edit Plant is not full screen, and it is a rule-order bug

`.pm-modal` sets `max-height:none` at its declaration, but `.modal{max-height:88vh; max-height:88dvh}` is declared **later** in the same sheet at the same specificity, so `.modal` wins and the form renders at 88% of the viewport with the ground showing above it. The height and radius are right; only the cap is losing.

Fix by specificity, not by moving code: `.modal.pm-modal{max-height:none}` and `.modal.detail-sheet{max-height:none}`. `detail-sheet` currently wins only because it happens to sit below `.modal` in the file, which is the same accident pointing the other way.

### 12.2 `--charcoal` is doing two jobs, and dark mode breaks the second one

`--charcoal` is both the Recently Deleted header fill and the ink on every outlined button. In dark it is redefined to `#33302a` for the header, which drags the button ink down to near-black on a `#2b2823` surface. That is the illegible Cancel, and it is not only the schedule sheet: `.sheet-close-btn` and `.util-btn` share it, so Create, Export, Import, Send, Sign Out, Close and Back are all affected in dark.

Split the token. Keep `--charcoal` for the header fill and add a button ink:

| Token | Light | Dark |
| --- | --- | --- |
| `--btn-ink` | `#474238` | `#e8dfcd` |
| `--btn-border` | `#c9bda6` | `#5a5346` |
| `--btn-bg` (util row buttons) | `#fffdf8` | `transparent` |

Those are the values `util-9b` and `util-10e` draw. The sheet's own Cancel is slightly different from the row buttons in dark: `#231f1b` fill with a `1.5px #4a463d` border, still `#e8dfcd` ink.

### 12.3 The schedule thumbnail is the wrong drawing and the wrong box

Two separate problems.

**The box has no dark rule.** `.sched-preview` is hard-coded `#efe6d4` with a `1.5px #e0d4bd` border, so it stays cream on a dark sheet. `util-10e` gives dark `#211d19` with a `1.5px #3a352d` border. Height 150px and radius 16px are already right.

**The drawing is a placeholder, and it inverts.** The build draws generic full-width bars using `var(--card-bg)` and `var(--border-strong)`, so in dark the sheet of paper turns dark. It is a picture of a printed page: the paper stays `#fffdf8` with a `#ddd0b8` hairline in both modes. `util-10a` and `util-10e` carry the finished SVG (same artwork in both, only the surrounding box changes) on a `0 0 200 116` viewBox: page with a drop shadow, a `#2d6a4f` title bar, a muted range line, two rules, then day sections, each with a room bar in the room's own colour and three photo tiles at `#e2e8d5` with two checkbox squares beneath. Lift it verbatim rather than redrawing it.

### 12.4 The health tiles are 6px short

**Designed 50px, measured in `13a` itself.** Rendered 44px. An earlier draft of this section said 48px, which was arithmetic on the declared values (`8px 4px 7px` padding, 21px number at `line-height:1`, 8px label at `margin-top:4px`) with the label counted as exactly 8px tall. It is not: the label sits in a normal line box, which is precisely the thing the build is collapsing. **Trust the 50px measurement, not the sum.**

Pin it rather than chase it: `.score-tile-lbl{line-height:1.5}`, and add `min-height:50px` to `.score-tile` so the row cannot drift again with a font swap.

### 12.5 The Utilities toggle is oversized

Build `50x32` with a 20px thumb and a 24px travel. Design (`util-9a`, `util-10d`) is **44x26**, `padding:3px`, 20px knob, so the travel is 18px. The knob and its `0 1px 3px rgba(0,0,0,.22)` shadow are correct.

### 12.6 The dark toggle is the wrong blue

`.dark .toggle-switch input:checked+.toggle-track` uses `var(--water-solid)`. `util-9b` draws it `#5aa8cc`, a lighter step. Light mode's `var(--primary)` is correct as built.

### 12.7 The Repot header does not darken

In dark the Repot header renders at full-strength `#a3450a`, the light value, while Water correctly drops to its dark step. There is no Repot dark comp, but the potting family's dark fill is `#5c2e10` (`5c`, §9.1) and that is the value to use. Worth a look at Graveyard and Recently Deleted headers in dark at the same time, since they are the same pattern.

### 12.8 A blank screen after dismissing a sheet

Reproduced once: dismissing a sheet in dark mode and immediately tapping another tab left the content area empty for at least 800ms, with only the nav bar drawn. It did not reproduce in light. This is the neighbourhood of §6.2, so before touching the crossfade, check whether `dismissSheet` and the tab change are both mutating the layer stack in the same frame.

### 12.9 Not defects

The Water screen, Repot list, Home in both modes, the room bars, the health spine and the wake stagger all measure correctly. The floating nav overlapping the last card while scrolling is the designed behaviour, not a bug.


---

## 13. Round five: the reason things keep coming out short

Everything in this section was measured by rendering the design extract and the build side by side and reading `getBoundingClientRect()` on both. Earlier rounds compared *declared CSS*, which is why these got missed: every value below is declared correctly and still renders wrong.

### 13.0 Root cause: the design leaves `line-height` at `normal`; the build pins it

The concepts almost never declare a line-height. A text block's height is therefore the font's own line box, which is generous in both faces. The build normalises line-height to `1` or to an explicit px on exactly these blocks, so every box sized by its own text comes out 2 to 6px short. Measured pairs:

| Element | Design | Build | Why |
| --- | --- | --- | --- |
| Health tile | **52.4px** | 50px | label line box 12.4 vs `line-height:10px` |
| Health tile label | 12.4px | 10px | `normal` vs pinned |
| Card stat value (`Every`/`Next`/`Pot`) | 14px at `normal`, `margin-top:1px` | `line-height:1`, `margin-top:2px` | pinned, and 1px too far down |
| Card stat label | 8px at `normal` | `line-height:1` | pinned |
| Room header (coloured) | **26.15px** | 21px | see 13.4 |
| Room header (uncoloured) | 24.15px | - | `padding:2px 12px` |

**The rule to apply: do not set `line-height` on any block the design does not set it on.** Deleting those declarations is the fix for most of this section. Where a height must be guaranteed, add a `min-height` (health tile: `min-height:52px`) instead of pinning the line box, and never state a tile height as a sum of declared values: the label's line box is 12.4px, not 8px, which is how the spec wrongly said 48px and then 50px.

### 13.1 The health tile block

Tile is 52.4px, not 48 or 50. Remove `line-height` from `.score-tile-lbl`, keep `margin-top:4px`, add `min-height:52px` to `.score-tile`.

### 13.2 The gap under the tiles is 9px too big

Design: 15px from the tile grid's bottom to the top of the "Health score" label's line box (a 10px flex gap plus the label's own leading). Build: **24px**. `.score-tiles{margin-bottom:10px}` is being added to whatever `.score-bar-wrap` already contributes. Measure to 15px rather than trusting the declared 10.

### 13.3 The card stat trio reads small

Design: label 8px/800 at `normal`, value **14px/800 at `normal` with `margin-top:1px`**, column `width:33px`, `gap:11px`. Build pins both line-heights to 1 and uses `margin-top:2px`. The column width and gap are right; the block is roughly 8px shorter than the design, which is why the three values look small inside the card. Remove both line-heights, set the margin to 1px.

### 13.4 The room header, and a caveat that invalidates part of this review

Two separate things.

**The caret is not in the design.** `24a` has no chevron in either header: coloured headers are name plus count, uncoloured are name plus count. The collapse affordance was invented by the build. Remove it, or bring it to me as a proposal, but it is not in the comps.

**The height measurement is not trustworthy in the preview file.** The coloured header is `padding:3px 12px` in both, and the difference is entirely the Caprasimo line box: 20.15px in the design, 15px in the preview build. But the standalone preview embeds Caprasimo as a **base64 subset whose vertical metrics differ from the Google-served font** the concepts use, so *every* Caprasimo line box in the preview is about 25% short. `index.html` loads the real Google font, so the app itself should match the design here.

**Consequence, and it matters for every future round: geometry must be measured in the real app, not in the standalone preview.** The preview is fine for colour, copy and layout logic, and it is not fine for anything sized by display type. Re-check the room header, the "Plantalog"/"Water"/"Repot" headers and every Caprasimo value in `index.html` before changing any of them.

### 13.5 Shadows are too weak and the wrong colour

Design (`--shadow-sm` in the Organic system, on every card, tile and room header): **`0 1px 2px rgba(46,43,37,.14)`**, one layer, a warm near-black at 14%.

Build `--shadow-sm`: `0 1px 2px rgba(60,40,20,.06), 0 2px 0 rgba(60,40,20,.09)`, and `.plant-card` overrides it again with `0 1px 3px rgba(60,40,20,.08), 0 3px 0 rgba(60,40,20,.1)`. Two layers at half the alpha reads as almost no bottom edge, which is the "missing shadow accent".

Set `--shadow-sm:0 1px 2px rgba(46,43,37,.14)` and delete the per-element shadow overrides so cards, health tiles, room headers and `pm-` cards all take it.

### 13.6 New Plant, against `6a`

1. **Got card is not vertically centred.** Design: `width:112px`, `padding:9px 12px 10px`, `display:flex; flex-direction:column; justify-content:center; gap:3px`, holding Got / value / "age starts now". If the build's card is taller than its content (it is, because the Name card next to it carries a 31px value box plus a 2px rule), the content must centre in it.
2. **Next pot size has no inner capsule and is left-aligned.** Design: a plain white card, `flex:1`, `border-radius:16px`, `padding:5px 11px 6px`, holding an 8px/800/1px-tracked `#b07a4d` label and then the value as bare text, **12px/800 `#8c3f07`, `margin-top:2px`, left-aligned, no pill and no background**. The Potted card beside it is identical plus a 12px calendar icon. Whatever pill is in there now should come out.
3. **Add photos is missing entirely.** It is the last row of the form, `margin-top:auto` so it pins to the bottom: a 48x48 tile, `border-radius:16px`, `2px dashed #c0b6a5` on `#fffdf8`, holding an 18px camera icon stroked `#8a8071` at 2.5; then two lines at 11px/1.4, "Add photos" in 700 `#6f6658` and "first one becomes the main shot" in 600 `#8a8071`. Row gap 6px, `align-items:center`.
4. While in there: the Notes card is a fixed `height:84px; flex:0 0 84px`, and the form's own padding is `11px 14px` with `gap:7px` between cards.

### 13.7 How to verify this round

Do not diff CSS. For each item: open the extract, open the app (`index.html`, not the preview), and read the same element's `getBoundingClientRect()` in both. The numbers in the tables above are the target, not the declarations.

### 13.8 Room header height, made font-independent

Do not wait on the Caprasimo question. Pin the box and centre the text in it, so the header's height stops depending on the font's line box at all. `min-height` rather than `height`: it raises the short case and changes nothing where the header already measures correctly, so it is safe to apply now and safe if the app was already right.

```css
.room-header{
  min-height:24px;            /* uncoloured, 24a: padding 2px 12px */
  padding:0 12px;
  border-radius:12px;
  display:flex; align-items:center; justify-content:space-between;
}
.room-header.colored{ min-height:26px; }   /* 24a: padding 3px 12px */
.room-header h3{ line-height:1; }          /* safe once the box is pinned */
```

Targets, measured in `24a`: coloured **26.15px**, uncoloured **24.15px**. Name is 13px Caprasimo in `#fff8f2` on a coloured bar, count is 10px/800 in the same ink. Uncoloured is `#efe4cd` at `padding:2px 12px` with a `margin-top:2px` above it.

Apply the same treatment anywhere else the design's height comes from display type: `min-height:52px` on `.score-tile` (§13.1) and `min-height` on the `pm-` panel titles if they measure short. This is the general remedy for §13.0: pin the box, centre the content, and the font can no longer change the layout.


---

## 14. Round six: the systematic sweep (in progress)

Measured, not diffed. Sweeps 1 to 3 and part of 5 are below; the rest follow.

### 14.0 Verified fixed in round five

Health tile 52.4 ✓, room header 26 with no caret ✓, `--shadow-sm` at `rgba(46,43,37,.14)` ✓, stat value line-height unpinned with `margin-top:1px` ✓, tiles-to-label gap 16 against a target of 15 (close enough to leave). `.pm-modal` is now full height and Save is visible at desktop height.

### 14.1 Correction: the plant card is NOT too big

Build 56px. The design composes to 56px too: a 42px thumbnail plus `7px` top and bottom, with a 5px spine, 16px radius and `gap:9px`, all of which the build matches exactly. My earlier "54.77" was measured off a comp whose cards are **compressed by the fixed 800px phone frame** (they are flex items in an `overflow:hidden` column). Compressed mockup values are not targets. If the row still reads too heavy, that is a change to the design, not a defect to fix.

### 14.2 The three Utilities subscreens disagree with each other and with the comps

Measured in the build:

| Screen | Back control | Header alignment |
| --- | --- | --- |
| Graveyard | `.sublist-back`, a 354x16 transparent text link "‹ Utilities" above the title | `normal` |
| Recently Deleted | `.rd-back`, 30x30 circle at `rgba(240,233,220,.16)` | `flex-end` |
| Notifications | `.rd-back`, same circle | `flex-end` |

The comps (`8c`, `util-9c`) both draw the **30x30 circular button, `rgba(240,233,220,.16)`, a 15px chevron at stroke 2.9, in a row that is `display:flex; align-items:center; gap:12px`** with the title block beside it. Two fixes:

1. **Graveyard gets the same circular button.** Its comp (`8b`) shows no back control at all, which is an omission in the comp rather than an instruction; the text link is an invention either way. Make all three identical.
2. **The header row is `align-items:center`, not `flex-end`.** Both built screens bottom-align the button against the title, which is why the chevron sits low beside a 24px or 26px heading. This is worth checking against what §6.3 asked for, which was about the header's own box and not about dropping the button below the title's centre line.

Titles differ by screen and are correct as drawn: Graveyard 30px, Recently Deleted 24px, Notifications 26px, all Caprasimo at `line-height:1` over a 12.5px/600 sub-line in `#c2b9a8`, in a 102px header padded `12px 18px 14px`.

### 14.3 The photo experience is the old one; the designed viewer does not exist

The build still shows the pre-redesign pattern on View Plant: a star badge on the first thumbnail and a "…" menu on each. `13d` replaces all of it with a **full-screen viewer**, and none of it is built.

The viewer, in full (`13d`):

- Ground `#141310`, full bleed, its own screen rather than a sheet.
- Top row `padding:14px 16px 4px`: a 32px circular close at `rgba(240,233,220,.14)` with a 15px X at stroke 2.75, then empty space, then a 32px spacer so the close stays optically left.
- Middle, `flex:1`, centred, `gap:12px`, `padding:4px 12px 0`: a **date pill**, `rgba(240,233,220,.14)` on `#f0e9dc`, 12px/800, `padding:6px 14px`, with a 12px calendar icon, reading e.g. "Jun 14, 2026"; then the photo itself at `max-width:100%; max-height:100%; border-radius:22px; object-fit:contain`.
- **The Main badge** sits on the photo, `position:absolute; left:10px; bottom:10px`: `rgba(15,68,56,.92)` on `#f2f0d8`, 10px/800, `letter-spacing:.5px`, uppercase, `padding:5px 11px`, pill. It appears only on the main photo.
- Bottom block `padding:16px 16px 8px`, `gap:11px`: the plant name in 21px Caprasimo `#f0e9dc`; then the **filmstrip**, `gap:10px`, 52px squares at `border-radius:12px`, `object-fit:cover`, every one at `opacity:.55` except the current, which is at full opacity with a double ring `0 0 0 2.5px #141310, 0 0 0 4.5px #f2a13b`.
- Then two buttons, `gap:7px`: **"Set as main"**, `flex:1`, transparent with a `1.5px rgba(240,233,220,.28)` border, `#f0e9dc` 12.5px/800, `padding:10px 0`, pill; and a 44px-wide delete button, `#4a1f1a` with a 16px trash icon in `#ffb3a8`, also a pill.
- Tapping a photo on View Plant opens this; the strip's caption there reads "Oldest to newest · tap a photo to view or change its date".

The star and the "…" menu both come out. "Set as main" replaces the star, delete replaces the menu, and the badge replaces the star's role as the main-photo marker.

### 14.4 Notes

There is no `<textarea>` anywhere in the Edit form, so the notes field is some other element and its clipping cannot be attributed yet. The designed Notes card (`6a`) is a fixed `height:84px; flex:0 0 84px`, `padding:10px 14px 11px`, radius 16, with a 9px/800/1.1px uppercase `#6f6658` label and `margin-bottom:5px`. Whatever the input is, it has to scroll inside that 84px box rather than grow it, and the form's Save must stay reachable while it is focused. **Still to reproduce at phone height with the keyboard open**, which is the condition where Save disappears.

### 14.5 Still to sweep

Water, Repot, View Plant beyond photos, Auth, empty states, the status strips, both data sheets, and all of the above in dark.

### 14.6 The plant card interior is already pixel-identical to the design

Every element inside the card, measured in the build against `24a`:

| | Design | Build |
| --- | --- | --- |
| Card | 362x56 | 362x56 |
| Spine | 5px | 5px |
| Body padding / gap | `7px 10px 7px 9px` / 9px | same |
| Thumbnail | 42x42, r12 | 42x42, r12 |
| Name | 14px/700, line box normal | 14px/700, 17px box |
| Age sub | 11px/600, `margin-top:1px` | same, 13.5px box |
| Stat columns | 33px wide, `gap:11px` | same |
| Stat label | 8px/800, `.6px`, normal | 8px/800, 12.4px box |
| Stat value | 14px/800, normal, `margin-top:1px` | same, 21.7px box |

There is nothing left to correct: the ratio of thumbnail to text to padding is the design's ratio. The card is 56px because 42 + 7 + 7 = 56, in both.

**Resolved: change nothing about the card. Fix §17 instead.** The proposal in an earlier draft of this section (shrink the thumbnail to 38 and the padding to 6, taking the card to 50px) is **withdrawn** — it would have made the card diverge from the comp in order to fix a problem that was never the card's.

The card reads wrong because its *text* is short, not because its box is big. Inside a 56px card whose height is fixed by the 42px thumbnail, the name block renders 31.5px against the design's 39.75px (§17.1), so the type sits small and floats in space the design fills. The stat trio beside it was individually patched to 1.55 and therefore already measures exactly right, which is precisely why the name block looks wrong next to it.

Setting `body{line-height:1.55}` (§17.2) takes the name to 21.7px and the age sub-line to 17.05px, the block to 39.75px, and the card to the design's proportions with no geometry change at all. **Do this before judging the card again.** Every declared value in the card already matches the comp; the ratio the user asked for is the ratio §17 restores.


---

## 15. Round six continued: Water, Repot, strips, headers, Auth

Read from both sources rather than measured in-browser (self-inspection was unavailable), so the two items marked **verify** need a rendered check. Everything else is a value mismatch that can be read straight off the source.

### 15.1 Verified correct

Status strips now match `21a`/`21b` exactly, light and dark, including the two-line structure, the icons, and the dark Retry at `#c0392b`. `--shadow-sm` and `--shadow` are both `0 1px 2px rgba(46,43,37,.14)` ✓. Repot dark header `#5c2e10` ✓. Auth has its `88px` lockup offset and `64px` spacer ✓. The all-done and Everyone's-happy cards match on padding, type, pill and copy. Dark mode drops all four shadows to `none`, which is §7 as written.

### 15.2 The celebration card is 8px too round

`.celebration` and `.celebration.all-done` use `border-radius:var(--r-xl)`, which is **30px**. `7b` and `7d` both draw it at **22px**, which is `--r-lg`. Change the token reference, not the token: other things depend on `--r-xl`.

### 15.3 The page header sub-line uses opacity instead of its colour

This is the §8.2 pattern again, in the one place it is most visible.

```
build: .page-header p{font-size:13px; line-height:18px; opacity:.72; margin-top:3px}
       .page-header.teal p,.page-header.brown p{color:inherit; opacity:.82}
design: font-size:13px; font-weight:600; margin-top:4px; colour per header, no line-height
```

Four separate drifts in one rule: the colour is faked with opacity, `font-weight:600` is missing entirely (so it renders at 400 and reads thin), `margin-top` is 3 instead of 4, and `line-height` is pinned to 18px where the design leaves it `normal` (§13.0).

Designed sub-line colours: Water `#c3e3f2`, Repot `#f7d3b5`, Graveyard and Recently Deleted already use their own tokens correctly. Set the colour per header class and delete the opacity.

### 15.4 The header title is 3px taller than designed

`.page-header h1{line-height:1.1}`; `7a`, `7c`, `8b` all draw 30px Caprasimo at `line-height:1`. Same for `.hdr-lockup h1` at 33px. This is what makes the title sit low against the sub-line even when the 102px header height is right.

### 15.5 The Undo button drifts on three values

Design (`7a`, `7c`): 13px icon at stroke **2.4**, border `1.5px` in the **header's own ink at 50%** (`rgba(234,246,252,.5)` on Water, `rgba(255,248,242,.5)` on Repot).

Build `.header-undo-btn`: 15px icon at stroke 2.2, border `rgba(255,255,255,.5)`. Pure white on a teal or brown ground is brighter than the designed ink. Use `currentColor` at 50% and the border tracks whichever header it is in automatically. Padding `6px 14px`, 12px/800, `gap:6px` are all correct.

### 15.6 Repot rows are a different size from Water rows, and the build makes them the same (verify)

`7c` and `14c` both draw the Repot row **larger** than the Water row: thumbnail **46x46** (not 42), `gap:10px` (not 9), body padding `8px 11px 8px 9px` (not `7px 10px 7px 9px`), which makes the card **62px** rather than 56. Water rows are 42/9/7 and match Home.

The build has one shared `.pc-body` at 42/9/7 with no Repot override, so Repot rows are almost certainly rendering 56px. Add a `.repot-card .pc-body` rule with the three values above and a 46px thumbnail. **Verify by measuring both rows in the app** before and after.

Also in Repot: the list gap is `7px` on the Repot screen against `6px` on Water, and the "Up Next" heading is 19px Caprasimo with `align-items:baseline; gap:9px; margin-top:14px; margin-bottom:3px` beside a `#fbe6d6`/`#8c3f07` pill at 10px/800, `padding:3px 10px`.

### 15.7 Room header may not push its count to the right edge (verify)

`.room-header` is `display:flex; align-items:center; gap:5px` with **no `justify-content:space-between`**; both `24a` and `7a` set it. If the name element has no `flex:1`, the count sits next to the name instead of at the right edge. Check in the app; if the count is already right-aligned, something else is supplying it and the rule should be made explicit anyway.

### 15.8 Sweep status

Done: Home and card interior, Water, Repot, the strips, the three Utilities subscreen headers, Auth offsets, both empty states, the photo viewer audit. Outstanding: the three data sheets (export, import, schedule) against `util-10a` to `10d`, the date picker, Rooms tab and Edit Room, the delete-choice sheet, and a dark pass over everything in §14 and §15.


---

## 16. Round six, sweep 7: the data sheets, plus two retractions

Measured in the browser this time (both modes).

### 16.1 Two retractions from §15

- **§15.7 is withdrawn.** The room header's count *is* pushed to the right edge; something other than `justify-content` supplies it. Making the rule explicit is still tidier, but it is not a defect. Header measures 26px ✓.
- **The Home tile row is entirely correct.** All five tiles are 52.4px, `gap:6px`, radius 16, `--shadow-sm`, and the All tile is `#0f4438` with `#f2f0d8` ink as designed. I misread a screenshot earlier; the measurement is the truth.

### 16.2 The export/import sheet: seven drifts, one shared shell

Both sheets use `.data-sheet`, so every fix lands twice.

| | Design (`util-10b/10c`) | Build |
| --- | --- | --- |
| Sheet fill (light) | `#f2e6d2` | `#efe4cd` |
| Sheet shadow | `0 -14px 40px rgba(28,25,20,.32)` | `0 26px 0 0` in the ground colour |
| Bottom padding | 20px | 30px (inline `paddingBottom:30`) |
| Column gap | `gap:10px` | none (`normal`) |
| Tab track radius | 16px | 12px |
| Active tab radius | 12px | 6px |
| Active tab shadow (light) | `0 1px 4px rgba(28,25,20,.12)` | none |
| Inactive tab ink (light) | `#5d5546` | `#8a7f6d` |
| Dashed CTA radius | 16px | 12px |

The missing `gap:10px` is the one to fix first: without it the sheet's vertical rhythm comes from whatever margins each child happens to carry, which is why the blocks sit unevenly. The shadow is pointing the wrong way entirely, so the sheet has no lift off the screen behind it.

Correct as built: the 42x4 `#cfc0a6` handle, the 22px Caprasimo title at `line-height:1.1`, the `#e6dbc7` tab track, the dashed CTA's `#e9f0e0` fill and `1.5px dashed #7fae8b` border, and the 30px top corners.

### 16.3 Dark sheet is close, and its remaining faults are the same ones

`util-10f` draws dark: sheet `#2b2823`, handle `#4a4539`, title `#f0e9dc`, tab track `#1f1d1a`, active tab `#3a352d` with `#8fd6ac` ink and **no shadow**, inactive ink `#a99e8c`, body `#a99e8c`, CTA `#1e2f22` with `1.5px dashed #58896a` and `#9ddcb0` ink, Close `#231f1b` with `1.5px #4a463d`. The build matches all of those, and the Close button is legible now that `--btn-ink` is split (§12.2). The radius and gap faults in §16.2 are mode-independent, so fixing them fixes dark too.

### 16.4 Still outstanding

The date picker (`13h`), Rooms tab and Edit Room (`13b`, `13c`), the delete-choice sheet (`8a`), and the OOT schedule sheet's own geometry. Everything else in §12 to §16 has now been measured at least once.


---

## 17. THE root cause, correctly diagnosed. This supersedes §13.0

§13.0 identified the right symptom and the wrong cause, and its prescribed fix would make things worse. Read this instead.

### 17.1 What is actually happening

The design extracts link the Organic design system's `styles.css`, which sets:

```css
body { margin:0; font-size:15px; line-height:1.55; font-weight:400; }
```

**Every text block in every comp that does not declare its own `line-height` inherits 1.55.** That is why each "design" line box I measured is exactly `1.55 x font-size`, with no exceptions: 8px label -> 12.4, 11px -> 17.05, 13px -> 20.15, 14px -> 21.7. Those are not font metrics. No font produces them: measured at 13px, Caprasimo, Figtree, Georgia, system-ui and generic serif all give 15 to 15.5.

**The build sets no `line-height` on `body` at all**, so it computes to `normal` (about 1.15 to 1.21 for these faces). It then patches `line-height:1.55` onto a handful of individual elements. Measured in the build with the real Google fonts loaded:

| | Design | Build | Patched? |
| --- | --- | --- | --- |
| Card stat label (8px) | 12.4 | **12.4 ✓** | yes, `.st-lbl` |
| Card stat value (14px) | 21.7 | **21.7 ✓** | yes, `.st-val` |
| Health tile label (8px) | 12.4 | **12.4 ✓** | yes, `.score-tile-lbl` |
| Plant name (14px) | 21.7 | **17** | no |
| Plant age sub (11px) | 17.05 | **13.5** | no |
| Name block total | 39.75 | **31.5** | |

Where someone patched 1.55, the build matches the design to two decimals. Everywhere else it is short by roughly a quarter of the line box. **That is the whole "everything looks too short" family of complaints, including "the text in the card looks small": the card's name block is 31.5px against 39.75px, inside a card whose height is fixed by its 42px thumbnail, so the text reads small and floats.**

### 17.2 The fix, and why §13.0's fix was wrong

§13.0 said to delete `line-height` declarations so blocks fall back to `normal`. **Do not do that.** `normal` is the short value. Deleting declarations makes every currently-correct block wrong.

Do this instead:

1. **Add `line-height:1.55` to `body`** in the app's stylesheet, matching Organic. This is one line and it corrects every unpatched block at once.
2. **Then remove the per-element `line-height:1.55` patches** (`.score-tile-lbl`, `.st-lbl`, `.st-val`, and any others) as redundant. They can stay harmlessly, but they hide the next instance of this bug.
3. **Keep every `line-height` the comps state explicitly.** Those are real: Caprasimo display type at `1` (30px headers, 21px tile numbers, 13px room names via the pinned box), `1.1` (sheet titles, celebration heads), `1.15`/`1.2` (first-run and primer heads), and the body-copy values `1.4`/`1.5`/`1.55` already in place.
4. **Re-measure §13.1 to §13.4 afterwards.** The health tile reaches 52.4 today only because of the `min-height:52px` patch; with body at 1.55 it gets there honestly. Leave the `min-height` as a guard, and the same for the room header (§13.8).

### 17.3 What this retires

- §13.0's "the design leaves line-height at normal" is **withdrawn**. The design leaves it at **1.55**, inherited.
- §13.4's Caprasimo-metrics caveat is **withdrawn**. The preview's embedded subset renders Caprasimo line boxes identically to the Google-served font (15px at 13px in both). The preview is safe to measure in. The earlier discrepancy was this inheritance difference, not font metrics.
- The 48 / 50 / 52.4 confusion in §12.4 and §16.1 traces to the same thing: 52.4 is correct, and it equals `8 + 21 + 4 + 12.4 + 7` where 12.4 is the 8px label at 1.55.

### 17.4 The measuring rig

`plantalog-audit-fonts.html` at the project root is the preview with the Google-served fonts layered on top, which is what these numbers were taken in. Use it, or the app itself, and compare against the extracts in `handoff-bundle/screens/`. Both sides must be measured; a declared value proves nothing, and neither does a screenshot.


---

## 18. Round six, sweep 8: the last four screens. Sweep complete

### 18.1 Correct as built, no action

- **Delete-choice dialog (`8a`).** Every value matches: rows at 16px radius with `padding:11px 13px`, `gap:11px` and `--shadow-sm`; 38x38 icon tiles at 12px radius in `#e9f0e0`/`#3f5427` and the danger pair; 15px Caprasimo labels at `line-height:1.15`; 11px sub-lines at `margin-top:3px`, `line-height:1.35`; and the dark overrides for the graveyard tile.
- **Date picker (`13h`).** Also exact, light and dark: popup `#f2e6d2` at 22px radius, `padding:16px 14px`, `0 18px 50px rgba(28,25,20,.42)`; 30px `#fffdf8` nav buttons with `--shadow-sm`; the "Last watered" context label at 9px/800/1.1px uppercase; 20px Caprasimo month at `line-height:1.1`, `margin-top:3px`; `gap:10px`, `margin-bottom:12px`; 34px day tiles at 12px radius with the other-month and dark variants. The round-three fixes all landed.
- **Rooms tab chrome.** Segmented row `padding:4px 14px 7px`, `gap:7px`; active pill `#a3450a` at `7px 17px`; inactive transparent `#645c50` at `7px 13px`; 32px round add button; room rows 43px at 12px radius, `padding:7px 13px 8px`, `gap:10px`, with the 28px pencil circle. All match `13b`.

### 18.2 The room rows are missing their drag handle

`13b` puts **two** controls on the right of each room row: an 18px drag handle (two horizontal rules, stroke 2.75, `rgba(255,255,255,.7)`) and then the pencil in its 28px `rgba(255,255,255,.2)` circle. The build renders only the pencil, so there is no reorder affordance anywhere in the Rooms list even though the data is sorted by an order field.

### 18.3 Edit Room has a card the design does not, and it is the other half of the same story

Design `13c`, measured: dialog 328px wide, 22px radius, `padding:18px 16px 14px`, `gap:12px`, over `0 18px 50px rgba(28,25,20,.42)`. Its children are exactly:

| | Card | Height | Padding |
| --- | --- | --- | --- |
| 0 | "Edit Room" title | 23 | - |
| 1 | Name | 72.95 | `9px 14px 11px` |
| 2 | Colour | 140.95 | `9px 14px 13px` |
| 3 | Preview | 69.09 | `9px 14px 12px` |
| 4 | Delete Room + Save, `gap:7px` | 38 | - |
| 5 | Cancel | 20.5 | `2px 0` |

All three cards are `#fffdf8` at 16px radius. **There is no Sort Order card.** The build inserts one between Colour and Preview.

Taken with §18.2 this is one divergence, not two: the design reorders rooms by dragging the handle in the list, and the build replaced that with a numeric field in the dialog.

**Decided: build the drag-and-drop model from the design and remove the Sort Order card.** The order integer stays as backend state, written by the drag rather than typed by the user. See §18.5.

Everything else about the dialog should be confirmed against the table above in one pass; the geometry was read from the comp but the build side was measured from a screenshot rather than the DOM, which is not good enough to call.


### 18.5 Room reorder: drag and drop, order persisted as a number

The interaction is the design's; the numeric order remains, invisibly, as what gets stored.

**The handle.** Each room row in the Rooms tab gets the 18px two-rule handle from `13b`, stroke 2.75, `rgba(255,255,255,.7)`, immediately left of the pencil circle. It is the drag affordance and the only one: the row itself is not draggable, so tapping a row still opens it and dragging does not fight the scroll.

**The gesture.** Press and drag the handle to lift the row; the row follows the finger and the other rows part to show the drop position; release to commit. Keep it inside the list, vertical only. Reuse the motion vocabulary already in the app rather than inventing new curves: the lift is `--shadow-md` and a `1.03` scale over `.16s var(--ease-enter)`, rows displace over `.2s var(--ease-arrive)`, and the dropped row settles over `.2s var(--ease-arrive)`. Respect `prefers-reduced-motion` by dropping the displacement transitions and keeping the reorder instant.

**Accessibility.** The handle is a real button with `aria-label="Reorder {room name}"`; when focused, up and down arrows move the room one place and announce the new position. A drag-only control is unusable with a keyboard or a screen reader, and this is the cheapest correct answer.

**Persistence.** On drop, rewrite the `order` field of every affected room to its new index and save. The field keeps doing exactly what it does now, so nothing downstream changes: rooms already sort by `order` on Home's Plants tab, on Water and on Repot, and all three pick the new sequence up for free. Do not renumber sparsely or leave gaps; contiguous indices from 0 keep the next drag simple.

**What comes out.** The Sort Order card leaves the Edit Room dialog, which returns it to the comp's five children (§18.3) and its measured height. Nothing else in the dialog moves.

### 18.4 Sweep complete

Every screen in `handoff-bundle/screens/` has now been compared at least once, in both modes where a dark comp exists. Two items carry a **verify** flag rather than a verdict: the Edit Room dialog geometry here, and the Repot row size in §15.6. One screen was never measured: the OOT schedule sheet's own geometry (`util-10a`) beyond the thumbnail and the Cancel button already covered in §12.2 and §12.3.

No open decisions remain. The plant card question (§14.6) is resolved there: the card is already correct and §17 restores its proportions.


---

## 19. Round seven: the §17 fix verified, and three notes closed

### 19.1 §17 landed and Home is now exact

`body{line-height:1.55}` is in the build. Measured with the real Google fonts against the comps:

| | Design | Build |
| --- | --- | --- |
| Health tile | 52.4 | **52.4 ✓** |
| Room header (colored) | 26.15 | **26 ✓** |
| Plant card | 56 | **56 ✓** |
| Card name block | 39.75 | **39.74 ✓** |
| — name / age sub | 21.7 / 17.05 | **21.7 / 17.05 ✓** |
| Card stat column | 35.1 | **35.09 ✓** |

**The whole "everything is too short" family is closed**, and with it the plant-card ratio question (§14.6): the card is at the comp's proportions with no geometry change, exactly as predicted. Do not revisit the thumbnail size.

Also confirmed fixed from §15: the celebration card now takes `--r-lg` (22px), the Undo border is `currentColor` at 50%, the Repot `.pc-body` override exists at `padding:8px 11px 8px 9px; gap:10px`, and the room header pushes its count right via `.room-count{margin-left:auto}` (equivalent to the missing `space-between`; leave it).

### 19.2 Room reorder matches §18.5

Handle is 18px at stroke 2.75 in `rgba(255,255,255,.7)`, `aria-label="Reorder {name}"`, arrow keys call `moveRoom`, the lift is `--shadow-md` with `scale(1.03)`, displaced rows transition `.2s var(--ease-arrive)`, and `commitOrder` writes contiguous indices from 0. The Sort Order card is gone and the dialog is back to three cards. Correct as specified.

**One cleanup:** `formOrder` / `orderError` state and their setters survive in `RoomsTab` with no consumer. Dead, harmless, worth deleting so the next reader doesn't think the field still exists.

### 19.3 The three open notes

**Photo viewer arrows: dropping them is right.** `13d` has no prev/next affordance; the filmstrip is the navigation. Do not restore them. If a future comp adds them this changes, but today the build matches the design and the arrows were an addition.

**Edit Room dialog: structure verified, per-card heights still not measured.** The dialog renders the comp's three cards in order (Name, Colour, Preview) then Delete Room / Save / Cancel, with the 7-column swatch grid, 26px swatches and the selected ring. Against `13c` the values to close are: overlay `rgba(28,25,20,.52)` and `padding:22px`; card `#f2e6d2`, radius 22, `padding:18px 16px 14px`, `gap:12px`, `box-shadow:0 18px 50px rgba(28,25,20,.42)`; title Caprasimo 20px/1.15 centred; Name card `padding:9px 14px 11px` with a 20px Caprasimo value and a 2px `#a3450a` underline; Colour card `padding:9px 14px 13px`, label `margin-bottom:9px`, grid `gap:9px`; Preview card `padding:9px 14px 12px`, label `margin-bottom:8px`, chip radius 12 `padding:3px 12px`.

**OOT sheet geometry, from `util-10a`** (never measured, still open): description 12.5px/600/1.5 `#5d5546`; From and To cards `flex:1`, `#fffdf8`, radius 16, `--shadow-sm`, `padding:9px 13px 10px`, label 9px/800/ls 1.1 uppercase `#6f6658`, value 14px/800 with a 13px calendar icon at `gap:7px` and `margin-top:3px`; summary line 11.5px/700 `#6f6658` `padding:0 2px`; button row `gap:8px` with Cancel `flex:none; padding:0 20px`, `1.5px solid #cfc4b0`, `#fffdf8`, `#474238`, and Create `flex:1`, `#0f4438`, `#fff`, `padding:12px 0`, both 13.5px/800 pills.

### 19.4 Status

Home, the plant card, Water, Repot, the strips, Auth, the empty states, the room reorder and the photo viewer are all verified against the comps. Remaining: the two measurement passes named in §19.3, and a dark pass over §19.


---

## 20. Round eight: the last two measurement passes, and the dark pass over §19

Both passes were run against the DOM on both sides, not from screenshots. The build snapshot is `audit/round8.html`; `audit/round7.html` is kept as the round-seven state.

### 20.1 The three data sheets double every gap

`.data-sheet` got `gap:10px` in round five, but the margins that used to do that job stayed on its children. Every one of them now spaces twice.

| Between | Design (`util-10a`, `util-10b`) | Build before | Cause |
| --- | --- | --- | --- |
| handle → title | 10 | **20** | `.data-sheet-handle{margin:0 auto 10px}` |
| title → first block | 10 | **20** | `.data-sheet-title{margin-bottom:10px}` |
| preview → description | 10 | **20** | `.sched-preview{margin-bottom:10px}` |
| description → dates | 10 | **12** | inline `marginBottom:2` |
| summary → buttons | 10 | **20** | `.sched-count-line{padding:6px 2px 4px}` + the message slot's `marginBottom:10` |

The comps are uniform: 10 between every pair, no margins anywhere, in the export and import sheets as well as the schedule sheet. Fixed by deleting the margins and letting the gap own the rhythm.

The rest of `util-10a`, measured:

| | Design | Build before | Now |
| --- | --- | --- | --- |
| From / To card | 57.64 | 48.95 | **57.64 ✓** |
| — date value | 14px/800, `line-height:1.55` (21.7), `margin-top:3px`, icon 13 at `gap:7` | 13px/500, 16 tall, no offset, `gap:5` | ✓ |
| Cancel / Create row | 40.5 | 36 | **40.5 ✓** |
| — Create | `padding:12px 0`, 13.5px/800 | `10px 0`, 13px | ✓ |
| Description | 12.5px/600/1.5 `#5d5546` | `--bark-light` `#8a7f6d` | ✓ |
| Summary line | 11.5px/700 `#6f6658`, `padding:0 2px`, 17.82 | `--bark-light`, `padding:6px 2px 4px` | ✓ |

Sheet shell was already exact: `padding:15px 16px 20px`, `gap:10px`, `--r-xl` top corners, `#f2e6d2`, `0 -14px 40px rgba(28,25,20,.32)`. Total sheet 464.34 against the comp's 464.16, the 0.18 being the invalid-range message slot standing in for the summary line; with a range picked the two are identical.

**One robustness fix on the way past.** The 4px grab handle is a flex item in a column that can reach `max-height:88dvh`; with `min-height:auto` resolving to 0 it shrinks to nothing on a short viewport, so the sheet loses its handle exactly when it most looks like it needs one. It now carries `flex:none`.

### 20.2 Edit Room: five values, and it belongs to the date picker's family

Against `13c`, the dialog was 437.28 where the comp is 456.48. All 19.2 of it was in five places:

| | Design | Build before | Now |
| --- | --- | --- | --- |
| Name card | 72.95 | 60.74 | **72.95 ✓** |
| — value | 20px Caprasimo at 1.55 → 31 | `line-height:normal` → 25.74 | ✓ |
| — rule | 2px `#a3450a` pill, `margin-top:4px` | missing | ✓ |
| — padding | `9px 14px 11px` | `9px 14px 10px` | ✓ |
| Colour card | 140.95 | 137.95 | **140.95 ✓** (`9px 14px 13px`) |
| Preview card | 69.09 | 67.09 | **69.09 ✓** (`9px 14px 12px`) |
| Delete + Save row | 38 | 36 | **38 ✓** (`padding:11px 0`) |
| Dialog | **456.48** | 437.28 | **456.48 ✓** |

Correct as built and left alone: title 23 at Caprasimo 20/1.15 centred; dialog `padding:18px 16px 14px`, `gap:12px`, `--r-lg`; cards `#fffdf8` at `--r-md`; labels 9px/800 at 1.1px uppercase with `margin-bottom` 9 and 8; the 7-column swatch grid at `gap:9px` with 26px swatches and the ring; the preview chip at `--r-sm`, `padding:3px 12px`, 26.15, Caprasimo 13 name and 10px/800 count pushed apart; Cancel 20.5 at 13.5/800. Dialog width is the frame minus a 22px gutter on each side, which is 328 in the comp's 372 frame and 346 in the app's 390: the same rule, not a divergence.

**The family correction.** The build hung Edit Room off the bottom-sheet overlay: `align-items:flex-end` overridden inline to centre, a cool `rgba(0,0,0,.48)` scrim, no gutter, `--sand` and `--shadow-lg`. `13c` draws it exactly as `13h` draws the date picker: centred over `rgba(28,25,20,.52)` with a 22px gutter, `#f2e6d2`, `0 18px 50px rgba(28,25,20,.42)`. Those values already exist in the build as `.cal-popup-overlay` / `.cal-popup`, so this is one `.modal-overlay.dialog` variant (with its own warm veil keyframes) plus two lines on `.room-edit-card`, not a new pattern. Dark follows `.dark .cal-popup` and takes `--surface`.

### 20.3 Dark pass over §19

The §17 line-height fix is mode-independent, and the dark build confirms it: health tile **52.4**, plant card **56**, coloured room header **26** against `24e`, unchanged from light. Nothing in §19's list moves between modes.

Two dark gaps did turn up in the sheet work, both from light values with no dark counterpart:

- **Grab handle** stayed `#cfc0a6` in dark where `10e` has `#4a4539`. Fixed.
- **From / To cards** took `--surface` `#2b2823`, which is the dark sheet's own background, so the cards disappeared into it. `10e` raises them to `#3a352d`. Fixed.

Description and summary line both resolve to `--text-muted` in dark, which `10e` confirms (`#a99e8c`), so only the light description needed its bespoke `#5d5546`.

### 20.4 Decided: dark's filled primary is a bright fill with dark ink

Looking harder at the four dark instances dissolved the conflict I first wrote up here, and moved the answer the other way.

| Dark comp | Element | Fill / ink | What it is |
| --- | --- | --- | --- |
| `util-10e` | Create | `#3f9d6d` / `#04210f` | filled primary pill |
| `util-10h` | Done | `#3f9d6d` / `#04210f` | filled primary pill |
| `util-10f` | Download | `#1e2f22` / `#9ddcb0`, dashed `#58896a` | **not** a primary pill: the export sheet's CTA is dashed in light too (`10b`) |
| `23b` | Turn on notifications | `#15644a` / `#e5efd6` | the light `#0f4438` / `#f2f0d8` with the token swapped, drawn from `--primary` rather than decided |

So `10f` was never a competing primary, and `23b` is inherited rather than authored. The two deliberate instances agree, and they agree with the rest of dark: `6c` fills its header Save `#f2a13b` on `#3a1d05` and its steppers `#2f93bb` / `#d1762c` on dark ink. Dark's affirmative action is a bright fill with dark ink; a `#15644a` fill on a `#2b2823` sheet is the weakest contrast of the set and reads as disabled.

**Adopted:** one pair, `--primary-btn:#3f9d6d` / `--primary-btn-ink:#04210f`, defined in `.dark` only and applied to the filled primary buttons (`.btn-primary`, `.pm-bottom-btn.save`, `.score-tip-gotit`, `.firstrun-btn.primary`). It is a separate pair from `--primary` on purpose: `--primary` is also the nav bar, the page headers, the auth ground and the selected calendar day, and `24e` confirms those stay the deep green. Light is untouched.

**Redrawn:** `23b`'s CTA now carries the adopted pair. `util-10e` and `util-10h` already did. The export and import sheets keep their dashed CTA.

Two spots where the build keeps a token instead of a comp one-off, deliberately, both below the perceptual threshold: the sheet Cancel border (`--btn-border` `#c9bda6` against the comp's `#cfc4b0`) and Save/Create ink in light (`--primary-ink` `#f2f0d8` against `#fff`).

### 20.5 §19.2 cleanup done

`formOrder` / `setFormOrder` / `orderError` / `setOrderError` and their four remaining setter calls are gone from the Rooms tab, along with the `.room-order-input` rule the Sort Order field left behind. Nothing read any of them.

### 20.6 Status: the sweep is closed

Every screen in `handoff-bundle/screens/` has been measured against the build in every mode a comp exists for, and no item now carries a **verify** flag. §19.3's three notes are closed: the photo viewer keeps no arrows, the Edit Room dialog measures 456.48 on both sides, and the OOT sheet is measured end to end. §20.4 is decided and applied, so nothing is waiting on anyone.


---

## 21. Round nine: the measurement rig, and the one real fix in it

This round produced almost no design change and one important correction to *how* the comps get measured. Both findings came out of a disagreement about a single number, which is the useful kind.

### 21.1 A broken stylesheet link reads as a plausible number

The screen extracts in `screens/` link the Organic token sheet on line 3 and set only a page background in their own `<style>`. Everything that makes them the comp comes from that link, including `styles.css` line 82:

```css
body { margin: 0; font-size: 15px; line-height: 1.55; font-weight: 400; }
```

and line 2, which `@import`s Caprasimo and Figtree. So when that link fails, an extract loses §17's line-height **and both typefaces at once**, and still renders: text blocks come out about 25% short and control heights shift by about a pixel. Nothing errors. Every number measured off that page is wrong in a way that looks like a real finding.

That is exactly what happened this round. A copy of `screens/` was measured without `_ds/` beside it, which made the comp appear to lack §17, which in turn made a correct build value look like a defect. The proposed repair, adding `line-height:1.55` to the extract's own `<style>`, would have hidden the broken link behind the right number while leaving the ramps, radii and fonts still missing.

**Two things changed as a result.** The extracts now link `../_ds/` and the stylesheet ships inside `handoff-bundle/_ds/`, so the bundle is self-contained. And the check goes in the README: before trusting any measurement from an extract, confirm `document.fonts.status === "loaded"` and `getComputedStyle(document.body).lineHeight === "23.25px"` (15 × 1.55). If it reads `normal`, the page is not a comp.

### 21.2 The global control rule: tried, measured, rejected

§17 does not reach `<button>`, `<input>`, `<select>` or `<textarea>`, because form controls don't inherit font properties from `body`. The tempting fix is one rule:

```css
button, input, select, textarea { line-height: inherit; }   /* do not do this */
```

It was applied and measured, and it regressed three previously-verified elements immediately:

| | Comp | Before | With the global rule |
| --- | --- | --- | --- |
| Save button (`6a`) | 31 | 31 ✓ | 36.14 ✗ |
| Tab pill (`13b`) | 29 | 29 ✓ | 34.14 ✗ |
| Utilities button (`9a`) | 31 | 31 ✓ | 35.38 ✗ |

The reason is that the comps' controls are at `normal` too: `13c`'s Cancel button computes `line-height: normal` in the comp, the same as in the build. The two sides already agreed, and forcing inheritance broke the agreement everywhere the comp also uses a control. **The rule stays out.**

### 21.3 The real rule: compare element types, not just text heights

The mismatch is never global, it is per element, and it appears wherever **the comp draws text in an ordinary element and the build substitutes a form control**. The comp's element inherits 1.55; the build's control gets the UA default; the build measures roughly 25% short on that one line.

Two confirmed instances, both fixed with an explicit `line-height:1.55` on the specific class:

| Comp element | Build element | Comp height | Fix |
| --- | --- | --- | --- |
| `util-10a` From / To value, `div` 14px | `button` (`CalendarField`) | 21.7 | `.sched-date-card .cal-field-btn` |
| `13c` / `6a` Name value, `div` 20px Caprasimo | `input` | 31 | `.pm-name-input` |

The second one is why this section exists: 20px Caprasimo appears twice in `13c`, as the dialog title at an explicit 1.15 (23 tall) and as the name value inheriting 1.55 (31 tall). Same face, same size, different line-height, 8px apart. Measuring the title and comparing it to the value is an easy and completely silent error.

**So the check, before matching any text height: what element is it on each side, and does that element inherit?**

### 21.4 Edit Room, re-derived from measured children

Requested as a cross-check on §20.2's total, since a computed figure that no longer matches its parts is how the earlier 48 / 50 / 52.4 tile drift started. Measured off the comp's DOM, child by child:

| Child | Height |
| --- | --- |
| Title (Caprasimo 20 at 1.15) | 23 |
| Name card (13.95 label + 31 value at `mt 2` + 2 rule at `mt 4`; pad `9px 14px 11px`) | 72.95 |
| Colour card (pad `9px 14px 13px`) | 140.95 |
| Preview card (pad `9px 14px 12px`) | 69.09 |
| Delete + Save row | 38 |
| Cancel (button, `normal`) | 20.5 |
| 5 × `gap: 12` | 60 |
| Padding 18 + 14 | 32 |
| **Total** | **456.49** |

Children sum to 364.49, so **456.48 is measured, not computed**, and §20.2 stands.

### 21.5 The two button heights in `13c`, since they were the residual

Read straight from the comp's markup, because a half-pixel here was mistaken for a font-metric difference:

- Delete / Save: Figtree **13px**/800, `padding: 11px 0`, no border → **38**
- Cancel: Figtree **13.5px**/800, `padding: 2px 0` → **20.5**

The 0.5px difference between them is the font-size difference, nothing subtler. A build measuring 20 for Cancel is at 13px where the comp is at 13.5.


### 21.6 Correction: those two button heights are not specifiable, and `fonts.status` cannot detect a missing face

A second disagreement over the same 1.53px resolved by probing the font rather than re-measuring the elements. Measured in the comp page itself, at `line-height: normal`:

| Face at 13px/800 | Line box | Button (+22 padding) |
| --- | --- | --- |
| Figtree | 16 | **38** |
| fallback sans-serif | 15 | **37** |

and at 13.5px/800, Figtree gives 16.5 → Cancel **20.5** where the fallback gives ~15.5 → **20**.

So the 37 / 20 / 454.95 reading is the signature of a page where Figtree never resolved, and §20.2's 456.48 (Figtree present, `document.fonts.check('800 13px Figtree') === true`) stands.

**The rig check in §21.1 was insufficient and is corrected here.** `document.fonts.status === "loaded"` only means no load is still pending: it reads `"loaded"` when every font request has *failed*. Likewise `body` at `15px / 23.25px / 400` comes from CSS and stays true with no webfonts at all. All three signals pass on a page with zero fonts. The check that actually discriminates is availability:

```js
document.fonts.check('800 13px Figtree') && document.fonts.check('20px Caprasimo')
```

**And the durable fix: stop specifying these two heights.** 38 and 20.5 are not designed values; they are padding plus whatever `normal` yields for whichever face resolved, so they will differ legitimately between environments and are worthless as targets. What is designed, and what both sides already agreed on, is the padding and the font size:

- Delete / Save: Figtree 13px/800, `padding: 11px 0`, no border
- Cancel: Figtree 13.5px/800, `padding: 2px 0`

Match those and the total follows. §21.5's table should be read as evidence for the 0.5px font-size difference between the two buttons, not as a height spec. The same caution applies to any control whose height is padding + `normal`: specify the inputs, never the derived box.

### 21.7 Closed: `body{font-weight}` 400 against the app's 600 is invisible. Leave it.

Organic sets `body{font-weight:400}`; the app sets 600. That difference can only surface on text declaring no weight of its own, so the question is whether any such text exists.

Audited rather than reasoned about. Across `24a`, `6a`, `util-9a`, `7a` and `13b`, every element whose computed weight is 400 with no `font-weight` in its own declaration was collected (Caprasimo excluded, since the display face carries its own weight). The result is the same on all five screens:

| Elements inheriting weight 400, with rendered text | Count |
| --- | --- |
| `<style>`, `<script>`, `<title>` (not rendered) | 3 |
| The extract's own caption line under the screen title, 13px | 1 |
| **Inside the phone frame** | **0** |

Every text element in the actual UI declares its own weight. The single real element is the extract's annotation ("Initial tiles, truncated names…"), which is scaffolding around the comp, not part of it.

So the app's `body{font-weight:600}` has nothing to act on: no comp element and no build element depends on inheriting it. **Changed nothing.** Had it been swapped to 400 on the strength of the token mismatch alone, the result would have been a no-op at best, and at worst a silent regression on anything added later that does rely on inheritance, since 600 is what the rest of the app's rules are written against.

This is the third time in two rounds that a token-level difference between Organic and the app turned out not to be a defect (`line-height: inherit` in §21.2, the two button heights in §21.6, this). The pattern worth keeping: **a difference in a declaration is not a difference in the render.** Confirm an element actually resolves to the wrong value before treating a mismatched rule as a bug.

Also landed this round, read verbatim from the token sheet rather than estimated: `--shadow-md: 0 3px 10px` @16% (was `0 6px 18px`) and `--shadow-lg: 0 12px 32px` @22% (was `0 22px 54px`). Both had been approximations and both were far too heavy; this closes the long-running "elements lack a shadow accent" thread with real numbers. `--shadow-sm` was already correct.


### 21.8 Rig parity: measure the face production will actually serve

The 38-versus-37 disagreement in §21.6 was not a fallback after all, and not a mystery either. Both sides had a genuine Figtree loaded, confirmed by `document.fonts.check('800 13px Figtree')` and by identical glyph advances (a 13px/800 "Delete Room" measures 77px wide on both). They were different *builds* of it:

| Surface | Where Figtree comes from | 13px/800 line box |
| --- | --- | --- |
| `screens/` extracts | Google Fonts (`fonts.googleapis.com`, via the extract's own link and `styles.css`'s `@import`) | 16 → button **38** |
| `index.html` (production) | Google Fonts | 16 → button **38** |
| `plantalog_preview.html` | fontsource, inlined as base64 `@font-face` for weights 400–900 | 15 → button **37** |

Same family, same horizontal metrics, different vertical metrics. Which means **the preview harness measures a face that neither the comps nor the shipped app render.** Any height that falls out of `line-height: normal` reads about a pixel short there, and the discrepancy is invisible: every availability check passes, because the font genuinely is available.

For the two `13c` buttons this is moot, since §21.6 already stopped specifying their derived heights. It will recur on the next control whose box is padding plus `normal`, so:

**Have the preview link the same font URL production links, rather than inlining its own copy.** `index.html` uses `fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;700;800;900&display=swap`; the preview should use that and drop the base64 blocks. Inlining is the right call for an offline-capable single file, but it makes the file a different rendering surface from the app, and a measuring rig has to be the same surface as the thing it measures. (The fontsource URLs in `PDF_FONT_URLS` are unrelated and correct: jsPDF needs a TTF it can embed, and that path never touches DOM layout.)

**Also worth keeping, from the same round:** a font-availability guard has to run *after* something using the font has rendered. Fonts are not requested until a layout needs them, so an early `document.fonts.check` returns false on a page that will load them perfectly well a moment later. A guard that checks too early reports a broken rig that isn't broken, which is the mirror image of §21.6's `fonts.status` trap: one false negative, one false positive, both from asking at the wrong moment.

The general form of all three §21 rig findings: **verify the surface before trusting the measurement.** Confirm the stylesheet resolved, confirm the face is available, confirm it is the same face production serves, and confirm you asked after render.

Nothing in §21 is left open.
