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