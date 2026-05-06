# User Guide – Codex Slicer Bar

## Overview
Data-driven slicer bar with configurable sections. Each section renders as chips or dropdown with single or multi-select, driven by a bridge table. Supports horizontal and vertical fan-out directions.

## 1. Adding the Visual
1. Import the `.pbiviz` file into Power BI Desktop
2. Locate the visual in the Visualizations pane
3. Drag it onto the report canvas

## 2. Data Binding
- **Category** (Required): Section grouping — each distinct value creates a slicer section.
- **Label** (Required): Display text for each item within a section.
- **Value** (Optional): Filter target as Table.Column (e.g. DimDate.Period). Leave empty for static display.
- **Sort order** (Optional): Numeric sort within each section.
- **Display mode** (Optional): Render style per section: Chips or Dropdown. Overrides formatting panel default.
- **Selection mode** (Optional): Selection behaviour per section: Single or Multi. Overrides formatting panel default.
- **Short label** (Optional): Secondary text shown when item is selected (e.g. date range).
- **Default value** (Optional): Label of the item to auto-select on load. Use a measure per page for dynamic defaults.

## 3. Formatting Options
**General**
- Filter: (inherited) - not applicable for this visual (selfFilterEnabled: false).

**Slicer Bar**
- Background Color: Background of the slicer bar container.
- Border Color: Border around the slicer bar.
- Label Color: Colour of the section labels (e.g., "PERIOD:").
- Label Font Size: Size of the section labels.
- Chip Color: Background colour of selected chips.
- Chip Text Color: Text colour of selected chips.
- Default Display Mode: Auto, Chips, or Dropdown (applies when section does not override).
- Default Selection Mode: Single or Multi (applies when section does not override).
- Max Visible Chips: Maximum number of chips to show before overflowing into a dropdown.
- Max Visible Sections: Maximum number of sections to display (overflow sections are not shown).
- Fan Direction: Auto, Fan Right, Fan Left, Fan Up, Fan Down (controls overflow direction for chips).

**Section Override** (applies per section via data binding)
- Display Mode: Override for this section: Auto, Chips, or Dropdown.
- Selection Mode: Override for this section: Single or Multi.
- Default Value: Label of the item to auto-select for this section (overrides the general default).

## 4. Features
- Data-driven sections: each unique category creates a section with its own items.
- Per-section display mode (chips or dropdown) and selection mode (single or multi).
- Tooltips on chips showing label, value (if bound), and short label (if bound).
- Click or keyboard (Enter/Space) to select items.
- Context menu (right-click) for standard Power BI interactions.
- Supports cross-filtering and highlighting.
- High contrast mode support.
- Configurable overflow: when chips exceed max visible, an overflow chip shows count and opens a dropdown.
- Fan-out direction control for layout.

## 5. Limitations
- Requires a bridge table with at least Category and Label columns; Value column optional for filtering.
- Sort order must be numeric; non-numeric values are ignored for sorting.
- Maximum sections visible is limited by the Max Visible Sections setting (default 10).
- Overflow sections (beyond Max Visible Sections) are not displayed at all.
- Default value must match an item label exactly (case-insensitive).

## 6. Support
For help or questions, visit https://nexuscodex.nexus/support