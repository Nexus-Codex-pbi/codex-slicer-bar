# Codex Slicer Bar — Roadmap

## Shipped
- **v1.1.1.3** — current. Filter-out via `applyAllFilters()` (multi-section stacking), `general.filter` capabilities declaration, per-section dataView cache. Awaiting Partner Center cert clearance (resubmitted 2026-05-17 after dev profile verification).

## Next — v1.1.2.0 — Header Bar (Title + Logo)

**Concept:** turn the visual into a header bar with slicers built in. Independent title and logo positioning makes it usable as the page banner, not just a filter row.

**Format pane additions:**

```
Header                       (default OFF — preserves existing reports)
  Show Header                [toggle]
  Header Height              [10–80 px, default 36]
  Header Background          [color]

Title
  Show Title                 [toggle]
  Title Text                 [text]
  Title Position             [Left / Center / Right]
  Font Family / Size / Bold / Italic / Underline / Color

Logo
  Show Logo                  [toggle]
  Logo Image                 [image picker — base64 data URI, cert-safe]
  Logo Position              [Left / Center / Right]
  Logo Height                [auto / 16–64 px]
```

**Layout rules:**
- Header band renders ABOVE the existing chip area (not in the PBI host title strip).
- Title and Logo each pick one of three slots: Left / Center / Right.
- If both pick the same slot → side-by-side, **logo first, then title** (matches navbar convention). Applies to all three slots; centered group when slot=Center.

**Cert touch-ups required:**
- `selectionManager.showContextMenu({}, …)` listener extended to the header element (not just chip body) — Policy 1180.2.5.
- Header region must fill edge-to-edge with no outer padding (see `feedback_pbi_padding_deadzone.md`).
- Sample `.pbix` should include one page with the header enabled and one without, so the reviewer can verify both modes.

**Logo storage:**
- Built-in PBI image picker → base64 data URI stored in property. Only cert-safe path (no outbound network calls allowed).
- Warn in offer description: ≤100 KB recommended, SVG preferred — data URI bloats `.pbix` if oversized.
- Optional future: canvas-based downscale on upload.

**Build constraints:**
- Branch `feat/header-bar` off the cert-passing v1.1.1.3 tag once it goes Live.
- Do NOT start while v1.1.1.3 is still pending — bundling fix + feature drags out cert review.
- Increment to v1.1.2.0 (new feature, not a fix).

## Backlog (uncommitted)
- Search box inside the dropdown for high-cardinality categories
- Saved-filter presets (e.g. "QTD", "Top 5 regions") as named chip groups
- Multi-row chip wrap behaviour toggle vs single-row scroll
