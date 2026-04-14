"use strict";

import powerbi from "powerbi-visuals-api";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

const ConstantOrRule = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;

export class SlicerBarSettings extends FormattingSettingsCard {
    name = "slicerBar";
    displayName = "Slicer Bar";

    backgroundColor = new formattingSettings.ColorPicker({
        name: "backgroundColor",
        displayName: "Background",
        value: { value: "#ffffff" },
        instanceKind: ConstantOrRule
    });
    borderColor = new formattingSettings.ColorPicker({
        name: "borderColor",
        displayName: "Border colour",
        value: { value: "#e8e2d3" },
        instanceKind: ConstantOrRule
    });
    labelColor = new formattingSettings.ColorPicker({
        name: "labelColor",
        displayName: "Label colour",
        value: { value: "#5e5d5a" },
        instanceKind: ConstantOrRule
    });
    labelFontSize = new formattingSettings.NumUpDown({
        name: "labelFontSize",
        displayName: "Label font size",
        value: 11,
    });
    chipColor = new formattingSettings.ColorPicker({
        name: "chipColor",
        displayName: "Selected chip",
        value: { value: "#130064" },
        instanceKind: ConstantOrRule
    });
    chipTextColor = new formattingSettings.ColorPicker({
        name: "chipTextColor",
        displayName: "Selected chip text",
        value: { value: "#ffffff" },
        instanceKind: ConstantOrRule
    });
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

    slices: FormattingSettingsSlice[] = [
        this.backgroundColor,
        this.borderColor,
        this.labelColor,
        this.labelFontSize,
        this.chipColor,
        this.chipTextColor,
        this.defaultDisplayMode,
        this.defaultSelectionMode,
        this.maxVisibleChips,
        this.maxVisibleSections,
        this.fanDirection,
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    slicerBarCard = new SlicerBarSettings();
    cards = [this.slicerBarCard];
}
