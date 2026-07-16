"use strict";

import powerbi from "powerbi-visuals-api";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

import { BackgroundSettings } from "./shared/backgroundSettings";
import { TitleSettings } from "./shared/titleSettings";
import { BorderSettings } from "./shared/borderSettings";
import { CardSignatureSettings } from "./shared/cardSignatureSettings";
import { textAlignFor, makeFontControl } from "./shared/textFormatting";

// TitleSettings + alignment helpers live in _shared/formatting/ (D-13,
// D-14 — frozen v2 standard from Plan 10). Re-exported so visual.ts can
// import them from "./settings" (stable import path, mirrors pbiKpiCard).
export { TitleSettings, textAlignFor };

const ConstantOrRule = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;

// Matches the pre-existing @font-stack in style/visual.less so the new
// font-family defaults render pixel-identical on old saved reports (D-06).
const FONT_STACK = "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";

export class SlicerBarSettings extends FormattingSettingsCard {
    name = "slicerBar";
    displayName = "Slicer Bar";

    // backgroundColor + borderColor slices RETIRED from the pane (Neil live-QA
    // 2026-07-16): the shared Background and Border cards supersede both — two
    // pickers for the same surface is exactly the "duplicate knobs" audit gap
    // (feedback_pbi_border_card_not_uniform_across_suite). Capability
    // properties stay DECLARED (GUID-locked schema, additive-only); dropdown
    // panel/trigger outlines now key off the theme surface token instead.
    labelColor = new formattingSettings.ColorPicker({
        name: "labelColor",
        displayName: "Label colour",
        value: { value: "#5e5d5a" },
        instanceKind: ConstantOrRule
    });
    // Section label text (TEXT-01) — FontControl composite via the shared
    // makeFontControl helper. The bundle's fontSize slice is named
    // "labelFontSize", deliberately matching the PRE-EXISTING capability
    // property (D-06/D-07: additive-only, no schema rename) so old saved
    // font-size values load into the composite unchanged; family/bold/
    // italic/underline are NEW sibling properties. Bold defaults true —
    // .osb-slicer-label carries a pre-existing hardcoded font-weight:600
    // (semibold-or-bolder maps to Bold-default-true per the suite's
    // weightFor idiom; bold-off falls back to the surface's own 600).
    // Alignment omitted — the bar is a flex row, label position is
    // layout-determined (matches 01-11/01-12/01-13 precedent).
    private labelFontBundle = makeFontControl("label", { fontFamily: FONT_STACK, fontSize: 11, bold: true });
    labelFontFamily = this.labelFontBundle.fontFamily;
    labelFontSize = this.labelFontBundle.fontSize;
    labelBold = this.labelFontBundle.bold;
    labelItalic = this.labelFontBundle.italic;
    labelUnderline = this.labelFontBundle.underline;
    labelFont = this.labelFontBundle.control;
    // v2 default flip (LOOK-05, D-16): the declared default moves from the
    // old filled-pill purple (#130064) to the brand cyan accent token
    // (dark-theme reference value, matches the suite's other static-hex
    // picker defaults) — under v2 this colour now drives the SELECTED
    // chip's border + glow (no solid fill), so an untouched report renders
    // the suite-wide cyan "selected" ring. A user who overrides this
    // picker still gets their own colour as the ring/glow tint (D-16).
    chipColor = new formattingSettings.ColorPicker({
        name: "chipColor",
        displayName: "Selected chip",
        value: { value: "#00d9ff" },
        instanceKind: ConstantOrRule
    });
    // Per-region transparency (D-05) sibling to the existing Selected chip
    // colour above — applied to the selected-chip fill in BOTH the compact
    // chip button and the dropdown panel's selected item (same underlying
    // colour, two render sites). Default 0 (opaque): the selected chip is
    // ALWAYS painted a solid colour today, never "unpainted" (T-07-02:
    // selection affordance must stay legible — dedicated layer, not
    // whole-root opacity).
    chipTransparency = new formattingSettings.Slider({
        name: "chipTransparency",
        displayName: "Selected Chip Transparency",
        description: "Transparency applied to the selected-chip fill colour",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });
    // v2 default flip (LOOK-05, D-16): declared default moves from white
    // (the old on-fill text colour) to the same brand cyan accent token as
    // chipColor above — under v2 the selected chip has no fill, so its
    // text now matches the ring colour by default; still independently
    // overridable (D-16).
    chipTextColor = new formattingSettings.ColorPicker({
        name: "chipTextColor",
        displayName: "Selected chip text",
        value: { value: "#00d9ff" },
        instanceKind: ConstantOrRule
    });
    // Chip/item/trigger text (TEXT-01) — all-new FontControl composite
    // (distinct "chip" prefix, every property NEW/additive) governing the
    // chip buttons, dropdown triggers and dropdown-panel items. Bold
    // defaults false — the dominant surface (.osb-period-chip) carries a
    // pre-existing hardcoded font-weight:500 (below the semibold
    // threshold); bold-off renders each surface's OWN pre-existing weight
    // (chip 500, trigger 400, dropdown item 600) via the weightFor idiom
    // so old saved reports render pixel-identical (D-06). Font size
    // defaults to the pre-existing 11px CSS on all three surfaces.
    // Alignment omitted — flex-row layout-determined.
    private chipFontBundle = makeFontControl("chip", { fontFamily: FONT_STACK, fontSize: 11 });
    chipFontFamily = this.chipFontBundle.fontFamily;
    chipFontSize = this.chipFontBundle.fontSize;
    chipBold = this.chipFontBundle.bold;
    chipItalic = this.chipFontBundle.italic;
    chipUnderline = this.chipFontBundle.underline;
    chipFont = this.chipFontBundle.control;
    defaultDisplayMode = new formattingSettings.ItemDropdown({
        name: "defaultDisplayMode",
        displayName: "Default display mode",
        items: [
            { displayName: "Auto", value: "auto" },
            { displayName: "Chips", value: "chips" },
            { displayName: "Dropdown", value: "dropdown" },
        ],
        value: { displayName: "Auto", value: "auto" },
    });
    defaultSelectionMode = new formattingSettings.ItemDropdown({
        name: "defaultSelectionMode",
        displayName: "Default selection mode",
        items: [
            { displayName: "Single", value: "single" },
            { displayName: "Multi", value: "multi" },
        ],
        value: { displayName: "Single", value: "single" },
    });
    maxVisibleChips = new formattingSettings.NumUpDown({
        name: "maxVisibleChips",
        displayName: "Max visible chips",
        value: 8,
    });
    maxVisibleSections = new formattingSettings.NumUpDown({
        name: "maxVisibleSections",
        displayName: "Max visible sections",
        value: 10,
    });
    fanDirection = new formattingSettings.ItemDropdown({
        name: "fanDirection",
        displayName: "Dropdown direction",
        items: [
            { displayName: "Auto", value: "auto" },
            { displayName: "Fan Right", value: "right" },
            { displayName: "Fan Left", value: "left" },
            { displayName: "Fan Up", value: "up" },
            { displayName: "Fan Down", value: "down" },
        ],
        value: { displayName: "Auto", value: "auto" },
    });
    // Title placement: when on, the visual's Title renders as the first item
    // INSIDE the slicer bar row (inline with the chips) rather than as a
    // separate row above it. Default off = pre-existing above-the-bar layout.
    titleInline = new formattingSettings.ToggleSwitch({
        name: "titleInline",
        displayName: "Title inline with bar",
        value: false,
    });

    slices: FormattingSettingsSlice[] = [
        this.labelColor,
        this.labelFont,
        this.chipColor,
        this.chipTransparency,
        this.chipTextColor,
        this.chipFont,
        this.defaultDisplayMode,
        this.defaultSelectionMode,
        this.maxVisibleChips,
        this.maxVisibleSections,
        this.fanDirection,
        this.titleInline,
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    titleSettings = new TitleSettings();
    slicerBarCard = new SlicerBarSettings();
    background = new BackgroundSettings();
    cardSignature = new CardSignatureSettings();
    visualBorder = new BorderSettings();

    // No transparency-default override here (unlike most of this batch):
    // pbiSlicerBar's PRE-EXISTING default was already a genuine opaque-white
    // happy path — confirmed via direct inspection of src/visual.ts's
    // renderSlicerBar(): `this.slicerRow.style.background` is set
    // unconditionally on every render (before any dataView/empty check),
    // reading the old `slicerBarCard.backgroundColor` (default #ffffff),
    // matching the pbiKpiCard/pbiKpiSparklineCard pattern rather than the
    // more common "never painted" case. The shared Background card's own
    // raw default (opaque white, transparency 0) is pixel-identical.

    cards = [this.titleSettings, this.slicerBarCard, this.background, this.cardSignature, this.visualBorder];
}
