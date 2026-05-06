# Accessibility Statement for optiStockSlicerBar

## Keyboard Navigation
The visual supports keyboard focus (supportsKeyboardFocus: true). Users can navigate to the visual using the Tab key. When the visual has focus, users can interact with the slicer items (chips or dropdown) using the arrow keys, Enter, and Space. The visual also supports closing dropdowns with the Escape key.

## High Contrast Mode
The visual detects high contrast mode via the Power BI host's color palette (`colorPalette.isHighContrast`). In high contrast mode:
- Text colors (section labels, chip text, dropdown text) are forced to the foreground color from the palette to ensure readability.
- Background colors (chip background, dropdown background) are set to transparent or use the background color from the palette.
- Borders and separators use the foreground color for visibility.
- The visual ensures that all interactive elements have sufficient contrast.

## Screen Reader Support
The visual uses semantic HTML elements where possible:
- Section labels are marked up as `<span>` with appropriate text content.
- Chip items are `<button>` elements with accessible labels (the item label and any additional metadata like value or short label).
- Dropdown items are `<button>` elements within a `<div>` panel, each with an accessible label.
- The visual does not rely on ARIA labels because the native button elements and text content provide sufficient accessibility.
- Screen readers will announce the section label and then each chip or dropdown item as the user navigates.

## Color Usage
The visual conveys information through color in the following ways:
- Chip background color indicates selection state (selected vs. unselected).
- Section labels and chip text use color for readability.
Users should ensure sufficient contrast between text and background colors. The visual does not rely solely on color to convey information; the chip's selected state is also indicated by a change in text color and the visual appearance (pressed state).

## Animations
The visual does not use any animations. All updates are immediate and do not involve motion or transitions.

## Text Scaling
The visual respects the user's text size settings through the use of `px` units for font sizes (which scale with the user's settings in Power BI). The visual does not override or disable the browser's text scaling capabilities.

## Summary
optiStockSlicerBar is designed to be accessible, supporting keyboard navigation, high contrast mode, and screen readers. The visual avoids relying solely on color for information and ensures text is legible in various viewing conditions.