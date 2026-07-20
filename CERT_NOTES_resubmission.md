# Codex Slicer Bar — Cert Notes (resubmission wave, Phase 01)

**Version:** 1.1.1.8 (visual.version) · production GUID unchanged (`codexSlicerBar…`) · API 5.11.0 / pbiviz 7.0.2 (pinned).

One-wave AppSource resubmission carrying the transparency/formatting rework, the v2 appearance redesign, **and Neil's named filter-out fix**. Partner Center re-evaluates the whole package (Pitfall 6).

## Transparency wave (Plan 07)
- New **Background** card: `ColorPicker` fill + 0–100 `transparency` slider via `hexToRGBString`. Additive.
- fx conditional formatting wired on eligible colour properties.

## Title + per-region text wave (Plan 14)
- Title + per-region text treatment reworked with adaptive text colour.

## v2 Appearance wave (Plan 18)
- Pill chips (radius 999); cyan-outline active state (1px border + glow, **no solid fill**); mono count badges per group; Clear All control + total-active count; magenta-warming clear affordance.
- **Bounded reinterpretation (`01b688f`):** the existing **Selected Chip Transparency** property now modulates the selection **glow intensity** (the solid fill it used to control no longer exists under the outline treatment) — an existing property repurposed, not a new one, not left inert.

## High-contrast rule
Shared HC rule wired (`src/shared/highContrast.ts`).

## Protected filter logic (byte-unchanged through the look changes)
`applyAllFilters` / `readAppliedFilters` / `parseDataView` / `dataParser.ts` — including **`381a17e`** — are byte-unchanged by the appearance work.

## Pending fixes riding this wave — MUST RIDE (Neil's named "slicer bar fix")
- **`071102b`** queryName fallback for simple-column `filterTarget`, **plus `381a17e`** which widened that fallback to fire for **any** unparseable Value field — both address **AppSource Policy 1180.2.2.3 "Core Functions – Filter Out"** (the reviewer soft-fail). The v1.1.1.4 package was NAS-staged but never swapped into the sample root, so this fix **was never submitted**. It ships now.
- Known gap (documented, deferred): hierarchy-level fields are not filter-targetable via the public `powerbi-visuals-api` surface (`source.expr` exposes no `kind` discriminator) — untouched this round, `docs/test_plan.md §10` records the follow-up.
