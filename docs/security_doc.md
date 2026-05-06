# Security Statement for optiStockSlicerBar

## External Network Access
The visual does not make any external network calls. It contains no `externalJS` in the pbiviz.json and no `fetch`, `XMLHttpRequest`, or similar networking code in the source.

## Telemetry
The visual does not collect or transmit any telemetry data. There are no calls to tracking services or custom telemetry logic.

## Data Handling
The visual only processes data provided via the Power BI dataView pipeline. It does not store, cache, or transmit any data outside the visual instance. All data is held in memory during the visual's lifetime and is released when the visual is destroyed.

## Script Safety
- No use of `eval()` or similar dynamic code execution.
- No use of `innerHTML`; all DOM updates are performed via `textContent` and DOM API methods (`appendChild`, `createElement`, etc.).
- No unsafe DOM manipulation that could lead to XSS vulnerabilities.
- All user-provided strings (from data or formatting properties) are treated as plain text and safely inserted into the DOM.

## Cross-Visual Interaction
The visual supports cross-visual filtering when a Value field is bound (specifying Table.Column). When a user selects items in the slicer, it applies filters to the specified column via the host's filtering mechanism. The visual also respects external filters applied by other visuals.

## Dependencies
The visual depends only on the following approved Power BI libraries:
- `powerbi-visuals-api`
- `powerbi-visuals-utils-formattingmodel`
No third-party libraries or external dependencies are used.

## Permissions
The visual requires the LocalStorage privilege (non-essential) for storing UI state like dropdown positions. No other special permissions are requested or used.

## Summary
optiStockSlicerBar is a secure custom visual that adheres to Power BI's security and privacy standards. It processes data locally, makes no external calls beyond standard Power BI filtering, and implements proper DOM safety practices.