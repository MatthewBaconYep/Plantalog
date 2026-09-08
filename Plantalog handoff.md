# Plantalog: build spec

Design handoff for the app rebuild. Everything here is decided. Where something is deliberately left open it says so.

Visual reference lives in three files that accompany this spec: `Plantalog Concepts.dc.html` (all screens, newest work at the top, each option carries a visible id like 24b), `Plantalog Dark Mode.dc.html`, `Plantalog Utilities.dc.html`, and `Plantalog Motion.dc.html` (every animation, playable). Ids in this document refer to those.

Current implementation is `plantalog.jsx`. This spec is a change list against it, not a greenfield build. Section 8 lists what actually differs.

---

## 1. Type

| Role | Face | Notes |
| --- | --- | --- |
| Display, headings, numbers that matter | Caprasimo, 400 only | Screen titles, plant names, big stats, section headers |
| Everything else | Figtree, 600 / 700 / 800 | Body, labels, buttons, meta |

Sizes in use, and what they are for:

- 33px Caprasimo: app wordmark in the header
- 31px Caprasimo: plant name on a detail hero that has a photo
- 28px Caprasimo: plant name on a detail hero with no photo (it has the full width, so it can be larger than it looks)
- 26px Caprasimo: sub-screen titles (Notifications, Recently Deleted)
- 19 to 23px Caprasimo: panel headings, stat values
- 14px / 700: plant name in a list row
- 12.5 to 13px / 600: meta and secondary text
- 11px / 800: pills and badges
- 8px / 800, 0.6px tracking, uppercase: the three-column stat labels on cards (Every, Next, Pot)

8px is the floor. It is only ever used for those uppercase micro labels, which are heavy and widely tracked. Do not use 8px for sentence text.

## 2. Colour

### Light

| Token | Value | Use |
| --- | --- | --- |
| ground | `#f5ead8` | app background |
| surface | `#fffdf8` | cards, panels |
| text | `#201e1d` | primary text |
| text-muted | `#6f6658` | meta, labels |
| border | `#e6dbc7` | hairlines, dashed slots |
| primary | `#0f4438` | headers, nav, primary buttons |
| primary-ink | `#f2f0d8` | text on primary |
| accent | `#a3450a` | Save, Edit, the Sunroom room colour |
| sand | `#efe4cd` | secondary buttons, neutral chips |

### Dark

| Token | Value |
| --- | --- |
| ground | `#1f1d1a` |
| surface | `#2b2823` |
| text | `#f0e9dc` |
| text-muted | `#a99e8c` |
| border | `#3c3830` |
| primary | `#15644a` |

### Domain colour

Water is blue, potting is clay, and they keep those colours everywhere they appear.

| Domain | Light | Dark |
| --- | --- | --- |
| Water panel | `#17627f` on `#eaf6fc` text | `#134b64` / text `#dcf0f9` |
| Water tint | `#e6f2f8` / text `#12556e` | `#173f52` / text `#a5cfe3` |
| Potting panel | `#ffe1d0` / text `#5c2a08`, heading `#8c3f07` | `#5c2e10` / text `#fbdcc4`, heading `#f7c9a3` |
| Error, destructive | `#a32e22` on `#fbe0dc` | `#ffb3a8` on `#4a1f1a` |
| Offline, warning | `#8a4c06` on `#ffe6c0` | as light, tinted down |

### Health

Four bands, fixed. Bar colour, tile fill, tile text:

| Band | Bar | Tint | Ink |
| --- | --- | --- | --- |
| Thriving | `#0f9d58` | `#c8f2d9` | `#0a5c34` |
| Good | `#7cc63f` | `#e4f7c8` | `#3f6b16` |
| Caution | `#f2a13b` | `#ffe6c0` | `#8a4c06` |
| Dying | `#e0483a` | `#ffd7d2` | `#97281d` |

Dark tints: `#0f4a30`, `#334a15`, `#5a3a08`, `#5e211a`, with inks `#86ecad`, `#c3ee85`, `#ffc879`, `#ff9d92`.

Room colours are per room and are not on this scale. They are set by the user, drawn from the same tint family.

## 3. Radius, elevation, spacing

Radius is a five-step scale plus the pill. No other values.

| Step | Value | Use |
| --- | --- | --- |
| xs | 6px | health bar segments, room chips |
| sm | 12px | thumbnails, small tiles, list rows inside panels |
| md | 16px | cards, grouped rows, list cards |
| lg | 22px | panels, sheets, large containers |
| xl | 30px | dialogs |
| pill | 999px | every button, every badge, every chip |

The 44px value is the phone bezel in the mockups. It is not a UI radius.

Elevation, light only. Dark mode uses no shadows; it separates with surface colour.

- sm `0 1px 3px rgba(60,40,20,.09)` for cards
- md `0 6px 18px rgba(60,40,20,.13)` for raised panels and tooltips
- lg `0 22px 54px rgba(60,40,20,.2)` for sheets and dialogs

Layout constants:

- Header is 102px tall on every top-level screen. Wordmark left, mark right, status row above.
- List gutters are 14px, gaps between cards 6px.
- Panels inside a screen sit 10px apart.
- Minimum tap target 44px. The check buttons are 34px visually with padding making up the rest.

## 4. Motion

Four curves. Nothing outside these.

| Name | Curve | Use |
| --- | --- | --- |
| enter | `cubic-bezier(.16,.84,.44,1)` | anything arriving from off screen |
| exit | `cubic-bezier(.4,0,1,1)` | anything leaving |
| collapse | `cubic-bezier(.22,.61,.36,1)` | space opening or closing. Never overshoots |
| arrive | `cubic-bezier(.34,1.28,.64,1)` | small overshoot, only for things the user just created |

Two rules that hold everywhere: exits are always shorter than the matching entrance, and only one element moves at a time.

| What | Trigger | Spec |
| --- | --- | --- |
| Card leaves (water, repot) | tap the check | opacity 180ms exit, `translateX(-108%)` 240ms exit |
| Row slot closes | after the card leaves | height and margin to 0, 340ms collapse, 100ms delay |
| Room header leaves with its last plant | last card in a room watered | header and card animate as one object, same 240ms slide, then collapse together over 340ms. Do not stagger |
| Up Next rises | list above it shrinks | moves with the collapse. The gap above it animates down to its minimum and stops there. That buffer is never consumed, so All done has room without shoving Up Next back down |
| Undo appears | after a card leaves | opacity plus `translateY(3px)` to 0, 220ms enter, 120ms delay |
| All done | last card gone | mark: 300ms arrive, 120ms delay. Text: 260ms enter, 200ms delay |
| Detail opens | tap a plant | screen rises `translateY(100%)` to 0, 340ms enter, veil fades 260ms. The screen is a card: 35px radius all four corners, shadow on the leading edge |
| Detail closes | back or swipe | 260ms exit |
| Screen change | tab switch | outgoing fade 160ms exit, incoming fade 200ms enter with 60ms delay. Opacity only. Never transform: a transformed ancestor becomes the containing block for fixed children and detaches any open sheet |
| Plant added | save from New Plant | card fades and scales 0.955 to 1, 260ms arrive. Room count ticks 300ms arrive, 60ms delay |
| Tab picked | tap the nav | icon lifts 3px and scales to 1.12 and returns, 260ms arrive |
| Health bar | screen appears | width from 0, 600ms collapse, 80ms delay |
| Home wakes | cold start, or warm resume on a new day | see below |
| Score tooltip | tap the score | opacity plus 5px rise and 0.975 scale, 180ms enter |

`prefers-reduced-motion: reduce` disables all of it. Elements go straight to their end state. This already exists in the current code and must survive.

### Home waking up

Fires on **cold start, always**: process launch, relaunch after the user force-quits from the app switcher, and sign-in. A cold start already shows the loading screen, and Home arriving fully formed straight after a splash is the abrupt handoff this animation exists to fix.

Fires on **warm resume** (app still in memory, returning from background) **only when the last foreground was on an earlier local day**. It must not fire on tab switches or on returning from a sheet.

Use the calendar day rather than a rolling number of hours for the warm case. Due dates roll over at midnight, so the first open of a new day is the one occasion where the tiles and the score actually changed while the user was away, and the entrance is pointing at something real. A rolling 8 or 12 hour window fires on a boundary unrelated to the data, and depending on the user's sleep it fires twice some days and not at all on others. Store the last foreground date and compare local calendar days.

| Element | Animation | Duration | Curve | Delay |
| --- | --- | --- | --- | --- |
| Header | fade | 260ms | enter | 0 |
| List | fade plus 10px rise | 300ms | enter | 120ms |
| Filter tiles, five | fade plus scale 0.9 and 8px rise | 260ms each | arrive | 60, 100, 140, 180, 220ms |
| Score label and percentage | fade | 240ms | enter | 300ms |
| Health bar | width from 0 | 520ms | collapse | 300ms |

Total is roughly 820ms, but the last 520 of that is a bar filling, which nobody waits on.

Three rules that matter more than the numbers:

1. **Everything is interactive from the first frame.** The entrance never gates a tap. If a user taps a plant 100ms in, the detail opens and the entrance is abandoned.
2. **One stagger, not five bounces.** The tiles share one pass 40ms apart. Individually overshooting tiles read as busy rather than composed.
3. **The bar fills last, alone.** It is already the longest animation in the app at 600ms. Here it is shortened to 520 and delayed until the tiles have landed, so two things are never moving at once.

Under reduced motion the whole thing is skipped and Home appears complete.

Decided and rejected: growing the tapped thumbnail into the hero. It looks better from a card near the top and worse from one near the bottom, and it breaks entirely when the origin card has scrolled away, which the close animation depends on. The sheet has no such dependency. Both are demonstrated in `Plantalog Motion.dc.html` if the decision ever needs revisiting.

## 5. Screens

### Home
Header, five filter tiles (All, Thriving, Good, Caution, Dying), health score bar, Plants and Rooms tabs with the add button, then the list grouped by room. Room chip carries the room colour and its count. The count must match the plants in that group.

### Plant card
Health colour bar down the left edge, thumbnail, name, age, then three stat columns: Every, Next, Pot. The name stays on one line and truncates with an ellipsis. Do not wrap it. The three numbers are what the row exists for.

### View Plant
Photo hero 216px with the gradient, room, name, status pills. Below: Watering panel, Potting panel, photo grid, Notes.

With no photo the hero collapses to a compact primary-coloured block: room, name at 28px over up to three lines, status pills. No thumbnail, so the title has the full width. The photo grid carries the prompt to add one. Screens 24b and 24c.

### Add and Edit Plant
Grouped cards, tap targets over typing. Name and Got on one row, then Room, Health, Watering, Potting, Notes. Edit adds Clone and Delete at the bottom.

### Water and Repot
Checklists. Card sheds the stat columns and gains a large check button. Grouped by room, then Up Next below the buffer. Empty state is All done with the next date.

### Utilities
Grouped rows, labelled sections. Sub-screens (Notifications, Recently Deleted, and so on) use a 102px header with a back chevron, title, and one line of subtitle.

### Auth
Login is the one screen where the brand gets room: 42px wordmark on the primary ground, slogan underneath, then email, password, Sign in, Forgot your password, Create account. Errors sit under the field they belong to, never in a banner.

Slogan, final: **Tracking your green family, made simple.**

### Notification primer
A popup over Home with a dimmed backdrop, not a screen. Fires before the OS prompt, since the OS prompt is one-shot and a no is permanent.

Headline: **Plantalog remembers so you don't have to**
Body: **Want Plantalog to tell you when you have plants due for water or a new pot? You can change notification timing or turn them off any time in Utilities.**
Buttons: **Turn on notifications** (primary) and **Not now** (text, returns to Home).

Icon, headline and body are left aligned. Not now is centred under the button. Screens 23a and 23b.

## 6. Rules the code must honour

1. **Name cap is 60 characters.** No counter below 45. From 45 the counter appears in the muted tone. At 60 typing stops and the counter and the field rule turn coral. No error message: the coral 60 / 60 says it. Screens 25a and 25b.
2. **Card names truncate, hero names wrap.** One line with ellipsis in a list row. Up to three lines then truncate on the detail hero.
3. **No photo means an initial tile,** not a camera glyph. Sage tint, the plant's first letter in Caprasimo. Same treatment at 42px in a row and in the detail hero block.
4. **Deleting a plant does not ask.** It goes to Recently Deleted and shows a toast with Undo. A confirmation before a reversible action trains people to tap through dialogs. Recently Deleted holds for 30 days.
5. **The Up Next buffer is a minimum, not a margin.** It never collapses past its floor, in any list state.
6. **Room counts are computed,** never authored. Every mismatch found in review was a hardcoded number.
7. **Offline and sync failure are strips above the list,** not dialogs. Neither blocks logging. A plant is thirsty whether or not the server heard about it. The failure strip names the count, says the data is safe locally, and offers Retry inline.
8. **One notification a day at most,** listing everything due. Not one per plant. No streaks, no badges, no unsolicited tips. This is a promise the primer makes explicitly.

## 7. Dark mode

Every screen has a dark counterpart in the concept files. Two things that are easy to get wrong:

- Shadows are removed entirely, not softened. Separation comes from surface colour.
- Panel colours deepen rather than desaturating: water `#17627f` to `#134b64`, potting `#ffe1d0` to `#5c2e10`. The header green goes `#0f4438` to `#15644a`, which is lighter, because it sits on a dark ground rather than a cream one.
- Room colours do **not** change in dark. A room bar is the same `#a3450a` with `#fff8f2` on both grounds. Rooms are the user's own colour and stay put.

The dark domain values above were corrected against the concept files on 12 Aug 2026; the earlier draft of this table carried `#0d4d66` and `#4a2a12`, which the comps no longer use.

## 8. What changes against the current `plantalog.jsx`

Ordered by size of change.

**New work**
- Notification primer popup, before the OS prompt. Does not exist today.
- 60-character name cap with the threshold counter.
- Initial-tile fallback for plants with no photo, in rows and in the detail hero.
- No-photo detail hero variant (collapsed header block).
- Offline and sync-failure strips.
- Recently Deleted screen with the delete toast and Undo.
- Add-plant animation, tab-bar animation.

**Retuned motion**
- Screen cross-fade goes from 90ms to 160ms out and 200ms in. 90ms reads as a flicker.
- All done goes from a flat fade to the mark arriving on the overshoot curve with the text 80ms behind.
- New fourth curve, arrive, for things the user just created. The existing three were all restrained, which is why the app feels correct but never pleased.

**Visual**
- Radius collapses from twelve ad-hoc values to the five-step scale in section 3.
- Header pinned to 102px with the wordmark-left, mark-right lockup, on every top-level screen.
- Header and nav green is the same on every tab. No per-screen tinting.
- Pill radius written one way: `999px`.

**Unchanged, deliberately**
- The watering confirmation (slide, collapse, Undo). It was already right.
- The sheet entrance and the veil.
- The health bar count-up at 600ms.
- The reduced-motion block. Keep it and extend it to cover the new animations.

## 9. Input: pointer and touch

The app is a 480px max-width column centred on the ground colour at every size. Desktop and tablet get the phone layout, centred, not a separate layout. That is a deliberate choice and this spec does not change it.

### Hover

Every hover state must stay inside `@media (hover:hover) and (pointer:fine)`. This already guards the check button in the current code, for a good reason recorded there: tapping a check removes the card, the list reshuffles, and the next card's button lands under the finger, inheriting a stuck hover that never clears because there is no mouse to move away.

Hover treatments, all 150ms:

- Primary button: `#0f4438` to `#15644a` (dark: `#15644a` to `#1c7a5c`)
- Secondary and outlined: fill with `#efe4cd` (dark: `#3c3830`)
- List row or card: shadow from sm to md. No movement, no scale
- Destructive: `#a32e22` to `#8f2b1e`
- Icon button: background opacity from .16 to .26

### Focus

Keyboard focus is visible everywhere: `outline: 2px solid #0f4438; outline-offset: 2px`, and `#8fd8b4` on dark or on a primary-coloured ground. Never remove the outline without replacing it. Desktop users tab through this app.

### Touch targets

44px minimum. Where a control looks smaller (the 34px check buttons, the 30px icon buttons), padding makes up the difference. Do not shrink the hit area to match the visual.

### Swipe down to close the detail

The detail arrives as a sheet, so it should leave like one.

- **Drag starts** on the hero, the header area, or anywhere in the body when it is already scrolled to the top. Once the body has scrolled, vertical drags belong to the scroller, not the sheet. Do not fight the scroll.
- **The sheet tracks the finger** one to one downward. Upward drag past the open position is rubber-banded: `translateY = -sqrt(-delta) * 3`, so it resists rather than sticks.
- **The veil tracks the drag,** fading from .42 to 0 in proportion to distance travelled. The connection between the gesture and the darkening is what makes the sheet feel physical rather than animated.
- **Release commits** if the drag passed 25% of sheet height OR downward velocity exceeded 0.5px/ms. Velocity matters more than distance: a fast flick from near the top should close, and a slow drag past halfway should also close.
- **Committing** continues to `translateY(100%)` on the exit curve, over the remaining distance at a minimum of 160ms and a maximum of 260ms, so a nearly-closed sheet does not crawl the last few pixels.
- **Cancelling** returns to 0 over 240ms on the enter curve.
- **The grab handle** (38 by 4, `#d8cbb4`, centred, 12px above the content) is the affordance. It is the only thing on screen that says this can be dragged, so it stays even though the sheet is full height.
- **Reduced motion**: the gesture still works, but release snaps rather than animating.

Also expected, but not designed yet: swipe left on a plant card to reveal water and delete. Flag it if you want it, and note that it competes with browser back-swipe on the left edge, so it should be a right-to-left drag only, with the actions revealed under the card rather than the card sliding fully off.

## 10. Open

- Search and filter, and bulk actions such as watering a whole room: explicitly out of scope for now.
- A nickname field, separate from the plant name. People currently write things like "Calathea orbifolia, the one by the door" because they own two. Not designed yet.
- Pull to refresh has no motion and no design.
