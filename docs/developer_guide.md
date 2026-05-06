# Developer Guide: optiStockSlicerBar

## Architecture
The visual follows a standard Power BI custom visual structure:
- **visual.ts**: Main visual class implementing `IVisual`.
- **settings.ts**: Defines the formatting settings model using `powerbi-visuals-utils-formattingmodel`.
- **dataParser.ts**: Contains functions to parse the DataView into sections and items.
- **style/visual.less**: Styles for the visual (though the visual primarily uses inline styles via DOM API and SVG).
- **capabilities.json**: Defines data roles, objects, and capabilities.
- **pbiviz.json**: Manifest file with metadata.

**Rendering Model**:
The visual uses a combination of HTML (for section labels and chips/dropdown containers) and SVG (for the time breakdown visual in the case of optiStockTimeBreakdown, but note: this is for optiStockSlicerBar). However, for optiStockSlicerBar, the rendering is done entirely in the DOM (HTML/CSS) with no SVG.

The visual constructs a container (`osb-slicer-row`) that holds sections. Each section consists of:
- A label (e.g., "PERIOD:")
- Either a set of chips (buttons) or a dropdown (button + panel) for the items.

The visual updates the DOM by:
1. Clearing the container and rebuilding the sections on every update (if the data or formatting changes significantly).
2. For each section, creating the appropriate UI (chips or dropdown) based on the data and formatting settings.
3. Attaching event listeners for mouse and keyboard interactions.

## capabilities.json Summary
- **Data Roles**: 8 roles (Category, Label, Value, Sort order, Display mode, Selection mode, Short label, Default value). 
  - Category, Label, Value, Display mode, Selection mode, Short label, Default value are Grouping.
  - Sort order is Measure.
- **Data View Mapping**: Categorical with categories selecting all 8 roles. Supports up to 30000 items (via data reduction algorithm).
- **Objects**: Two formatting objects (general and slicerBar) and one for section overrides.
  - general: contains a filter property (selfFilterEnabled: false).
  - slicerBar: contains properties for colors, font sizes, default display/selection modes, max visible chips/sections, and fan direction.
  - sectionOverride: allows per-section overrides for display mode, selection mode, and default value.
- **Features**: Supports highlighting, keyboard focus, landing page, empty data view, multi-visual selection, and tooltips (default and canvas).
- **Privileges**: Requests the LocalStorage privilege (non-essential) for storing UI state.

## APIs Used
- **Selection Manager (`ISelectionManager`)**: 
  - For applying filters when items are selected (if Value field is bound) and for showing context menus.
  - Used in constructor to create selection manager and in click handlers for chips and dropdown items.
- **Tooltip Service (`ITooltipService`)**:
  - To show and hide tooltips on mousemove and mouseleave over chips and dropdown items.
  - Builds tooltip data array from section name, item label, value (if bound), and short label.
- **Event Service (`IVisualEventService`)**:
  - Calls `renderingStarted` and `renderingFinished` to coordinate with Power BI's rendering cycle.
- **Host (`IVisualHost`)**:
  - Access to color palette (for high contrast), locale, and creation of selection manager, tooltip service, and localization manager.
  - Also used to apply filters when a Value field is bound (via `host.applyJsonFilter` or similar, but in the source we see `applyAllFilters` method that uses the host's filtering capabilities).
- **Localization Manager (`ILocalizationManager`)**:
  - Currently unused but initialized for potential future localization.
- **Formatting Settings Service (`FormattingSettingsService`)**:
  - Populates the formatting settings model from the data view.
- **Power BI Utilities**:
  - `powerbi-visuals-utils-formattingmodel` for strongly-typed formatting settings.

## Performance Considerations
- **DOM Updates**: The visual rebuilds the entire slicer row on every update. This is acceptable because the number of sections is limited by `maxVisibleSections` (default 10) and the number of chips per section is limited by `maxVisibleChips` (default 8). However, if there are many sections, the visual will only render up to `maxVisibleSections` and the rest are accessible via scrolling.
- **Caching**: The visual caches the full set of items per section (the most items ever seen) to preserve the user's ability to select items that are not currently in the dataView due to external filtering (filter-in certification requirement).
- **Event Listeners**: Event listeners are attached to each chip and dropdown item. The visual uses event delegation for the document click to close dropdowns, but for chips and dropdown items, it attaches listeners directly. This is acceptable given the limited number of items.
- **High Contrast**: The visual checks the high contrast state on every update and adjusts colors accordingly.

## Accessibility Implementation
- **Keyboard Navigation**: 
  - The visual is focusable (tabindex implicitly set by being a container). 
  - Arrow keys navigate between sections and within sections (chips or dropdown items).
  - Enter/Space toggles selection (for chips) or opens/closes dropdowns and selects items.
  - Escape closes dropdowns.
  - The visual does not trap focus.
- **High Contrast**: 
  - Uses `host.colorPalette.isHighContrast` to adjust text and background colors to system colors.
  - In high contrast mode, text uses foreground color, and backgrounds are set to background color or transparent as appropriate.
- **Screen Reader**: 
  - The visual uses native HTML elements (`<button>` for chips and dropdown items, `<span>` for labels) which are inherently accessible.
  - Section labels are in uppercase and followed by a colon.
  - Chip and dropdown items have text content that includes the label and, if bound, the value and short label (via tooltip, but the accessible name is just the label; however, the visual does not set aria-label for chips/dropdowns, relying on the visible text). 
  - To improve accessibility, consider adding aria-label or aria-describedby for chips and dropdown items to include the value and short label.
- **Color Usage**: 
  - The visual uses color to indicate selection state (selected chips have a different background and text color). 
  - It does not rely solely on color; the selected state is also indicated by the visual appearance (pressed state) and, in high contrast, by the use of system colors.
- **Focus Indicator**: 
  - The visual relies on the browser's default focus styling for keyboard users. Buttons (chips and dropdown buttons) show a focus outline when focused.

## Security Compliance
- **No External Calls**: The visual does not load any external scripts (`externalJS` is null) and makes no network requests.
- **No eval/dynamic code**: All code is static; no use of `eval`, `Function`, `setTimeout` with strings, etc.
- **Safe DOM**: Uses `textContent` for text and `setAttribute`/`style` for styling. The visual does not use `innerHTML` except in one place: in the `buildDropdownItems` method, it uses `innerHTML` to set the content of the dropdown panel. However, the content is generated from trusted data (the item labels) and is escaped by setting `textContent` in a loop? Actually, in the source we see:
      panel.innerHTML = ""; // clear
      then for each item: 
          const itemDiv = document.createElement("div");
          itemDiv.textContent = item.label;
          ... 
          panel.appendChild(itemDiv);
  So it does not use innerHTML for insertion, only to clear the panel. This is safe.
- **No Data Persistence**: The visual uses LocalStorage (as per the privilege) to store UI state (like dropdown positions). This is non-essential and users can disable it in the visual's settings if concerned.
- **Privileges**: The `privileges` array in `capabilities.json` includes one item: `{ "name": "LocalStorage", "essential": false }`.

## Build & Packaging
- **Dependencies**: 
  - `powerbi-visuals-api`
  - `powerbi-visuals-utils-formattingmodel`
- **Build Steps** (typical for Power BI visuals):
  1. Install dependencies: `npm install`
  2. Compile TypeScript: `npm run build` (or `tsc -p .`)
  3. Package the visual: `pbiviz package`
- **Output**: The packaged `.pbiviz` file is found in the `dist/` directory.
- **Validation**: Use `pbiviz validate` to check the package against Power BI requirements.
- **Debugging**: Use `pbiviz start` to run the visual in debug mode with hot reload.

## Additional Notes
- The visual uses a caching mechanism (`cachedSections`) to preserve the full set of items per section across updates, which is important for the filter-in certification requirement (1180.2.2.3).
- The visual does not support self-filtering (the filter property in the general object has `selfFilterEnabled: false`).
- The visual supports cross-filtering when a Value field (Table.Column) is bound.
- The visual does not use any external libraries beyond the approved Power BI ones and D3.js (if used, but note: in the source for optiStockSlicerBar, we don't see D3.js; it's used in optiStockTimeBreakdown). For optiStockSlicerBar, the rendering is done with DOM API only.