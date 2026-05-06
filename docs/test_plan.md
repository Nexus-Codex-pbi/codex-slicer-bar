# Test Plan for Codex Slicer Bar

## Functional Tests

### Rendering Tests
- [ ] Visual renders correctly with all required data fields populated
- [ ] Visual shows empty state when no data is provided
- [ ] Visual shows landing page guidance when first added to canvas
- [ ] Sections render in correct order based on sort values
- [ ] Items within sections render in correct order based on sort values
- [ ] Static sections (empty Value field) render correctly
- [ ] Interactive sections (with Value field) render correctly

### Formatting Tests
- [ ] Background color setting applies correctly
- [ ] Border color setting applies correctly
- [ ] Label color setting applies correctly
- [ ] Label font size setting applies correctly
- [ ] Chip color setting applies correctly
- [ ] Chip text color setting applies correctly
- [ ] Default display mode (Auto/Chips/Dropdown) works correctly
- [ ] Default selection mode (Single/Multi) works correctly
- [ ] Max visible chips setting limits chip display
- [ ] Max visible sections setting limits section display
- [ ] Fan direction settings affect layout correctly
- [ ] Section override display mode works correctly
- [ ] Section override selection mode works correctly
- [ ] Section override default value works correctly

### Interaction Tests
- [ ] Chip click triggers cross-filtering to other visuals
- [ ] Dropdown selection triggers cross-filtering to other visuals
- [ ] Multi-selection mode allows multiple item selection
- [ ] Single-selection mode clears previous selection
- [ ] Ctrl+Click enables multi-selection in single mode
- [ ] Right-click shows Power BI context menu
- [ ] Tooltip appears on hover with correct information
- [ ] Tooltip disappears on mouse leave
- [ ] Default values auto-select on initial load
- [ ] Selection persists across visual updates

### Data Tests
- [ ] Visual handles null/empty values gracefully
- [ ] Visual handles negative numeric values correctly
- [ ] Visual handles large numeric values correctly
- [ ] Visual handles special characters in text fields
- [ ] Visual handles Unicode characters in text fields
- [ ] Visual sorts sections correctly by sort order
- [ ] Visual sorts items within sections correctly
- [ ] Visual handles maximum data limit (30,000 items)

## Performance Tests
- [ ] Visual loads within acceptable time with small dataset (<100 items)
- [ ] Visual loads within acceptable time with medium dataset (100-1000 items)
- [ ] Visual loads within acceptable time with large dataset (1000+ items)
- [ ] Visual maintains responsiveness during interaction
- [ ] Memory usage remains stable during repeated updates
- [ ] No memory leaks detected during extended testing

## Accessibility Tests
- [ ] Visual is fully navigable using keyboard only
- [ ] All interactive elements receive keyboard focus
- [ ] Focus indicators are clearly visible
- [ ] Screen reader can interpret visual content
- [ ] High contrast mode displays correctly
- [ ] Text scaling up to 200% works without clipping
- [ ] Color contrast meets WCAG 2.1 AA requirements

## Security Tests
- [ ] Visual makes no external network requests
- [ ] Visual does not execute dynamic JavaScript
- [ ] Visual handles data securely through Power BI APIs only
- [ ] Visual does not store sensitive data
- [ ] Visual does not access browser storage without permission

## Packaging Tests
- [ ] Visual package builds successfully
- [ ] Visual imports correctly into Power BI Desktop
- [ ] Visual functions correctly in Power BI Service
- [ ] Visual icon displays correctly in visualization pane
- [ ] Visual metadata displays correctly in marketplace

## Sample PBIX Verification
- [ ] Sample PBIX file loads without errors
- [ ] Visual renders correctly in sample file
- [ ] All data roles populate correctly with sample data
- [ ] Formatting options work correctly with sample data
- [ ] Interactions work correctly with sample data
- [ ] Cross-filtering works with other visuals in sample