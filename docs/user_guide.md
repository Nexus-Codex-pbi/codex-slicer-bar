# User Guide: optiStockSlicerBar

## Adding the Visual
1. In Power BI Desktop, navigate to the Visualizations pane.
2. Click the three dots (⋯) and select "Get more visuals".
3. Search for "optiStockSlicerBar".
4. Select the visual and click "Add".
5. The visual icon will appear in the Visualizations pane. Click it to add an instance to your report.

## Data Binding
The visual supports the following data fields (drag fields from the Fields pane to these wells):

| Field Name | Type | Required? | Description |
|------------|------|-----------|-------------|
| Category | Grouping | Yes (at least one of Category, Label, Value, Sort Order, Display Mode, Selection Mode, Short Label, or Default Value must be bound) | Section grouping — each distinct value creates a slicer section. |
| Label | Grouping | No | Display text for each item within a section. |
| Value | Grouping | No | Filter target as Table.Column (e.g. DimDate.Period). Leave empty for static display. |
| Sort order | Measure | No | Numeric sort within each section. |
| Display mode | Grouping | No | Render style per section: Chips or Dropdown. Overrides formatting panel default. |
| Selection mode | Grouping | No | Selection behaviour per section: Single or Multi. Overrides formatting panel default. |
| Short label | Grouping | No | Secondary text shown when item is selected (e.g. date range). Optional. |
| Default value | Grouping | No | Label of the item to auto-select on load. Use a measure per page for dynamic defaults. |

**Note**: At least one field must be bound for the visual to display data. The Category field is required to create sections; without it, no sections are shown.

## Formatting Options
The visual provides formatting options in the Format pane:

### Slicer Bar
- **Background Color**: Background color of the slicer bar container.
- **Border Color**: Border color of the slicer bar container.
- **Label Color**: Color of the section labels (e.g., "PERIOD:").
- **Label Font Size**: Font size for the section labels in pixels.
- **Chip Color**: Background color of unselected chips.
- **Chip Text Color**: Text color of chips.
- **Default Display Mode**: Default render style for sections: Auto, Chips, or Dropdown.
- **Default Selection Mode**: Default selection behavior: Single or Multi.
- **Max Visible Chips**: Maximum number of chips to show before overflowing into a dropdown (if display mode is Chips).
- **Max Visible Sections**: Maximum number of sections to display (sections beyond this are not shown).
- **Fan Direction**: Direction in which the slicer bar fans: Auto, Fan Right, Fan Left, Fan Up, Fan Down.

### Section Override
- **Display Mode**: Override the display mode for a specific section (set via data binding or per-section in the format pane? Note: the format pane does not currently support per-section override; this is set via data binding).
- **Selection Mode**: Override the selection mode for a specific section.
- **Default Value**: Set the default selected item for a specific section (label of the item).

## Features
- **Section-Based Layout**: Each distinct value in the Category field creates a section with a label (uppercase by default).
- **Item Display**: Within each section, items are displayed as chips (buttons) or in a dropdown, based on the display mode.
- **Selection**: Clicking an item selects it. In Single mode, selecting a new item deselects the previous one. In Multi mode, multiple items can be selected.
- **Search in Dropdown**: When a section is in dropdown mode, typing filters the list.
- **Overflow Chips**: If there are more items than Max Visible Chips in chips mode, an overflow chip shows the count of hidden items.
- **Tooltips**: Hovering over a chip or dropdown item shows a tooltip with the item's label, value (if bound), and short label (if bound).
- **Context Menu**: Right-click the visual to access the standard Power BI context menu (e.g., Sort, Export data).
- **Keyboard Navigation**: Navigate sections and items with arrow keys, toggle selection with Enter/Space, open/close dropdowns with Enter/Space, and close dropdowns with Escape.
- **High Contrast Mode**: Automatically adapts to Windows high contrast settings for improved accessibility.
- **Responsive Design**: The slicer bar wraps or scrolls based on container width and the Max Visible Sections setting.
- **Cross-Filtering**: When a Value field is bound (Table.Column), selecting items filters other visuals on the report page by that column.
- **Static Display**: If no Value field is bound, the visual displays items statically (no filtering).

## Limitations
- The visual does not support hierarchies in the Category field; only flat grouping is supported.
- The Label field must be bound to display item text; if not bound, items show as blank.
- The Value field must be a valid Table.Column reference for filtering to work.
- The visual does not support drill-through or drill-down.
- The visual does not support custom tooltips beyond the built-in visual tooltip.
- The visual does not support saving selection state between sessions (except for the current session).

## Known Issues
None reported.

## Support URL
For support, visit: https://nexuscodex.nexus/support