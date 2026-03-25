"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export class SlicerBarSettings extends FormattingSettingsCard {
    name = "slicerBar";
    displayName = "Slicer Bar";

    backgroundColor = new formattingSettings.ColorPicker({
        name: "backgroundColor",
        displayName: "Background",
        value: { value: "#ffffff" },
    });
    borderColor = new formattingSettings.ColorPicker({
        name: "borderColor",
        displayName: "Border colour",
        value: { value: "#e8e2d3" },
    });
    labelColor = new formattingSettings.ColorPicker({
        name: "labelColor",
        displayName: "Label colour",
        value: { value: "#5e5d5a" },
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
    });
    chipTextColor = new formattingSettings.ColorPicker({
        name: "chipTextColor",
        displayName: "Selected chip text",
        value: { value: "#ffffff" },
    });
    datePeriodStyle = new formattingSettings.ItemDropdown({
        name: "datePeriodStyle",
        displayName: "Date period style",
        items: [
            { displayName: "Buttons", value: "buttons" },
            { displayName: "Dropdown", value: "dropdown" },
        ],
        value: { displayName: "Buttons", value: "buttons" },
    });
    datePeriodDefault = new formattingSettings.TextInput({
        name: "datePeriodDefault",
        displayName: "Default period",
        value: "Last 30 Days",
        placeholder: "Default selection",
    });
    maxVisiblePeriods = new formattingSettings.NumUpDown({
        name: "maxVisiblePeriods",
        displayName: "Max visible periods",
        value: 8,
    });
    maxVisibleSlicers = new formattingSettings.NumUpDown({
        name: "maxVisibleSlicers",
        displayName: "Max visible slicer groups",
        value: 10,
    });
    fanDirection = new formattingSettings.ItemDropdown({
        name: "fanDirection",
        displayName: "Fan-out direction",
        items: [
            { displayName: "Auto", value: "auto" },
            { displayName: "Right", value: "right" },
            { displayName: "Left", value: "left" },
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
        this.datePeriodStyle,
        this.datePeriodDefault,
        this.maxVisiblePeriods,
        this.maxVisibleSlicers,
        this.fanDirection,
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    slicerBarCard = new SlicerBarSettings();
    cards = [this.slicerBarCard];
}
