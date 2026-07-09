# Test Plan – Codex Slicer Bar

## 1. Functional Tests
- [ ] Visual loads without errors
- [ ] Visual renders with sample data (all fields bound)
- [ ] Visual handles empty data gracefully (shows empty state)
- [ ] All format pane options apply correctly (general, slicerBar, sectionOverride)
- [ ] Selection / cross-filter works (when Value bound, clicking chip applies filter)
- [ ] Tooltips appear on hover (on chips showing label, value, short label)
- [ ] Context menu appears on right-click
- [ ] Keyboard navigation works (tab to chips, Enter/Space to select)
- [ ] Dropdowns open and close correctly
- [ ] Overflow chip shows when items exceed max visible chips
- [ ] Fan direction changes layout as expected

## 2. Performance Tests
- [ ] update() completes < 250ms with sample data
- [ ] No memory leaks (test with repeated updates)
- [ ] Bundle size < 2.5 MB

## 3. Accessibility Tests
- [ ] Keyboard navigation works (tab to visual, arrow keys navigate, Enter/Space selects)
- [ ] High contrast mode supported (colors adapt to theme)
- [ ] ARIA labels present (on chips and dropdown toggles)
- [ ] No flashing content

## 4. Security Tests
- [ ] No external network calls (verify no network traffic in dev tools)
- [ ] No telemetry (no calls to external endpoints)
- [ ] No external scripts or fonts (all resources bundled)
- [ ] No DOM escape or eval (check code for unsafe patterns)

## 5. Packaging Tests
- [ ] pbiviz builds successfully (npm install && pbiviz package)
- [ ] Bundle size < 2.5 MB
- [ ] capabilities.json valid (passes schema validation)

## 6. Sample PBIX Verification
- [ ] Demonstrates all features (chips, dropdowns, single/multi select, overflow, fan direction)
- [ ] Demonstrates formatting options (all format pane sections)
- [ ] Demonstrates interactions (click-to-filter, context menu, tooltips, keyboard)

## 7. Outer Background Transparency (TRANS-01/02/03)
- [ ] Background card exposes Colour + Transparency (0-100) controls
- [ ] Transparency 0 = opaque (matches pre-upgrade default; old saved reports render pixel-identical)
- [ ] Transparency 50 shows report canvas bleeding through the slicer bar AND the floating dropdown panel evenly
- [ ] Transparency 100 = fully transparent slicer bar + panel
- [ ] Verified in both light and dark report themes

## 8. Selected Chip Transparency + Selection-Chrome Legibility (D-05, T-07-02)
- [ ] Selected Chip Transparency slider (Slicer Bar card) affects the compact chip fill AND the dropdown panel's selected item fill identically
- [ ] Selected Chip Transparency 0 = opaque (matches pre-upgrade default)
- [ ] At Transparency 100, the selected chip/item border + text remain fully opaque — selection state stays visually distinguishable from unselected items even when the fill is fully transparent
- [ ] Multi-select mode: multiple selected chips remain individually distinguishable at 50% transparency

## 9. Conditional Formatting / fx (TRANS-04)
- [ ] Selected chip swatch (Slicer Bar card) shows the fx button in the format pane
- [ ] Setting a measure-level rule resolves the selected-chip/selected-item colour suite-wide
- [ ] Filter apply/remove logic (applyAllFilters, per-section cache) is unaffected by the fx/transparency changes — verified via `git diff` showing zero edits to applyAllFilters/readAppliedFilters/parseDataView

## 10. Filter-out verification (1180.2.2.3)

Addresses AppSource cert soft-fail policy 1180.2.2.3 Core Functions – Filter Out
("Your visual does not appear to filter outwards to other visuals").

**Root cause fixed this round:** `parseDataView()`'s queryName fallback (added in
v1.1.1.4 for the "no Value role bound" case) only fired when the Value data role
was completely unbound. If a Value field WAS bound but not formatted as the
"Table.Column" bridge string (e.g. a user/reviewer drags the same category field
into the Value well expecting it to "just filter"), `filterTarget` silently
resolved to `null` and the section became non-interactive — a second, separate
way to hit the same cert failure. Fixed by falling back to the Label column's
`source.queryName` whenever the Value field doesn't parse as `Table.Column`,
regardless of whether the Value role is bound at all.

**Setup:** Blank report → import the .pbiviz → add a second visual (e.g. a
table or card) driven by the same table → on the Slicer Bar, bind ONLY the
Label role to a plain category column (e.g. `DimRegion[RegionName]`) — do
NOT touch the Value well.

- [ ] **Plain column field, Value unbound:** Click a chip → the second visual
      filters to the selected value.
- [ ] **Plain column field, Value bound to the same field (not "Table.Column"
      formatted):** Repeat with the identical field also dropped into the
      Value well (unformatted). Click a chip → the second visual still
      filters (this is the newly-fixed gap — previously silently non-interactive).
- [ ] **Renamed display name:** Rename the bound field's display name in the
      report (Fields pane → rename). Click a chip → the second visual still
      filters correctly (queryName-derived target is unaffected by display
      renames).
- [ ] **Clearing restores full data:** With a chip selected and the second
      visual filtered down, click the same chip again (single-select) or use
      "Clear All" (multi-select). The second visual's data returns to the
      full, unfiltered set — confirms `applyAllFilters()`'s empty-selection
      path issues a `remove` (not a no-op merge) so the filter doesn't linger.
- [ ] **Bridge-table mode regression check:** Existing sample .pbix with an
      explicit `Table.Column` string in the Value column still filters as
      before (bridge mode takes priority over the fallback whenever the
      Value field does parse as `Table.Column`).
- [ ] **Date hierarchy levels — not verified this round.** No built-in
      mechanism exists in the public `powerbi-visuals-api` surface to
      distinguish a hierarchy-level field from a plain column at the
      `DataViewMetadataColumn` level (the `source.expr` is an opaque marker
      interface with no exposed discriminator), so this fix does not attempt
      hierarchy-specific `IFilterHierarchyTarget` handling — it would be an
      unverified guess. If a reviewer flags a hierarchy-level field
      specifically, that needs a follow-up build with an actual PBI Desktop
      repro to inspect the real `queryName` shape before coding a fix.
## Visual Title (TITLE-01, shared _shared/formatting/ v2)
- [ ] Visual Title card appears in the format pane (Show Title, Title Text, Font, Alignment, Font Color)
- [ ] Show Title default OFF — an old saved report renders pixel-identical (no title strip appears above the bar)
- [ ] Show Title ON + empty Title Text renders nothing (render gate is showTitle && titleText)
- [ ] Title font family/size/bold/italic/underline apply; alignment left/center/right applies
- [ ] Right-click on the title shows the PBI context menu (title is a child of the target, listener bubbles)

## Per-Surface Text Treatment (TEXT-01)
- [ ] Label Font (family/size/bold/italic/underline) applies to section header labels (e.g. "REGION:")
- [ ] Label Bold OFF renders the pre-existing weight 600; default Bold ON renders 700 (documented negligible increase)
- [ ] Chip Font (family/size/bold/italic/underline) applies to chips, dropdown triggers, and dropdown-panel items
- [ ] Chip Bold OFF renders each surface's own pre-existing weight (chip 500, trigger 400, panel item 600)
- [ ] Static (non-interactive) values and short-labels keep their pre-existing label colour/size behaviour (unchanged)
- [ ] All defaults untouched → pixel-identical to the pre-upgrade render (D-06)

## Selected Chip Text Colour fx (TEXT-02)
- [ ] Selected chip text swatch shows the fx button in the format pane
- [ ] Setting a rule on Selected chip text resolves (global/measure-level — this visual has no per-category identity)
- [ ] Chip text colour applies to the LABEL text only — selected-chip fill and border chrome are unaffected

## Selection-Chrome Legibility (T-14-05, carried from T-07-02)
- [ ] With a dark chip text rule + default dark chip fill, the selection state remains distinguishable via the opaque border
- [ ] At Selected Chip Transparency 100, chip text and border remain legible (fill-only transparency)

## Filter Logic Regression (1180.2.2 / 381a17e, verify-don't-rewrite)
- [ ] applyAllFilters()/readAppliedFilters()/parseDataView() byte-unchanged from before this plan (git diff confirms)
- [ ] Chip click still cross-filters other visuals; clearing restores full data
- [ ] Filter Out (queryName fallback, 381a17e) still functions on a plain column field bound to Value
