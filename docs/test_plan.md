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