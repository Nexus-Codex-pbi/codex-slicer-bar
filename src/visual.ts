"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ITooltipService = powerbi.extensibility.ITooltipService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import IFilter = powerbi.IFilter;

import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";
import { ColorHelper } from "powerbi-visuals-utils-colorutils";

import { VisualFormattingSettingsModel, textAlignFor } from "./settings";
import { toRgba } from "./shared/colorHelpers";
import { parseDataView, SlicerSection, SlicerItem } from "./dataParser";
import { Theme, accentToken, bandColor } from "./shared/bandEngine";
import { surfaceTokens, TABULAR_NUMS } from "./shared/designTokens";

// eslint-disable-next-line powerbi-visuals/no-http-string
const BASIC_FILTER_SCHEMA = "http://powerbi.com/product/schema#basic";

/** Luminance-based theme pick (same 0.55 threshold convention as the
 * pbiKpiCard v3 pilot, Plan 15) — decides whether the resolved background
 * reads as a "dark" or "light" surface. */
function themeFor(hex: string): Theme {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex || "");
    if (!m) return "dark";
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? "light" : "dark";
}

interface BasicFilter extends IFilter {
    $schema: string;
    target: { table: string; column: string };
    operator: string;
    values: (string | number)[];
    filterType: number;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private events: IVisualEventService;
    private localizationManager: ILocalizationManager;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private tooltipService: ITooltipService;

    // High contrast support
    private colorPalette: powerbi.extensibility.ISandboxExtendedColorPalette;
    private isHighContrast: boolean = false;

    private sections: SlicerSection[] = [];
    private cachedSections: SlicerSection[] | null = null;

    /** Selection state per section: sectionName → selected labels */
    private selections: Map<string, Set<string>> = new Map();

    // DOM
    private slicerRow: HTMLElement;

    // Currently open dropdown
    private openDropdownId: string = "";
    private activePanel: HTMLElement | null = null;

    // Skip PBI-triggered re-render after we apply our own filters
    private selfFilterPending: boolean = false;
    private initialised: boolean = false;

    // Store reference to document click handler for cleanup in destroy()
    private documentClickHandler: (e: MouseEvent) => void;

    // State for the Selected Chip Colour fx wiring (TRANS-04) — this
    // visual has no per-category selectionId concept (it drives external
    // filters via applyJsonFilter, not selection IDs), so Chip Colour is
    // wired as a single global/measure-level rule (dataView.metadata.objects),
    // matching the pbiKpiCard pilot's single-value fx pattern rather than
    // the per-instance categorical pattern.
    private chipColorHelper: ColorHelper | null = null;
    private resolvedChipColorHex: string = "#130064";

    // State for the Selected Chip TEXT Colour fx wiring (TEXT-02) — same
    // global/measure-level shape as chipColorHelper above (this visual has
    // no per-category selectionId concept). Governs the chip LABEL text
    // only, never the selection fill/border chrome (T-14-05/T-07-02).
    private chipTextColorHelper: ColorHelper | null = null;
    private resolvedChipTextColorHex: string = "#ffffff";

    // Custom in-iframe Title element (TITLE-01, shared _shared/formatting/
    // v2 standard) — persistent div above the slicer row, hidden unless
    // showTitle && titleText (render-nothing default, D-06).
    private titleEl: HTMLElement;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.localizationManager = options.host.createLocalizationManager();
        this.selectionManager = options.host.createSelectionManager();
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette as powerbi.extensibility.ISandboxExtendedColorPalette;
        this.isHighContrast = this.colorPalette.isHighContrast || false;
        this.formattingSettingsService = new FormattingSettingsService();
        this.target = options.element;
        this.target.style.display = "flex";
        this.target.style.flexDirection = "column";
        this.target.style.justifyContent = "center";
        this.target.style.height = "100%";

        // Title element sits ABOVE the slicer row inside this.target's
        // flex column. It is a child of this.target, so its right-clicks
        // bubble to the existing target contextmenu listener below — no
        // new context-menu dead zone.
        this.titleEl = document.createElement("div");
        this.titleEl.className = "osb-slicer-title";
        this.titleEl.style.display = "none";
        this.target.appendChild(this.titleEl);

        this.slicerRow = document.createElement("div");
        this.slicerRow.className = "osb-slicer-row";
        this.target.appendChild(this.slicerRow);

        // Close dropdown on outside click (store reference for destroy cleanup)
        this.documentClickHandler = (e: MouseEvent) => {
            if (!(e.target as HTMLElement)?.closest(".osb-slicer-group") &&
                !(e.target as HTMLElement)?.closest(".osb-fixed-panel")) {
                this.closeAllDropdowns();
            }
        };
        document.addEventListener("click", this.documentClickHandler);

        // Context menu — right-click shows PBI context menu
        this.target.addEventListener("contextmenu", (e: MouseEvent) => {
            this.selectionManager.showContextMenu({}, { x: e.clientX, y: e.clientY });
            e.preventDefault();
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);

        if (!options?.dataViews?.[0]) {
            this.events.renderingFinished(options);
            return;
        }

        try {
            // Refresh high contrast state each update
            this.isHighContrast = this.colorPalette.isHighContrast || false;

            const dv = options.dataViews[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
                VisualFormattingSettingsModel, dv
            );

            // ─── Conditional formatting (fx) wiring — Selected Chip Colour (TRANS-04) ──
            // slicerBarCard.chipColor already carried a bare `instanceKind:
            // ConstantOrRule` declaration, but with no
            // `selector`/`altConstantSelector` wired it was inert (Pitfall
            // 5). Wired here: a dataViewWildcard selector (so a rule can
            // match this property's instances/totals). This visual has no
            // per-category selectionId concept to bind an altConstantSelector
            // to (it drives external filters via applyJsonFilter, never
            // createSelectionIdBuilder), so altConstantSelector is left
            // undefined — the same graceful degrade path already
            // established on pbiKpiCard when no table identity exists.
            // Resolved at render via the official
            // ColorHelper.getColorForMeasure(dataView.metadata.objects, ...)
            // path, falling back to the static format-pane value otherwise.
            const chipFmt = this.formattingSettings.slicerBarCard;
            chipFmt.chipColor.selector = dataViewWildcard.createDataViewWildcardSelector(
                dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
            );
            chipFmt.chipColor.altConstantSelector = undefined;
            this.chipColorHelper = new ColorHelper(
                this.host.colorPalette,
                { objectName: "slicerBar", propertyName: "chipColor" },
                chipFmt.chipColor.value.value
            );
            this.resolvedChipColorHex = this.chipColorHelper.getColorForMeasure(dv.metadata?.objects, "chipColor")
                ?? chipFmt.chipColor.value.value;

            // ─── fx wiring — Selected Chip Text Colour (TEXT-02) ────────
            // Same global/measure-level pattern as chipColor above:
            // dataViewWildcard selector, altConstantSelector undefined (no
            // per-category selectionId concept exists in this visual),
            // resolved once per update via dataView.metadata.objects.
            // Applies to the chip LABEL text only — the selection-state
            // fill/border chrome is untouched (T-14-05).
            chipFmt.chipTextColor.selector = dataViewWildcard.createDataViewWildcardSelector(
                dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
            );
            chipFmt.chipTextColor.altConstantSelector = undefined;
            this.chipTextColorHelper = new ColorHelper(
                this.host.colorPalette,
                { objectName: "slicerBar", propertyName: "chipTextColor" },
                chipFmt.chipTextColor.value.value
            );
            this.resolvedChipTextColorHex = this.chipTextColorHelper.getColorForMeasure(dv.metadata?.objects, "chipTextColor")
                ?? chipFmt.chipTextColor.value.value;

            const parsed = parseDataView(dv);

            // Per-section cache: keep the fullest set of items ever seen for each
            // section. This lets us preserve our own slicer options after applying
            // our own filter (which shrinks the dataView), while still letting
            // EXTERNAL filters from other visuals/slicers narrow the displayed
            // items (the filter-in certification requirement).
            const nextCache: SlicerSection[] = [];
            const parsedByName = new Map<string, SlicerSection>();
            for (const ps of parsed) parsedByName.set(ps.name, ps);

            for (const ps of parsed) {
                const cached = this.cachedSections?.find(c => c.name === ps.name);
                if (cached && cached.items.length > ps.items.length) {
                    // Merge: keep previously-seen fullest items as cache
                    nextCache.push({ ...ps, items: cached.items });
                } else {
                    nextCache.push(ps);
                }
            }
            this.cachedSections = nextCache;

            // For display: sections that THIS visual has actively filtered keep
            // the full cached items (so the user can still pick other values);
            // sections without our own selection use the parsed items, which
            // reflect any external filter-in from other visuals.
            this.sections = parsed.map(ps => {
                const ownSel = this.selections.get(ps.name);
                if (ownSel && ownSel.size > 0) {
                    const cached = nextCache.find(c => c.name === ps.name);
                    if (cached) return cached;
                }
                return ps;
            });

            // Apply formatting panel defaults where data doesn't specify
            this.applyFormattingDefaults();

            if (this.selfFilterPending) {
                this.selfFilterPending = false;
            } else {
                // Read filters on every update to respond to cross-filtering from other visuals
                this.readAppliedFilters(options);

                // Auto-select defaults only on first init
                if (!this.initialised) {
                    this.initialised = true;
                    let appliedAnyDefault = false;
                    for (const section of this.sections) {
                        if (!section.defaultValue) continue;
                        const sel = this.selections.get(section.name);
                        if (sel && sel.size > 0) continue;
                        const match = section.items.find(
                            item => item.label.toLowerCase() === section.defaultValue.toLowerCase()
                        );
                        if (match) {
                            this.selections.set(section.name, new Set([match.label]));
                            if (section.filterTarget) appliedAnyDefault = true;
                        }
                    }
                    if (appliedAnyDefault) {
                        this.applyAllFilters();
                    }
                }
            }

            this.renderSlicerBar(options.viewport.width);
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    /* ═══════════════════════════════════════
     * FORMATTING DEFAULTS
     * ═══════════════════════════════════════ */

    private applyFormattingDefaults(): void {
        const s = this.formattingSettings.slicerBarCard;
        const globalDisplay = String(s.defaultDisplayMode.value.value || "auto");
        const globalSelection = String(s.defaultSelectionMode.value.value || "single");

        for (const section of this.sections) {
            if (section.displayMode !== "chips" && section.displayMode !== "dropdown") {
                if (globalDisplay === "chips" || globalDisplay === "dropdown") {
                    section.displayMode = globalDisplay;
                } else {
                    section.displayMode = section.items.length <= (s.maxVisibleChips.value || 8)
                        ? "chips" : "dropdown";
                }
            }
            if (section.selectionMode !== "single" && section.selectionMode !== "multi") {
                section.selectionMode = globalSelection;
            }
        }
    }

    /* ═══════════════════════════════════════
     * SLICER BAR RENDER
     * ═══════════════════════════════════════ */

    private renderSlicerBar(viewportWidth: number): void {
        const s = this.formattingSettings.slicerBarCard;
        const hc = this.isHighContrast;
        const fg = hc ? this.colorPalette.foreground.value : "";
        const bg = hc ? this.colorPalette.background.value : "";
        const maxSections = s.maxVisibleSections.value || 10;
        let sectionCount = 0;

        // ─── Custom in-iframe Title (TITLE-01, shared v2 standard) ─────
        // Render gate: showTitle && titleText (render-nothing default —
        // showTitle defaults false so old saved reports are pixel-identical,
        // D-06). textContent only — no HTML-string injection (cert + XSS).
        const titleFmt = this.formattingSettings.titleSettings;
        if (titleFmt?.showTitle?.value && titleFmt?.titleText?.value) {
            this.titleEl.textContent = String(titleFmt.titleText.value);
            this.titleEl.style.fontFamily = titleFmt.titleFontFamily?.value || "Segoe UI, sans-serif";
            this.titleEl.style.fontSize = `${titleFmt.titleFontSize?.value ?? 14}px`;
            this.titleEl.style.fontWeight = this.weightFor(titleFmt.titleBold?.value, "400");
            this.titleEl.style.fontStyle = titleFmt.titleItalic?.value ? "italic" : "normal";
            this.titleEl.style.textDecoration = titleFmt.titleUnderline?.value ? "underline" : "none";
            this.titleEl.style.textAlign = textAlignFor(titleFmt.titleAlign?.value as string);
            // Adaptive default (D-16 sentinel): untouched shared-Title navy
            // swaps to the dark text token on dark surfaces (theme keyed off
            // the shared Background card, same source as the v3 theme pick below).
            const setTitle = titleFmt.titleColor?.value?.value || "#1a1a2e";
            const adaptiveTitle = setTitle === "#1a1a2e"
                && themeFor(this.formattingSettings.background.backgroundColor.value?.value ?? "#ffffff") === "dark"
                ? surfaceTokens("dark").text : setTitle;
            this.titleEl.style.color = hc ? fg : adaptiveTitle;
            this.titleEl.style.padding = "4px 12px 2px";
            this.titleEl.style.display = "";
        } else {
            this.titleEl.style.display = "none";
        }

        while (this.slicerRow.firstChild) { this.slicerRow.removeChild(this.slicerRow.firstChild); }
        // Dedicated background layer (D-05): the pre-existing
        // slicerBarCard.backgroundColor picker already painted
        // this.slicerRow unconditionally on every render (opaque #ffffff
        // default), matching the shared Background card's own raw default
        // — no transparency-default override needed (D-06). Swapped for
        // the shared Background card's toRgba() read, same swap pattern
        // the pilot established for pbiKpiCard's cardStyle.backgroundColor
        // (old backgroundColor capability stays declared, no longer read).
        const background = this.formattingSettings.background;
        const outerBgHex = background.backgroundColor.value?.value ?? "#ffffff";
        const outerBgTransparencyPct = background.transparency.value ?? 0;
        this.slicerRow.style.background = hc ? bg : toRgba(outerBgHex, outerBgTransparencyPct);
        this.slicerRow.style.width = viewportWidth + "px";

        // v3 theme pick (LOOK-05) — drives the CSS-only cyan hover ring and
        // the magenta clear-all hover via custom properties (visual.less);
        // per-instance "selected" chip colour is still resolved through the
        // existing fx-wired pickers below (D-16).
        const theme: Theme = themeFor(outerBgHex);
        const surf = surfaceTokens(theme);
        const accentHex = accentToken(theme);
        const dangerHex = bandColor("danger", theme);
        this.slicerRow.style.setProperty("--codex-accent", hc ? fg : accentHex);
        this.slicerRow.style.setProperty("--codex-danger", hc ? fg : dangerHex);

        // Right-justify the bar when fan direction is left
        const dir = String(s.fanDirection.value.value || "auto");
        this.slicerRow.style.justifyContent = dir === "left" ? "flex-end" : "";

        for (const section of this.sections) {
            if (sectionCount >= maxSections) break;

            if (sectionCount > 0) {
                const sep = document.createElement("span");
                sep.className = "osb-slicer-sep";
                this.slicerRow.appendChild(sep);
            }

            sectionCount++;

            const label = document.createElement("span");
            label.className = "osb-slicer-label";
            label.textContent = section.name.toUpperCase() + ":";
            label.style.color = hc ? fg : s.labelColor.value.value;
            label.style.fontSize = s.labelFontSize.value + "px";
            // Section label text treatment (TEXT-01) — bold-off falls back
            // to the surface's own pre-existing hardcoded weight 600.
            label.style.fontFamily = s.labelFontFamily?.value || "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
            label.style.fontWeight = this.weightFor(s.labelBold?.value, "600");
            label.style.fontStyle = s.labelItalic?.value ? "italic" : "normal";
            label.style.textDecoration = s.labelUnderline?.value ? "underline" : "none";
            this.slicerRow.appendChild(label);

            // v2 mono count badge (LOOK-05, §1 micro/count token) — one per
            // interactive filter group, dims at zero. Derived entirely from
            // this.selections (no new format-pane property).
            if (section.interactive) {
                const groupSel = this.selections.get(section.name) || new Set<string>();
                const countBadge = document.createElement("span");
                countBadge.className = "osb-chip-count";
                countBadge.textContent = String(groupSel.size);
                countBadge.style.fontFeatureSettings = TABULAR_NUMS;
                countBadge.style.color = hc ? fg : (groupSel.size > 0 ? accentHex : surf.muted);
                countBadge.style.borderColor = hc ? fg : surf.border;
                countBadge.style.opacity = groupSel.size > 0 ? "1" : "0.35";
                this.slicerRow.appendChild(countBadge);
            }

            if (!section.interactive) {
                this.renderStaticSection(section, s);
            } else if (section.displayMode === "dropdown") {
                this.renderDropdownSection(section, s);
            } else {
                this.renderChipsSection(section, s);
            }
        }

        // v2 suite-level Clear All + total-active count (LOOK-05) — right-
        // justified via CSS margin-left:auto, only when at least one
        // section rendered. Clears every section's own selection state and
        // re-runs the SAME filter pipeline a single chip click already
        // uses (via the existing per-section helper below), then re-renders.
        if (sectionCount > 0) {
            let totalActive = 0;
            for (const section of this.sections) {
                totalActive += (this.selections.get(section.name)?.size || 0);
            }

            const clearAllBtn = document.createElement("button");
            clearAllBtn.className = "osb-clear-all";
            clearAllBtn.textContent = "✕ " + this.localizationManager.getDisplayName("Clear_All");
            clearAllBtn.style.color = hc ? fg : surf.muted;
            clearAllBtn.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                for (const clearSection of this.sections) {
                    this.selections.set(clearSection.name, new Set());
                }
                if (this.sections.length > 0) {
                    this.applySectionFilter(this.sections[0]);
                }
                this.renderSlicerBar(this.target.clientWidth);
            });
            this.slicerRow.appendChild(clearAllBtn);

            const totalEl = document.createElement("span");
            totalEl.className = "osb-total-active";
            totalEl.textContent = `${totalActive} active`;
            totalEl.style.fontFeatureSettings = TABULAR_NUMS;
            totalEl.style.color = hc ? fg : surf.muted;
            this.slicerRow.appendChild(totalEl);
        }
    }

    /* ─── Static Section (non-interactive display) ─── */

    private renderStaticSection(section: SlicerSection, s: any): void {
        const hc = this.isHighContrast;
        const fg = hc ? this.colorPalette.foreground.value : "";
        for (const item of section.items) {
            const staticText = document.createElement("span");
            staticText.className = "osb-static-value";
            staticText.textContent = item.value || item.label;
            staticText.style.color = hc ? fg : s.labelColor.value.value;
            staticText.style.fontSize = s.labelFontSize.value + "px";
            this.slicerRow.appendChild(staticText);
        }
    }

    /* ─── Chips Section ─── */

    private renderChipsSection(section: SlicerSection, s: any): void {
        const hc = this.isHighContrast;
        const fg = hc ? this.colorPalette.foreground.value : "";
        const bg = hc ? this.colorPalette.background.value : "";
        const fgSelected = hc && (this.colorPalette as any).foregroundSelected
            ? (this.colorPalette as any).foregroundSelected.value : fg;
        const maxVisible = s.maxVisibleChips.value || 8;
        const visible = section.items.slice(0, maxVisible);
        const overflow = section.items.slice(maxVisible);
        const sel = this.selections.get(section.name) || new Set<string>();

        for (const item of visible) {
            const chip = document.createElement("button");
            chip.className = "osb-period-chip";
            chip.textContent = item.label;
            // Chip text treatment (TEXT-01) — bold-off falls back to the
            // chip's own pre-existing hardcoded weight 500. Applies to
            // text only; selection fill/border chrome below is untouched.
            this.applyChipFont(chip, s, "500");

            if (sel.has(item.label)) {
                chip.classList.add("selected");
                if (hc) {
                    // HC keeps the pre-existing solid-fill inversion (fg
                    // fill / bg text) — a stronger, more reliable
                    // accessible state indicator than a subtle outline +
                    // glow, and matches the suite's "drop all glow" HC
                    // rule (§8).
                    chip.style.background = fgSelected;
                    chip.style.color = bg;
                    chip.style.borderColor = fgSelected;
                    chip.style.boxShadow = "none";
                } else {
                    // v2 "selected" ring (LOOK-05, §4 brand focus
                    // treatment): cyan-by-default border + text + a small
                    // glow, no solid fill (replaces the old filled pill).
                    // Selected Chip Colour/Text still resolve via the
                    // existing fx pipeline (D-16) — their DECLARED
                    // DEFAULTS move to the brand cyan token (settings.ts)
                    // so an untouched report renders the v2 ring. Selected
                    // Chip Transparency now modulates the glow's colour-mix
                    // intensity — the fill it used to control no longer
                    // exists under the outline treatment.
                    const chipTransparencyPct = s.chipTransparency.value ?? 0;
                    const glowPct = Math.max(0, 100 - chipTransparencyPct);
                    chip.style.background = "transparent";
                    chip.style.color = this.resolvedChipTextColorHex;
                    chip.style.borderColor = this.resolvedChipColorHex;
                    chip.style.boxShadow = `0 0 8px color-mix(in srgb, ${this.resolvedChipColorHex} ${glowPct}%, transparent)`;
                }
            }

            chip.addEventListener("mousemove", (e: MouseEvent) => {
                const tooltipItems: VisualTooltipDataItem[] = [
                    { displayName: section.name, value: item.label }
                ];
                if (item.value) {
                    tooltipItems.push({ displayName: "Filter", value: item.value });
                }
                if (item.shortLabel) {
                    tooltipItems.push({ displayName: "Detail", value: item.shortLabel });
                }
                this.tooltipService.show({
                    coordinates: [e.clientX, e.clientY],
                    isTouchEvent: false,
                    dataItems: tooltipItems,
                    identities: []
                });
            });
            chip.addEventListener("mouseleave", () => {
                this.tooltipService.hide({ isTouchEvent: false, immediately: false });
            });

            chip.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.onChipClick(section, item.label);
            });
            chip.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.onChipClick(section, item.label);
                }
            });

            this.slicerRow.appendChild(chip);
        }

        if (overflow.length > 0) {
            const group = this.createDropdownGroup(
                `+${overflow.length} more`,
                `${section.name}_overflow`,
                (panel: HTMLElement) => {
                    this.buildDropdownItems(panel, section, overflow);
                }
            );
            this.slicerRow.appendChild(group);
        }
    }

    private onChipClick(section: SlicerSection, label: string): void {
        const sel = this.selections.get(section.name) || new Set<string>();

        if (section.selectionMode === "single") {
            if (sel.has(label) && sel.size === 1) {
                sel.clear();
            } else {
                sel.clear();
                sel.add(label);
            }
        } else {
            if (sel.has(label)) {
                sel.delete(label);
            } else {
                sel.add(label);
            }
        }

        this.selections.set(section.name, sel);
        this.applySectionFilter(section);
        this.renderSlicerBar(this.target.clientWidth);
    }

    /* ─── Dropdown Section ─── */

    private renderDropdownSection(section: SlicerSection, s: any): void {
        const sel = this.selections.get(section.name) || new Set<string>();
        const count = sel.size;

        let triggerLabel: string;
        if (section.selectionMode === "single") {
            triggerLabel = count === 1 ? Array.from(sel)[0] : `Select ${section.name.toLowerCase()}`;
        } else {
            if (count === 0 || count === section.items.length) {
                triggerLabel = `All ${section.name.toLowerCase()}`;
            } else if (count === 1) {
                triggerLabel = Array.from(sel)[0];
            } else {
                triggerLabel = `${count} selected`;
            }
        }

        // Build shortLabel text from selected items
        let shortLabelText = "";
        if (count > 0) {
            const selectedItems = section.items.filter(i => sel.has(i.label));
            const labels = selectedItems.map(i => i.shortLabel).filter(sl => sl);
            if (labels.length > 0) {
                shortLabelText = labels.join(", ");
            }
        }

        const group = this.createDropdownGroup(
            triggerLabel,
            `section_${section.name}`,
            (panel: HTMLElement) => {
                if (section.items.length > 10) {
                    const searchInput = document.createElement("input");
                    searchInput.className = "osb-panel-search";
                    searchInput.type = "text";
                    searchInput.placeholder = this.localizationManager.getDisplayName("Search_Placeholder");
                    searchInput.addEventListener("click", (e) => e.stopPropagation());
                    searchInput.addEventListener("input", () => {
                        this.buildDropdownItems(itemsContainer, section, null, searchInput.value);
                    });
                    panel.appendChild(searchInput);
                }

                if (section.selectionMode === "multi") {
                    const actions = document.createElement("div");
                    actions.className = "osb-panel-actions";

                    const selectAll = document.createElement("button");
                    selectAll.className = "osb-panel-action-btn";
                    selectAll.textContent = this.localizationManager.getDisplayName("Select_All");
                    selectAll.addEventListener("click", (e: MouseEvent) => {
                        e.stopPropagation();
                        this.selections.set(section.name, new Set(section.items.map(i => i.label)));
                        this.applySectionFilter(section);
                        this.closeAllDropdowns();
                        this.renderSlicerBar(this.target.clientWidth);
                    });

                    const clearAll = document.createElement("button");
                    clearAll.className = "osb-panel-action-btn";
                    clearAll.textContent = this.localizationManager.getDisplayName("Clear_All");
                    clearAll.addEventListener("click", (e: MouseEvent) => {
                        e.stopPropagation();
                        this.selections.set(section.name, new Set());
                        this.applySectionFilter(section);
                        this.closeAllDropdowns();
                        this.renderSlicerBar(this.target.clientWidth);
                    });

                    actions.appendChild(selectAll);
                    actions.appendChild(clearAll);
                    panel.appendChild(actions);
                }

                const itemsContainer = document.createElement("div");
                itemsContainer.className = "osb-panel-items";
                this.buildDropdownItems(itemsContainer, section);
                panel.appendChild(itemsContainer);
            }
        );
        this.slicerRow.appendChild(group);

        // Show shortLabel (e.g. date range) next to trigger when selected
        if (shortLabelText) {
            const hc = this.isHighContrast;
            const fg = hc ? this.colorPalette.foreground.value : "";
            const subtitle = document.createElement("span");
            subtitle.className = "osb-short-label";
            subtitle.textContent = shortLabelText;
            subtitle.style.color = hc ? fg : s.labelColor.value.value;
            subtitle.style.fontSize = (s.labelFontSize.value - 1) + "px";
            this.slicerRow.appendChild(subtitle);
        }
    }

    private buildDropdownItems(
        container: HTMLElement,
        section: SlicerSection,
        items?: SlicerItem[] | null,
        filter?: string
    ): void {
        while (container.firstChild) { container.removeChild(container.firstChild); }
        const sel = this.selections.get(section.name) || new Set<string>();
        let renderItems = items || section.items;

        if (filter) {
            const lowerFilter = filter.toLowerCase();
            renderItems = renderItems.filter(i => i.label.toLowerCase().includes(lowerFilter));
        }

        // Dropdown-panel item text treatment (TEXT-01) — same chip font
        // composite; bold-off falls back to the item's own pre-existing
        // hardcoded weight 600.
        const s = this.formattingSettings.slicerBarCard;
        if (section.selectionMode === "single") {
            for (const item of renderItems) {
                const el = document.createElement("div");
                el.className = "osb-dropdown-item";
                if (sel.has(item.label)) el.classList.add("selected");
                el.textContent = item.label;
                this.applyChipFont(el, s, "600");
                el.addEventListener("mousemove", (e: MouseEvent) => {
                    this.tooltipService.show({
                        coordinates: [e.clientX, e.clientY],
                        isTouchEvent: false,
                        dataItems: [{ displayName: section.name, value: item.label }],
                        identities: []
                    });
                });
                el.addEventListener("mouseleave", () => {
                    this.tooltipService.hide({ isTouchEvent: false, immediately: false });
                });
                el.addEventListener("click", (e: MouseEvent) => {
                    e.stopPropagation();
                    this.onChipClick(section, item.label);
                    this.closeAllDropdowns();
                });
                container.appendChild(el);
            }
        } else {
            for (const item of renderItems) {
                const label = document.createElement("label");
                label.className = "osb-dropdown-item osb-checkbox-item";
                this.applyChipFont(label, s, "600");

                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = sel.has(item.label);
                cb.addEventListener("change", (e: Event) => {
                    e.stopPropagation();
                    const currentSel = this.selections.get(section.name) || new Set<string>();
                    if (cb.checked) {
                        currentSel.add(item.label);
                    } else {
                        currentSel.delete(item.label);
                    }
                    this.selections.set(section.name, currentSel);
                    this.applySectionFilter(section);
                    this.renderSlicerBar(this.target.clientWidth);
                });

                const span = document.createElement("span");
                span.textContent = item.label;

                label.appendChild(cb);
                label.appendChild(span);
                label.addEventListener("click", (e) => e.stopPropagation());
                container.appendChild(label);
            }
        }
    }

    /* ═══════════════════════════════════════
     * FILTER APPLICATION
     * ═══════════════════════════════════════ */

    /**
     * Build a Basic Filter array from ALL sections with an active selection,
     * then push the full array to PBI in one call. This is the critical
     * filter-pipeline semantics: PBI keys filters by (objectName,propertyName),
     * so each call to applyJsonFilter(filter,'general','filter',merge) REPLACES
     * the previously-applied filter unless we send the complete set every time.
     * Sending the array ensures Region + Period + Status selections coexist
     * instead of clobbering each other.
     */
    private applyAllFilters(): void {
        const filters: BasicFilter[] = [];
        for (const section of this.sections) {
            if (!section.filterTarget) continue;
            const sel = this.selections.get(section.name);
            if (!sel || sel.size === 0) continue;
            if (sel.size === section.items.length) continue; // all = no filter
            filters.push({
                $schema: BASIC_FILTER_SCHEMA,
                target: section.filterTarget,
                operator: "In",
                values: Array.from(sel),
                filterType: 1,
            });
        }

        this.selfFilterPending = true;
        try {
            if (filters.length > 0) {
                (this.host as any).applyJsonFilter(filters, "general", "filter", 0 /* merge */);
            } else {
                (this.host as any).applyJsonFilter(null, "general", "filter", 1 /* remove */);
            }
        } catch {
            // Filter apply failed — ignore silently
        }
    }

    // Back-compat shim so existing callers inside this class continue to work.
    private applySectionFilter(_section: SlicerSection): void {
        this.applyAllFilters();
    }

    private readAppliedFilters(options: VisualUpdateOptions): void {
        try {
            const jsonFilters = (options as any).jsonFilters || [];
            const targetToSection = new Map<string, string>();
            for (const section of this.sections) {
                if (section.filterTarget) {
                    const key = `${section.filterTarget.table}.${section.filterTarget.column}`;
                    targetToSection.set(key, section.name);
                }
            }

            for (const f of jsonFilters) {
                if (!f?.target) continue;
                const key = `${f.target.table || ""}.${f.target.column || ""}`;
                const sectionName = targetToSection.get(key);
                if (sectionName) {
                    this.selections.set(sectionName, new Set(f.values || []));
                }
            }
        } catch {
            // Ignore filter read errors
        }
    }

    /* ═══════════════════════════════════════
     * DROPDOWN GROUP — fixed-position panels
     * ═══════════════════════════════════════ */

    private createDropdownGroup(
        label: string,
        id: string,
        buildItems: (panel: HTMLElement) => void
    ): HTMLElement {
        const group = document.createElement("div");
        group.className = "osb-slicer-group";

        const trigger = document.createElement("button");
        trigger.className = "osb-dropdown-trigger";
        trigger.textContent = label;
        // Trigger label text treatment (TEXT-01) — same chip font
        // composite; bold-off falls back to the trigger's pre-existing
        // default weight 400 (no hardcoded font-weight in CSS).
        this.applyChipFont(trigger, this.formattingSettings.slicerBarCard, "400");

        trigger.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (this.openDropdownId === id) {
                this.closeAllDropdowns();
                return;
            }
            this.closeAllDropdowns();
            this.openDropdownId = id;
            trigger.classList.add("open");

            // Create fixed-position panel attached to document body
            const panel = document.createElement("div");
            panel.className = "osb-fixed-panel";
            this.activePanel = panel;

            // Build content
            buildItems(panel);
            this.applyPanelColors(panel, trigger);

            // Add to body so it escapes the scroll container
            document.body.appendChild(panel);

            // Position relative to trigger
            const triggerRect = trigger.getBoundingClientRect();
            const dir = String(this.formattingSettings.slicerBarCard.fanDirection.value.value || "auto");

            this.positionPanel(panel, triggerRect, dir);

            // Stop clicks inside panel from closing it
            panel.addEventListener("click", (ev) => ev.stopPropagation());
        });

        group.appendChild(trigger);
        return group;
    }

    private positionPanel(panel: HTMLElement, triggerRect: DOMRect, dir: string): void {
        const margin = 4;

        // Make visible to measure
        panel.style.visibility = "hidden";
        panel.style.display = "inline-flex";

        const panelRect = panel.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let resolvedDir = dir;
        if (resolvedDir === "auto") {
            const spaceRight = vw - triggerRect.right - margin;
            const spaceLeft = triggerRect.left - margin;
            const spaceDown = vh - triggerRect.bottom - margin;
            const spaceUp = triggerRect.top - margin;

            if (spaceRight >= panelRect.width) {
                resolvedDir = "right";
            } else if (spaceLeft >= panelRect.width) {
                resolvedDir = "left";
            } else if (spaceDown >= panelRect.height) {
                resolvedDir = "down";
            } else if (spaceUp >= panelRect.height) {
                resolvedDir = "up";
            } else {
                resolvedDir = spaceRight >= spaceLeft ? "right" : "left";
            }
        }

        let top: number;
        let left: number;

        switch (resolvedDir) {
            case "right":
                left = triggerRect.right + margin;
                top = triggerRect.top + triggerRect.height / 2 - panelRect.height / 2;
                break;
            case "left":
                left = triggerRect.left - panelRect.width - margin;
                top = triggerRect.top + triggerRect.height / 2 - panelRect.height / 2;
                break;
            case "down":
                left = triggerRect.left;
                top = triggerRect.bottom + margin;
                break;
            case "up":
                left = triggerRect.left;
                top = triggerRect.top - panelRect.height - margin;
                break;
            default:
                left = triggerRect.right + margin;
                top = triggerRect.top + triggerRect.height / 2 - panelRect.height / 2;
        }

        // Clamp to viewport
        if (top < margin) top = margin;
        if (top + panelRect.height > vh - margin) top = vh - margin - panelRect.height;
        if (left < margin) left = margin;
        if (left + panelRect.width > vw - margin) left = vw - margin - panelRect.width;

        panel.style.top = top + "px";
        panel.style.left = left + "px";

        panel.style.visibility = "visible";
    }

    private closeAllDropdowns(): void {
        // Remove fixed panel from body
        if (this.activePanel) {
            this.activePanel.remove();
            this.activePanel = null;
        }
        this.target.querySelectorAll(".osb-dropdown-trigger.open").forEach(
            (t) => t.classList.remove("open")
        );
        this.openDropdownId = "";
    }

    /* ═══════════════════════════════════════
     * PANEL COLOUR APPLICATION
     * ═══════════════════════════════════════ */

    private applyPanelColors(panel: HTMLElement, trigger: HTMLElement): void {
        const s = this.formattingSettings.slicerBarCard;
        const hc = this.isHighContrast;
        const fg = hc ? this.colorPalette.foreground.value : "";
        const bg = hc ? this.colorPalette.background.value : "";
        const fgSelected = hc && (this.colorPalette as any).foregroundSelected
            ? (this.colorPalette as any).foregroundSelected.value : fg;

        // Dedicated background layer (D-05): same shared Background card
        // + toRgba() read as renderSlicerBar's this.slicerRow paint (same
        // underlying colour, this is a second render site for it — the
        // floating dropdown panel/trigger — not a new colour surface).
        const background = this.formattingSettings.background;
        const outerBgHex = background.backgroundColor.value?.value ?? "#ffffff";
        const outerBgTransparencyPct = background.transparency.value ?? 0;

        // chipBg stays OPAQUE — used for text/border legibility (action
        // button text colour, selected-item border) per T-07-02; only the
        // selected-item FILL (chipFill below) carries the transparency +
        // fx-resolved colour.
        const chipBg = hc ? fg : this.resolvedChipColorHex;
        const chipTransparencyPct = s.chipTransparency.value ?? 0;
        const chipFill = hc ? fgSelected : toRgba(this.resolvedChipColorHex, chipTransparencyPct);
        // fx-resolved Selected Chip Text Colour (TEXT-02) — label text
        // only; selection fill/border chrome untouched (T-14-05).
        const chipText = hc ? bg : this.resolvedChipTextColorHex;
        const borderClr = hc ? fg : s.borderColor.value.value;
        const bgClr = hc ? bg : toRgba(outerBgHex, outerBgTransparencyPct);
        const labelClr = hc ? fg : s.labelColor.value.value;
        const itemBg = hc ? bg : "#ffffff";
        const itemText = hc ? fg : "#1a1a1a";
        const hoverBg = hc ? bg : (outerBgHex === "#ffffff" ? "#f0eef8" : toRgba(outerBgHex, outerBgTransparencyPct));

        panel.style.background = bgClr;
        panel.style.borderColor = borderClr;

        trigger.style.borderColor = borderClr;
        trigger.style.background = bgClr;
        trigger.style.color = labelClr;

        panel.querySelectorAll(".osb-panel-action-btn").forEach((btn: HTMLElement) => {
            btn.style.color = chipBg;
        });

        panel.querySelectorAll(".osb-panel-search").forEach((inp: HTMLElement) => {
            inp.style.borderColor = borderClr;
        });

        panel.querySelectorAll(".osb-dropdown-item").forEach((item: HTMLElement) => {
            const isSelected = item.classList.contains("selected");
            if (isSelected) {
                item.style.background = chipFill;
                item.style.color = chipText;
                item.style.borderColor = hc ? fgSelected : chipBg;
            } else {
                item.style.background = itemBg;
                item.style.color = itemText;
                item.style.borderColor = borderClr;
            }

            item.addEventListener("mouseenter", () => {
                if (!item.classList.contains("selected")) {
                    item.style.borderColor = chipBg;
                    item.style.color = chipBg;
                    item.style.background = hoverBg;
                }
            });
            item.addEventListener("mouseleave", () => {
                if (!item.classList.contains("selected")) {
                    item.style.borderColor = borderClr;
                    item.style.color = itemText;
                    item.style.background = itemBg;
                }
            });
        });
    }

    /* ═══════════════════════════════════════
     * TEXT TREATMENT HELPERS (TEXT-01, D-06)
     * ═══════════════════════════════════════ */

    /** weightFor(bold, restWeight) idiom — bold on renders "700"; bold off
     *  falls back to the surface's own pre-existing hardcoded weight so old
     *  saved reports render pixel-identical at the new property defaults. */
    private weightFor(bold: boolean | undefined, restWeight: string): string {
        return bold ? "700" : restWeight;
    }

    /** Apply the shared chip font composite (family/size/bold/italic/
     *  underline) to a chip/trigger/dropdown-item text surface. Colour is
     *  deliberately NOT set here — each call site keeps its own colour
     *  logic (selection chrome, high contrast, fx). */
    private applyChipFont(el: HTMLElement, s: any, restWeight: string): void {
        el.style.fontFamily = s.chipFontFamily?.value || "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
        el.style.fontSize = `${s.chipFontSize?.value ?? 11}px`;
        el.style.fontWeight = this.weightFor(s.chipBold?.value, restWeight);
        el.style.fontStyle = s.chipItalic?.value ? "italic" : "normal";
        el.style.textDecoration = s.chipUnderline?.value ? "underline" : "none";
    }

    public destroy(): void {
        this.closeAllDropdowns();
        document.removeEventListener("click", this.documentClickHandler);
        if (this.activePanel) {
            this.activePanel.remove();
            this.activePanel = null;
        }
    }
}
