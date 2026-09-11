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
import { toRgba, compositeOver, contrastInk, contrastRatio } from "./shared/colorHelpers";
import { parseDataView, SlicerSection, SlicerItem, FilterValue } from "./dataParser";
import { Theme, accentToken, bandColor } from "./shared/bandEngine";
import { surfaceTokens, TABULAR_NUMS } from "./shared/designTokens";
import { makeCornerBrackets, CardSignatureHandle } from "./shared/cardSignature";
import { applyCardSignature } from "./shared/cardSignatureSettings";
import { applyBorder } from "./shared/borderSettings";
import { LicenseGate } from "./shared/licensing";

// eslint-disable-next-line powerbi-visuals/no-http-string
const BASIC_FILTER_SCHEMA = "http://powerbi.com/product/schema#basic";

/** The stylesheet's own unselected-chip fill — a MIRROR of
 * `style/visual.less` `.osb-period-chip { background: #f5f4f0 }`, not a new
 * colour: the neon-lite branch sets no inline background, so this is the
 * surface its ink is painted on (NEXUS cycle-11 §7). Never reaches the DOM;
 * it is only read to judge contrast, and only in the non-HC branch. */
const CHIP_SHEET_FILL_HEX = "#f5f4f0";

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
    values: FilterValue[];
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

    /** Selection state per section, keyed by typed filter value, never display text. */
    private selections: Map<string, Set<FilterValue>> = new Map();

    // DOM
    private slicerRow: HTMLElement;

    // Currently open dropdown
    private openDropdownId: string = "";
    private activePanel: HTMLElement | null = null;

    // Skip PBI-triggered re-render after we apply our own filters
    private selfFilterPending: boolean = false;
    private pendingFilterSignature = "";
    private initialised: boolean = false;
    private lastJsonFilters: unknown;
    private externalConstraints: BasicFilter[] = [];
    private acceptedSelections: Map<string, Set<FilterValue>> = new Map();
    private filterError = false;
    private sectionDefaults = new Map<string, { target: string; value: string }>();

    // Store reference to document click handler for cleanup in destroy()
    private documentClickHandler: (e: MouseEvent) => void;
    private contextMenuHandler: (e: MouseEvent) => void;
    private destroyed = false;

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

    // NEXUS cycle-11 §7 (round 2). True when the report itself carries a
    // chipTextColor object — i.e. the author opened the picker (or bound an
    // fx rule to it). The review's correction line scopes this finding to the
    // DEFAULT pair ("The sample uses explicit contrasting pairs; the default
    // defect remains recorded"), so an explicit pick is never second-guessed:
    // a saved report that set this colour renders exactly as it renders today.
    private chipTextColorAuthored: boolean = false;

    // The opaque colour a viewer actually sees behind the bar: the Background
    // card's colour at its own transparency, over whatever the host theme
    // paints behind the tile. Ink legibility is judged against this, never
    // against the raw picker hex (NEXUS review 2026-09-11, class 1).
    private resolvedRootSurfaceHex: string = "#ffffff";

    // Custom in-iframe Title element (TITLE-01, shared _shared/formatting/
    // v2 standard) — persistent div above the slicer row, hidden unless
    // showTitle && titleText (render-nothing default, D-06).
    private titleEl: HTMLElement;
    // Corner-bracket card signature (suite kit) — accent-tinted overlay on the
    // full-tile root, painted above the bar. pointer-events:none.
    private cornerSignature: CardSignatureHandle | null = null;
    // Theme resolved from the shared Background card each render — chip and
    // dropdown renderers key surface tokens + glow strength off it.
    private resolvedTheme: Theme = "light";
    // Per-section survivor sets when an EXTERNAL cross-filter has narrowed the
    // incoming dataView (section name → labels still present). Empty map when
    // no external filter is active. Drives the neon-lite/ghost chip states.
    private externalAvail: Map<string, Set<FilterValue>> = new Map();

    private licenseGate: LicenseGate;

    private lastUpdateOptions: VisualUpdateOptions | null = null;


    constructor(options: VisualConstructorOptions) {

        // NO FREE TIER — an unlicensed user gets the whole visual blocked.

        // The check is async, so re-run the last update once it resolves.

        this.licenseGate = new LicenseGate(options.host, () => {

            if (this.lastUpdateOptions) this.update(this.lastUpdateOptions);

        });
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
        // Root carries the suite chrome (fill-tile background, Border card,
        // corner accents): keep the border inside the tile and anchor the
        // absolutely-positioned corner overlay.
        this.target.style.boxSizing = "border-box";
        this.target.style.position = "relative";

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

        // Corner-bracket card signature (suite kit) — appended last so it
        // overlays the bar; accent-tinted, refreshed per render via
        // applyCardSignature.
        this.cornerSignature = makeCornerBrackets(
            this.target,
            accentToken("dark"),
            { variant: "cornerBracket", mirror: true }
        );

        // Close dropdown on outside click (store reference for destroy cleanup)
        this.documentClickHandler = (e: MouseEvent) => {
            if (!(e.target as HTMLElement)?.closest(".osb-slicer-group") &&
                !(e.target as HTMLElement)?.closest(".osb-fixed-panel")) {
                this.closeAllDropdowns();
            }
        };
        document.addEventListener("click", this.documentClickHandler);

        // Context menu — right-click shows PBI context menu
        this.contextMenuHandler = (e: MouseEvent) => {
            this.selectionManager.showContextMenu({}, { x: e.clientX, y: e.clientY });
            e.preventDefault();
        };
        this.target.addEventListener("contextmenu", this.contextMenuHandler);
    }

    public update(options: VisualUpdateOptions): void {
        if (this.destroyed) return;
        this.events.renderingStarted(options);
        this.lastUpdateOptions = options;

        if (this.licenseGate.blockedThisFrame()) {
            // The fan-out panel lives on document.body, NOT under this.target, so
            // hiding the root leaves it on screen with live handlers — NEXUS cycle-11
            // §1 landed a second filter AFTER the denial. Tear it down first.
            this.closeAllDropdowns();
            this.target.style.display = "none";
            this.events.renderingFinished(options);
            return;
        }
        this.target.style.display = "";

        if (!options?.dataViews?.[0]) {
            this.resetData();
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
            // Did the report SET this ink, or is it still the declared default?
            // dataView.metadata.objects is the same bag populateFormattingSettingsModel
            // and getColorForMeasure both read, so its slicerBar.chipTextColor
            // entry exists if and only if the author persisted one.
            const chipTextObject = (dv.metadata?.objects as any)?.slicerBar?.chipTextColor;
            this.chipTextColorAuthored = chipTextObject !== undefined && chipTextObject !== null;

            const parsed = parseDataView(dv);
            if (!parsed.length) {
                this.resetData();
                this.renderSlicerBar(options.viewport.width);
                this.events.renderingFinished(options);
                return;
            }

            // Reconcile host state before attributing a narrowed domain to our
            // own selection. Missing sections may still be external survivors.
            this.sections = [...parsed, ...(this.cachedSections || []).filter(c =>
                !parsed.some(ps => ps.name === c.name))];
            this.readAppliedFilters(options);
            let domainSelectionChanged = false;
            const nextCache: SlicerSection[] = [];
            const parsedByName = new Map<string, SlicerSection>();
            for (const ps of parsed) parsedByName.set(ps.name, ps);

            for (const ps of parsed) {
                const cached = this.cachedSections?.find(c => c.name === ps.name);
                const sameTarget = cached && JSON.stringify(cached.filterTarget) === JSON.stringify(ps.filterTarget);
                const cachedValues = new Set(cached?.items.map(item => item.rawValue));
                const subset = sameTarget && ps.items.every(item => cachedValues.has(item.rawValue));
                if (cached && subset) {
                    nextCache.push({ ...ps, items: cached.items });
                } else {
                    nextCache.push(ps);
                    const selected = this.selections.get(ps.name);
                    if (cached && selected?.size) {
                        const values = new Set(ps.items.map(item => item.rawValue));
                        const retained = new Set([...selected].filter(value => sameTarget && values.has(value)));
                        if (retained.size !== selected.size) {
                            this.selections.set(ps.name, retained);
                            domainSelectionChanged = true;
                        }
                    }
                }
            }
            // Preserve cached sections that VANISHED from this update entirely —
            // an external cross-filter can eliminate every row of a section
            // (single-field mode, or sparse bridge data), and dropping them
            // from the cache here is what made them blink out of the display
            // instead of ghosting (Neil live-QA 2026-07-16). An empty parsed
            // set is treated as a reset (unbound field / cleared data), not a
            // filter.
            if (parsed.length > 0 && this.cachedSections) {
                for (const c of this.cachedSections) {
                    if (!parsedByName.has(c.name)) nextCache.push(c);
                }
                nextCache.sort((a, b) => a.sectionSort - b.sectionSort);
            }
            this.cachedSections = nextCache;

            // For display: sections that THIS visual has actively filtered keep
            // the full cached items (so the user can still pick other values).
            // Sections WITHOUT our own selection that arrive narrowed relative
            // to the fullest set we've seen = an EXTERNAL cross-filter from
            // another visual — keep the FULL list on screen and record which
            // labels survive; the chip render neon-lights the survivors and
            // ghosts the rest (Neil live-QA 2026-07-16: chips must not vanish,
            // they highlight). Own-selection sections skip the survivor diff —
            // a shrunk dataView there is (or may be) our own filter reflected
            // back, not attributable to an external visual.
            this.externalAvail.clear();
            this.sections = nextCache.map(c => {
                const ps = parsedByName.get(c.name);
                const ownSel = this.selections.get(c.name);
                if (ownSel?.size && ps?.items.every(item => ownSel.has(item.rawValue))) {
                    return c;
                }
                if (!ps) {
                    // Whole section eliminated by an external cross-filter:
                    // render it from cache with EVERY item ghosted.
                    this.externalAvail.set(c.name, new Set());
                    return c;
                }
                if (c.items.length > ps.items.length) {
                    this.externalAvail.set(c.name, new Set(ps.items.map(i => i.rawValue)));
                    return c;
                }
                return ps;
            });

            // Apply formatting panel defaults where data doesn't specify
            this.applyFormattingDefaults();

            {
                this.selfFilterPending = false;

                this.initialised = true;
                let defaultsChanged = false;
                for (const section of this.sections) {
                    const target = JSON.stringify(section.filterTarget);
                    const previous = this.sectionDefaults.get(section.name);
                    this.sectionDefaults.set(section.name, { target, value: section.defaultValue });
                    const rebound = previous && previous.target !== target;
                    const changed = previous && previous.value !== section.defaultValue;
                    if (!previous || rebound || changed) {
                        if (previous) {
                            this.selections.delete(section.name);
                            defaultsChanged = true;
                        } else if (this.selections.get(section.name)?.size) {
                            continue;
                        }
                        if (!section.defaultValue) continue;
                        const match = section.items.find(item =>
                            item.label.toLowerCase() === section.defaultValue.toLowerCase());
                        if (!match) continue;
                        this.selections.set(section.name, new Set([match.rawValue]));
                        defaultsChanged = true;
                    }
                }
                if (defaultsChanged || domainSelectionChanged) this.applyAllFilters();
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

    private resetData(): void {
        const hadFilters = [...this.selections.values()].some(values => values.size > 0)
            || this.externalConstraints.length > 0;
        this.closeAllDropdowns();
        this.sections = [];
        this.cachedSections = null;
        this.selections.clear();
        this.acceptedSelections.clear();
        this.externalAvail.clear();
        this.externalConstraints = [];
        this.sectionDefaults.clear();
        this.lastJsonFilters = undefined;
        this.initialised = false;
        this.slicerRow.replaceChildren();
        this.titleEl.style.display = "none";
        if (hadFilters) this.applyAllFilters();
    }

    /* ═══════════════════════════════════════
     * FORMATTING DEFAULTS
     * ═══════════════════════════════════════ */

    private applyFormattingDefaults(): void {
        const s = this.formattingSettings.slicerBarCard;
        const globalDisplay = String(s.defaultDisplayMode.value.value || "auto");
        const globalSelection = String(s.defaultSelectionMode.value.value || "single");

        for (const section of this.sections) {
            if (!section.displayModeFromData) {
                if (globalDisplay === "chips" || globalDisplay === "dropdown") {
                    section.displayMode = globalDisplay;
                } else {
                    section.displayMode = section.items.length <= (s.maxVisibleChips.value || 8)
                        ? "chips" : "dropdown";
                }
            }
            if (!section.selectionModeFromData) {
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
        const titleInline = !!s.titleInline?.value;
        const showTitle = !!(titleFmt?.showTitle?.value && titleFmt?.titleText?.value);

        // Clear the bar row FIRST — an inline title lives INSIDE it and is
        // re-appended below (before the sections).
        while (this.slicerRow.firstChild) { this.slicerRow.removeChild(this.slicerRow.firstChild); }

        if (showTitle) {
            this.titleEl.textContent = String(titleFmt.titleText.value);
            this.titleEl.style.fontFamily = titleFmt.titleFontFamily?.value || "Segoe UI, sans-serif";
            this.titleEl.style.fontSize = `${titleFmt.titleFontSize?.value ?? 14}px`;
            this.titleEl.style.fontWeight = this.weightFor(titleFmt.titleBold?.value, "400");
            this.titleEl.style.fontStyle = titleFmt.titleItalic?.value ? "italic" : "normal";
            this.titleEl.style.textDecoration = titleFmt.titleUnderline?.value ? "underline" : "none";
            // Adaptive default (D-16 sentinel): untouched shared-Title navy
            // swaps to the dark text token on dark surfaces (theme keyed off
            // the shared Background card, same source as the v3 theme pick below).
            const setTitle = titleFmt.titleColor?.value?.value || "#1a1a2e";
            const adaptiveTitle = setTitle === "#1a1a2e"
                && themeFor(this.formattingSettings.background.backgroundColor.value?.value ?? "#ffffff") === "dark"
                ? surfaceTokens("dark").text : setTitle;
            this.titleEl.style.color = hc ? fg : adaptiveTitle;
            this.titleEl.style.display = "";
            if (titleInline) {
                // Inline ("Title inline with bar"): first item INSIDE the row,
                // vertically centred with the chips, then a pipe divider like
                // the sections. width:auto overrides the .osb-slicer-title
                // width:100% (which otherwise consumes the whole row and pushes
                // the chips off-screen). Alignment is layout-determined here.
                this.titleEl.style.textAlign = "left";
                this.titleEl.style.padding = "0 4px 0 0";
                this.titleEl.style.width = "auto";
                this.titleEl.style.alignSelf = "center";
                this.titleEl.style.whiteSpace = "nowrap";
                this.slicerRow.appendChild(this.titleEl);
                const titleSep = document.createElement("span");
                titleSep.className = "osb-slicer-sep";
                this.slicerRow.appendChild(titleSep);
            } else {
                // Above (default): its own row above the bar.
                this.titleEl.style.textAlign = textAlignFor(titleFmt.titleAlign?.value as string);
                this.titleEl.style.padding = "4px 12px 2px";
                this.titleEl.style.width = "";
                this.titleEl.style.alignSelf = "";
                this.titleEl.style.whiteSpace = "";
                if (this.titleEl.parentElement !== this.target) {
                    this.target.insertBefore(this.titleEl, this.slicerRow);
                }
            }
        } else {
            this.titleEl.style.display = "none";
        }

        // Fill-tile background (D-05): the bar band was painted before, leaving
        // the host tile visible above/below the bar = "multiple backgrounds".
        // Paint the full-height ROOT instead and keep the bar row transparent,
        // so a single background fills the tile.
        const background = this.formattingSettings.background;
        const outerBgHex = background.backgroundColor.value?.value ?? "#ffffff";
        const outerBgTransparencyPct = background.transparency.value ?? 0;
        this.target.style.background = hc ? bg : toRgba(outerBgHex, outerBgTransparencyPct);
        // The bar row is transparent, so every chip painted below sits on THIS
        // composited surface — the Background card over the host theme's
        // background. Cached for legibleChipInk() (NEXUS cycle-11 §7).
        this.resolvedRootSurfaceHex = compositeOver(
            outerBgHex, outerBgTransparencyPct, this.colorPalette.background?.value || "#ffffff");
        this.slicerRow.style.background = "transparent";
        this.slicerRow.style.width = viewportWidth + "px";

        // v3 theme pick (LOOK-05) — drives the CSS-only cyan hover ring and
        // the magenta clear-all hover via custom properties (visual.less);
        // per-instance "selected" chip colour is still resolved through the
        // existing fx-wired pickers below (D-16).
        const theme: Theme = themeFor(outerBgHex);
        this.resolvedTheme = theme;
        const surf = surfaceTokens(theme);
        const accentHex = accentToken(theme);
        const dangerHex = bandColor("danger", theme);
        this.slicerRow.style.setProperty("--codex-accent", hc ? fg : accentHex);
        this.slicerRow.style.setProperty("--codex-danger", hc ? fg : dangerHex);

        // ─── Suite chrome: Border card + Corner Accents on the full-tile root.
        // (The shared modules were vendored earlier as "source only — rebuild
        // at this visual's sample-QA turn"; this is that wiring.) Border is CSS
        // on the root; the corner signature overlay is refreshed to the theme
        // accent. Both frame the whole tile (which the background now fills).
        applyBorder(this.target, this.formattingSettings.visualBorder, {
            hcActive: hc,
            hcColor: fg,
            palette: this.colorPalette,
            metadataObjects: undefined,
        });
        applyCardSignature(this.cornerSignature, this.formattingSettings.cardSignature, {
            autoHex: accentHex,
            hcActive: hc,
            hcColor: fg,
            mirror: true,
            glowMix: hc ? 0 : (theme === "dark" ? 55 : 0),
            muted: false,
        });

        // Right-justify the bar when fan direction is left
        const dir = String(s.fanDirection.value.value || "auto");
        this.slicerRow.style.justifyContent = dir === "left" ? "flex-end" : "";

        // "Max visible sections" caps how wide the bar gets, but a section it
        // hid could still hold an active selection — a configured default, or
        // one restored from the host — and that selection is still emitted as a
        // filter. The bar then announced "1 active" for a filter with no
        // visible control to see, change or clear (NEXUS cycle-11 §4, case
        // `default-hidden-section`). A section that is filtering the report is
        // therefore always rendered; the cap still hides every section that
        // filters nothing, and the emitted filter set is unchanged either way.
        const visibleSections = this.sections.filter((section, index) =>
            index < maxSections || (this.selections.get(section.name)?.size || 0) > 0);

        for (const section of visibleSections) {
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
                const groupSel = this.selections.get(section.name) || new Set<FilterValue>();
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
        if (this.filterError) {
            const error = document.createElement("span");
            error.className = "osb-filter-error";
            error.setAttribute("role", "status");
            error.textContent = "Filter could not be applied.";
            error.style.color = hc ? fg : contrastInk(this.resolvedRootSurfaceHex, "#000000", "#ffffff");
            this.slicerRow.appendChild(error);
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

    /**
     * Selected Chip Text Colour, judged against the surface it is actually
     * painted on.
     *
     * NEXUS cycle-11 §7 — "make the default foreground/background pair legible
     * on both ring chips and filled dropdown items". The declared defaults pair
     * Selected chip #00d9ff with Selected chip text #00d9ff (settings.ts)
     * because v2 reads that pair as "ring + matching text" on the CHIP; the
     * dropdown item paints the same colour as a real fill, so the label lands in
     * its own fill's colour. Round 1 rescued only an EXACT collapse
     * (ink === composited fill), which is the wrong test: legibility is a
     * CONTRAST question. Measured on the round-1 bundle, a fill nudged one
     * channel (#00d9ff ink on a #00d8fe fill) still scored 1.009:1, a fully
     * transparent fill left cyan on the white panel at 1.698:1, and the ring
     * chip on the default light background — which round 1 never touched at
     * all — sat at 1.453:1.
     *
     * So: keep the declared default wherever it already clears WCAG 3:1 on the
     * composited surface (the cyan-on-dark neon ring every dark report ships
     * today measures 11.808:1 and is untouched), and only where it does not,
     * fall back to contrastInk() against that same surface. An ink the AUTHOR
     * set is returned unchanged either way — legible or not, it is theirs.
     */
    private legibleChipInk(surfaceHex: string): string {
        const ink = String(this.resolvedChipTextColorHex ?? "");
        if (this.chipTextColorAuthored || contrastRatio(ink, surfaceHex) >= 3) return ink;
        // surfaceTokens("light").text is the ink for LIGHT surfaces (dark ink)
        // and surfaceTokens("dark").text the ink for DARK ones, which is the
        // (surface, darkInk, lightInk) order contrastInk expects.
        return contrastInk(surfaceHex, surfaceTokens("light").text, surfaceTokens("dark").text);
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
        const sel = this.selections.get(section.name) || new Set<FilterValue>();

        for (const item of visible) {
            const chip = document.createElement("button");
            chip.className = "osb-period-chip";
            chip.textContent = item.label;
            // Chip text treatment (TEXT-01) — bold-off falls back to the
            // chip's own pre-existing hardcoded weight 500. Applies to
            // text only; selection fill/border chrome below is untouched.
            this.applyChipFont(chip, s, "500");

            if (sel.has(item.rawValue)) {
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
                    // v2 "selected" ring, NEON edition (Neil live-QA
                    // 2026-07-16: the single 8px glow read flat): layered
                    // outer glow + tight halo + inset tube-light + text
                    // glow + weight 700 (the board's .schip.on bump), plus
                    // a faint accent fill tint for presence. Still no solid
                    // fill. Selected Chip Colour/Text resolve via the fx
                    // pipeline (D-16); Selected Chip Transparency modulates
                    // the whole glow stack's colour-mix intensity. Light
                    // theme runs the stack at reduced strength (board's
                    // --glowmix drop on the light canvas — full neon on a
                    // pale surface reads as smudge, not glow).
                    const chipTransparencyPct = s.chipTransparency.value ?? 0;
                    const glowPct = Math.max(0, 100 - chipTransparencyPct)
                        * (this.resolvedTheme === "dark" ? 1 : 0.55);
                    const mix = (pct: number) =>
                        `color-mix(in srgb, ${this.resolvedChipColorHex} ${Math.round(Math.min(100, pct))}%, transparent)`;
                    const tintPct = Math.round(Math.min(100, glowPct * 0.12));
                    chip.style.background = mix(glowPct * 0.12);
                    // The ring chip's visible surface is that faint accent tint
                    // over the bar's own composited background — the "ring
                    // chips" half of NEXUS cycle-11 §7.
                    chip.style.color = this.legibleChipInk(compositeOver(
                        this.resolvedChipColorHex, 100 - tintPct, this.resolvedRootSurfaceHex));
                    chip.style.borderColor = this.resolvedChipColorHex;
                    chip.style.boxShadow =
                        `0 0 14px ${mix(glowPct)}, ` +
                        `0 0 4px ${mix(glowPct)}, ` +
                        `inset 0 0 8px ${mix(glowPct * 0.35)}`;
                    chip.style.textShadow = `0 0 8px ${mix(glowPct * 0.8)}`;
                    chip.style.fontWeight = "700";
                }
            } else {
                // Unselected chip under an active EXTERNAL cross-filter
                // (another visual narrowed this section): survivors get a
                // neon-lite ring (~40% of the selected glow), filtered-out
                // values ghost to 35% (board's count-badge dim idiom) but
                // stay clickable. Skipped in HC (no-glow rule §8; dimming
                // would hurt contrast) and when no external filter is live.
                const avail = this.externalAvail.get(section.name);
                if (avail && !hc) {
                    if (avail.has(item.rawValue)) {
                        const litePct = 40 * (this.resolvedTheme === "dark" ? 1 : 0.55);
                        const liteMix = `color-mix(in srgb, ${this.resolvedChipColorHex} ${Math.round(litePct)}%, transparent)`;
                        chip.style.borderColor = this.resolvedChipColorHex;
                        // No inline background is set in this branch, so the
                        // neon-lite survivor keeps the stylesheet's own opaque
                        // chip fill (style/visual.less `.osb-period-chip
                        // { background: #f5f4f0 }`) — that, not the accent, is
                        // the surface its ink has to be legible on (§7).
                        chip.style.color = this.legibleChipInk(CHIP_SHEET_FILL_HEX);
                        chip.style.boxShadow = `0 0 8px ${liteMix}`;
                    } else {
                        chip.style.opacity = "0.35";
                    }
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
                this.onChipClick(section, item.rawValue);
            });
            chip.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.onChipClick(section, item.rawValue);
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

    private onChipClick(section: SlicerSection, value: FilterValue): void {
        // A blocked visual must not mutate selection state. Chips can survive a
        // denial that arrives mid-session (NEXUS cycle-11 §1).
        if (this.licenseGate.blocked) return;
        const sel = this.selections.get(section.name) || new Set<FilterValue>();

        if (section.selectionMode === "single") {
            if (sel.has(value) && sel.size === 1) {
                sel.clear();
            } else {
                sel.clear();
                sel.add(value);
            }
        } else {
            if (sel.has(value)) {
                sel.delete(value);
            } else {
                sel.add(value);
            }
        }

        this.selections.set(section.name, sel);
        this.applySectionFilter(section);
        this.renderSlicerBar(this.target.clientWidth);
    }

    /* ─── Dropdown Section ─── */

    private renderDropdownSection(section: SlicerSection, s: any): void {
        const sel = this.selections.get(section.name) || new Set<FilterValue>();
        const count = sel.size;
        const selectedLabel = section.items.find(item => item.rawValue === Array.from(sel)[0])?.label
            ?? String(Array.from(sel)[0] ?? "(Blank)");

        let triggerLabel: string;
        if (section.selectionMode === "single") {
            triggerLabel = count === 1 ? selectedLabel : `Select ${section.name.toLowerCase()}`;
        } else {
            if (count === 0 || count === section.items.length) {
                triggerLabel = `All ${section.name.toLowerCase()}`;
            } else if (count === 1) {
                triggerLabel = selectedLabel;
            } else {
                triggerLabel = `${count} selected`;
            }
        }

        // Build shortLabel text from selected items
        let shortLabelText = "";
        if (count > 0) {
            const selectedItems = section.items.filter(i => sel.has(i.rawValue));
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
                        this.selections.set(section.name, new Set(section.items.map(i => i.rawValue)));
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
        const sel = this.selections.get(section.name) || new Set<FilterValue>();
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
                if (sel.has(item.rawValue)) el.classList.add("selected");
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
                    this.onChipClick(section, item.rawValue);
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
                cb.checked = sel.has(item.rawValue);
                cb.addEventListener("change", (e: Event) => {
                    e.stopPropagation();
                    const currentSel = this.selections.get(section.name) || new Set<FilterValue>();
                    if (cb.checked) {
                        currentSel.add(item.rawValue);
                    } else {
                        currentSel.delete(item.rawValue);
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
        // Backstop for every interaction path into the filter pipeline: a
        // definitively unlicensed visual emits no filter. Belt to onChipClick's
        // braces, because search, clear-all and dropdown items land here too.
        if (this.licenseGate.blocked) return;
        const filters: BasicFilter[] = [...this.externalConstraints];
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
        this.pendingFilterSignature = JSON.stringify(filters);
        try {
            if (filters.length > 0) {
                (this.host as any).applyJsonFilter(filters, "general", "filter", 0 /* merge */);
            } else {
                (this.host as any).applyJsonFilter(null, "general", "filter", 1 /* remove */);
            }
            this.acceptedSelections = new Map([...this.selections].map(([name, values]) => [name, new Set(values)]));
            this.filterError = false;
        } catch {
            this.selections = new Map([...this.acceptedSelections].map(([name, values]) => [name, new Set(values)]));
            this.selfFilterPending = false;
            this.filterError = true;
        }
    }

    // Back-compat shim so existing callers inside this class continue to work.
    private applySectionFilter(_section: SlicerSection): void {
        this.applyAllFilters();
    }

    private readAppliedFilters(options: VisualUpdateOptions): void {
        try {
            const jsonFilters = (options as any).jsonFilters;
            // A licence redraw reuses the last payload; it is not a host restore.
            // An explicitly delivered empty array, even immediately after a click,
            // is a complete reset and must not be swallowed as a self-filter echo.
            if (!Array.isArray(jsonFilters) || jsonFilters === this.lastJsonFilters) return;
            this.lastJsonFilters = jsonFilters;
            // Preserve the UI's all-selected state when its own remove-filter
            // operation is acknowledged. A different payload is a host restore.
            if (this.selfFilterPending && JSON.stringify(jsonFilters) === this.pendingFilterSignature) return;
            this.selections.clear();
            this.externalConstraints = [];
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
                    if (f.filterType === 1 && f.operator === "In" && Array.isArray(f.values)) {
                        this.selections.set(sectionName, new Set(f.values));
                    } else {
                        this.externalConstraints.push(f);
                    }
                }
            }
            this.acceptedSelections = new Map([...this.selections].map(([name, values]) => [name, new Set(values)]));
            this.filterError = false;
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
        //
        // NEXUS cycle-11 §7 (class 1 — ink judged against a surface nobody
        // sees): unlike the v2 ring chip, a SELECTED dropdown item paints the
        // chip colour as a real FILL, so its ink has to be judged against the
        // surface a viewer actually sees — that fill at its own transparency
        // over the panel's background, which is itself the Background card
        // composited over whatever the host theme paints behind it.
        const hostBgHex = this.colorPalette.background?.value || "#ffffff";
        const panelSurfaceHex = compositeOver(outerBgHex, outerBgTransparencyPct, hostBgHex);
        const selectedSurfaceHex = compositeOver(this.resolvedChipColorHex, chipTransparencyPct, panelSurfaceHex);
        // Round 2: the round-1 test here was EXACT equality (ink === fill), and
        // a pair one channel apart walked straight through it — measured
        // rgb(0,217,255) on a #00d8fe fill at 1.009:1, and cyan on the white
        // panel a fully transparent fill reveals at 1.698:1. legibleChipInk()
        // asks the contrast question instead, on this same composited surface,
        // and uses the identical rule the ring chips now use so the two
        // surfaces agree.
        const chipText = hc ? bg : this.legibleChipInk(selectedSurfaceHex);
        // Dropdown panel/trigger/search outlines follow the theme surface
        // token (same source as the count badges) — the old slicerBar
        // borderColor knob is retired; tile framing belongs to the shared
        // Border card alone (Neil live-QA 2026-07-16, duplicate-knob cull).
        const borderClr = hc ? fg : surfaceTokens(this.resolvedTheme).border;
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
        // Drop the in-flight licence check FIRST: its redraw callback replays
        // update() against a torn-down target otherwise (NEXUS lifecycle finding).
        this.licenseGate.dispose();
        this.destroyed = true;
        this.closeAllDropdowns();
        document.removeEventListener("click", this.documentClickHandler);
        this.target.removeEventListener("contextmenu", this.contextMenuHandler);
        if (this.activePanel) {
            this.activePanel.remove();
            this.activePanel = null;
        }
        this.cornerSignature?.destroy();
        this.cornerSignature = null;
        this.lastUpdateOptions = null;
        this.sections = [];
        this.cachedSections = null;
        this.selections.clear();
        this.externalAvail.clear();
        this.acceptedSelections.clear();
        this.externalConstraints = [];
        this.lastJsonFilters = undefined;
        this.sectionDefaults.clear();
        this.target.replaceChildren();
    }
}
