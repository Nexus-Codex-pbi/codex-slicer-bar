# Codex Slicer Bar

## Overview
Data-driven slicer bar with configurable sections. Each section renders as chips or dropdown with single or multi-select, driven by a bridge table. Supports horizontal and vertical fan-out directions.

## Features
- Creates slicer sections from a Category field (e.g., Date, Region, Product)
- Each section contains items defined by Label and Value fields (Value is the filter target, e.g., Table.Column)
- Sections can be displayed as chips (horizontal) or dropdown (vertical)
- Supports single or multi-select per section
- Configurable default display and selection modes per section via data roles or formatting pane
- Short label for additional context (e.g., date range when selected)
- Default value to auto-select on load (can be dynamic via measure per page)
- Tooltips showing section, label, value, and short label
- Click to apply filters (single or multi-select)
- Keyboard navigation: arrow keys, Enter, Space to toggle selection
- Context menu (right-click) for cross-filtering and other interactions
- High contrast mode support
- Responsive layout with overflow handling (shows "X more" chip when exceeding max visible)
- Supports keyboard focus and screen readers
- Maximum of 30,000 sections due to data reduction algorithm

## Data Roles
| Role | Display Name | Kind | Required? | Data Type | Description |
|------|--------------|------|-----------|-----------|-------------|
| category | Category | Grouping | No (max 1) | Text or Grouping | Section grouping — each distinct value creates a slicer section |
| label | Label | Grouping | No (max 1) | Text or Grouping | Display text for each item within a section |
| value | Value | Grouping | No (max 1) | Text or Grouping | Filter target as Table.Column (e.g. DimDate.Period). Leave empty for static display. |
| sortOrder | Sort Order | Measure | No (max 1) | Numeric | Numeric sort within each section (ascending) |
| displayMode | Display Mode | Grouping | No (max 1) | Text or Grouping | Render style per section: Chips or Dropdown. Overrides formatting panel default. |
| selectionMode | Selection Mode | Grouping | No (max 1) | Text or Grouping | Selection behaviour per section: Single or Multi. Overrides formatting panel default. |
| shortLabel | Short Label | Grouping | No (max 1) | Text or Grouping | Secondary text shown when item is selected (e.g. date range). Optional. |
| defaultValue | Default Value | Grouping | No (max 1) | Text or Grouping | Label of the item to auto-select on load. Use a measure per page for dynamic defaults. |

Note: Each role can have at most one field bound. At least Category and Label are required for meaningful display. Value is required for filtering functionality.

## Formatting Options
The visual provides the following format pane cards:

### General
- Filter: (Internal) Not user-configurable.

### Slicer Bar
- Background Color: Background color of the slicer bar container
- Border Color: Border color of the slicer bar container
- Label Color: Text color for section labels (e.g., "DATE:")
- Label Font Size: Font size for section labels in pixels
- Chip Color: Background color of chips when not selected
- Chip Text Color: Text color of chips when not selected
- Default Display Mode: Auto, Chips, or Dropdown (used when section does not specify displayMode)
- Default Selection Mode: Single or Multi (used when section does not specify selectionMode)
- Max Visible Chips: Maximum number of chips to show before overflowing into a dropdown (when in chips mode)
- Max Visible Sections: Maximum number of sections to display (sections beyond this are not shown)
- Fan Direction: Auto, Fan Right, Fan Left, Fan Up, Fan Down (controls the direction of dropdown panels)

### Section Override
- Display Mode: Auto, Chips, or Dropdown (overrides the default for this section via data role)
- Selection Mode: Single or Multi (overrides the default for this section via data role)
- Default Value: Text label of the item to auto-select on load (overrides the default for this section via data role)

## How to Use
1. Import the `.pbiviz` file into Power BI Desktop (from the Visuals pane -> ... -> Import from file).
2. Locate the visual in the Visualizations pane and add it to the report canvas.
3. Bind data to the data roles:
   - Category: Required for section grouping (e.g., a date table with Year-Month)
   - Label: Required for item display text (e.g., month names)
   - Value: Required for filtering (e.g., a column like 'DimDate[YearMonth]' that can be used in a filter)
   - Optional: Sort Order (numeric field to sort items within each section)
   - Optional: Display Mode (text field with values "chips" or "dropdown" to override per section)
   - Optional: Selection Mode (text field with values "single" or "multi" to override per section)
   - Optional: Short Label (text field for additional context, e.g., date range)
   - Optional: Default Value (text field with the label of the item to select by default)
4. Use the format pane to adjust appearance:
   - Set colors, fonts, sizes, and layout options
   - Configure default behaviors for sections that don't override via data roles
   - Set maximum visible chips and sections
   - Choose fan direction for dropdowns
5. Interact:
   - Click a chip to select/deselect (depending on selection mode)
   - Use arrow keys to navigate chips, Enter/Space to toggle
   - Click the section label to open/close dropdown (if in dropdown mode)
   - In dropdown mode, click an item to select/deselect
   - Right-click for the context menu
   - Hover to see tooltips with section, label, value, and short label

## Limitations
- The visual expects one row per item per section. Duplicate items within a section may cause unexpected behavior.
- Each data role accepts only one field.
- The Value role must be a column that can be used in a filter (typically a table.column reference).
- The Display Mode and Selection Mode roles, if bound, must be text fields with the expected values.
- The Default Value role, if bound, must match the label text exactly (case-insensitive).
- The visual does not support hierarchical sections or nested grouping.
- The visual does not support search within dropdown sections.

## Support
For help or questions, visit https://nexuscodex.nexus/support