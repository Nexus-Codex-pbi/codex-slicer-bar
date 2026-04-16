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

import { VisualFormattingSettingsModel } from "./settings";
import { parseDataView, SlicerSection, SlicerItem } from "./dataParser";

// eslint-disable-next-line powerbi-visuals/no-http-string
const BASIC_FILTER_SCHEMA = "http://powerbi.com/product/schema#basic";

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

            const parsed = parseDataView(dv);

            // Cache the fullest data — filtered updates return fewer rows
            const parsedCount = parsed.reduce((sum, s) => sum + s.items.length, 0);
            const cachedCount = this.cachedSections
                ? this.cachedSections.reduce((sum, s) => sum + s.items.length, 0)
                : 0;
            if (!this.cachedSections || parsedCount >= cachedCount) {
                this.cachedSections = parsed;
            }
            this.sections = this.cachedSections;

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
                    for (const section of this.sections) {
                        if (!section.defaultValue) continue;
                        const sel = this.selections.get(section.name);
                        if (sel && sel.size > 0) continue;
                        const match = section.items.find(
                            item => item.label.toLowerCase() === section.defaultValue.toLowerCase()
                        );
                        if (match) {
                            this.selections.set(section.name, new Set([match.label]));
                            // Apply filter if section has a filter target
                            if (section.filterTarget) {
                                this.applyFilter({
                                    $schema: BASIC_FILTER_SCHEMA,
                                    target: section.filterTarget,
                                    operator: "In",
                                    values: [match.label],
                                    filterType: 1,
                                }, `section_${section.name}`);
                            }
                        }
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

        while (this.slicerRow.firstChild) { this.slicerRow.removeChild(this.slicerRow.firstChild); }
        this.slicerRow.style.background = hc ? bg : s.backgroundColor.value.value;
        this.slicerRow.style.width = viewportWidth + "px";

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
            this.slicerRow.appendChild(label);

            if (!section.interactive) {
                this.renderStaticSection(section, s);
            } else if (section.displayMode === "dropdown") {
                this.renderDropdownSection(section, s);
            } else {
                this.renderChipsSection(section, s);
            }
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

            if (sel.has(item.label)) {
                chip.classList.add("selected");
                chip.style.background = hc ? fgSelected : s.chipColor.value.value;
                chip.style.color = hc ? bg : s.chipTextColor.value.value;
                chip.style.borderColor = hc ? fgSelected : s.chipColor.value.value;
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

        if (section.selectionMode === "single") {
            for (const item of renderItems) {
                const el = document.createElement("div");
                el.className = "osb-dropdown-item";
                if (sel.has(item.label)) el.classList.add("selected");
                el.textContent = item.label;
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

    private applySectionFilter(section: SlicerSection): void {
        if (!section.filterTarget) {
            return;
        }
        const sel = this.selections.get(section.name) || new Set<string>();

        if (sel.size === 0 || sel.size === section.items.length) {
            this.applyFilter(null, `section_${section.name}`);
        } else {
            this.applyFilter({
                $schema: BASIC_FILTER_SCHEMA,
                target: section.filterTarget,
                operator: "In",
                values: Array.from(sel),
                filterType: 1,
            }, `section_${section.name}`);
        }
    }

    private applyFilter(filter: BasicFilter | null, action: string): void {
        this.selfFilterPending = true;
        try {
            if (filter) {
                (this.host as any).applyJsonFilter(filter, "general", "filter", 0 /* merge */);
            } else {
                const sectionName = action.replace("section_", "");
                const section = this.sections.find(s => s.name === sectionName);
                if (section?.filterTarget) {
                    const removeFilter: BasicFilter = {
                        $schema: BASIC_FILTER_SCHEMA,
                        target: section.filterTarget,
                        operator: "In",
                        values: [],
                        filterType: 1,
                    };
                    (this.host as any).applyJsonFilter(removeFilter, "general", "filter", 1 /* remove */);
                } else {
                    (this.host as any).applyJsonFilter(null, "general", "filter", 1 /* remove */);
                }
            }
        } catch {
            // Filter apply failed — ignore silently
        }
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

        const chipBg = hc ? fg : s.chipColor.value.value;
        const chipText = hc ? bg : s.chipTextColor.value.value;
        const borderClr = hc ? fg : s.borderColor.value.value;
        const bgClr = hc ? bg : s.backgroundColor.value.value;
        const labelClr = hc ? fg : s.labelColor.value.value;
        const itemBg = hc ? bg : "#ffffff";
        const itemText = hc ? fg : "#1a1a1a";
        const hoverBg = hc ? bg : (s.backgroundColor.value.value === "#ffffff" ? "#f0eef8" : s.backgroundColor.value.value);

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
                item.style.background = hc ? fgSelected : chipBg;
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

    public destroy(): void {
        this.closeAllDropdowns();
        document.removeEventListener("click", this.documentClickHandler);
        if (this.activePanel) {
            this.activePanel.remove();
            this.activePanel = null;
        }
    }
}
