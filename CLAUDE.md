# Plantalog project notes

- Never use em dashes (—) anywhere in this project: not in app UI copy, not in commentary. Use a period, comma, colon, or semicolon instead.

---

How to verify design fixes

Don't trust CSS by reading it, and don't compare screenshots by eye — both missed real bugs in this project. Instead:

Open the actual design reference (screens/ in the design folder) and the actual running app, in a real browser, side by side.
For the specific element you're checking, get its real pixel size and position with getBoundingClientRect() — compare the two directly. A style can look correct in the code and still not be what's rendering (e.g. the code styles a CSS class that the component isn't even using) — actual on-screen measurement catches that; reading the code doesn't.
Before trusting any font-related measurement, confirm the real fonts are actually loaded in both the design reference and the app — don't just check document.fonts.status, since it can report "loaded" even when a font failed, and checking too early (before the page finishes rendering) can also give a false "not loaded." Use document.fonts.check('<weight> <size> <family>') after the page has settled, or compare rendered text width against a generic fallback font — if the widths differ, the real font is genuinely being used.
If a fix doesn't show up when you re-check, verify the code is actually connected to what's rendering before assuming the value itself is wrong.