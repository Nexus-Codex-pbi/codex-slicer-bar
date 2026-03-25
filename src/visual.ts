"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IFilter = powerbi.IFilter;

import { VisualFormattingSettingsModel } from "./settings";
import { parseDataView, SlicerData, DatePeriodItem, PageFilterMeta } from "./dataParser";

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
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private data: SlicerData;
    private cachedData: SlicerData | null = null;

    // State
    private selectedDatePeriod: string = "";
    private selectedBeats: Set<string> = new Set();
    private selectedPageFilters: Map<string, Set<string>> = new Map();

    // DOM
    private slicerRow: HTMLElement;

    // Currently open dropdown context
    private openDropdownType: string = "";

    // Skip PBI-triggered re-render after we apply our own filters
    private selfFilterPending: boolean = false;
    private initialised: boolean = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.formattingSettingsService = new FormattingSettingsService();
        this.target = options.element;
        this.target.style.display = "flex";
        this.target.style.flexDirection = "column";
        this.target.style.justifyContent = "center";
        this.target.style.height = "100%";
        this.data = { datePeriods: [], beats: [], pageFilters: [] };

        this.slicerRow = document.createElement("div");
        this.slicerRow.className = "osb-slicer-row";

        this.target.appendChild(this.slicerRow);

        // Close dropdown on outside click
        document.addEventListener("click", (e: MouseEvent) => {
            if (!(e.target as HTMLElement)?.closest(".osb-slicer-group")) {
                this.closeAllDropdowns();
            }
        });
    }

    public update(options: VisualUpdateOptions): void {
        if (!options?.dataViews?.[0]) return;

        const dv = options.dataViews[0];
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel, dv
        );

        const parsed = parseDataView(dv);

        // Cache the fullest data — filtered updates return fewer rows
        if (!this.cachedData || parsed.datePeriods.length + parsed.beats.length + parsed.pageFilters.length
            >= this.cachedData.datePeriods.length + this.cachedData.beats.length + this.cachedData.pageFilters.length) {
            this.cachedData = parsed;
        }
        this.data = this.cachedData;

        // Only read filters from PBI when it's not our own filter triggering the update
        if (this.selfFilterPending) {
            this.selfFilterPending = false;
        } else if (!this.initialised) {
            // First load or page navigation: restore persisted filters
            this.readAppliedFilters(options);
            this.initialised = true;
        }

        this.renderSlicerBar(options.viewport.width);
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    /* ═══════════════════════════════════════
     * SLICER BAR RENDER
     * ═══════════════════════════════════════ */

    private renderSlicerBar(viewportWidth: number): void {
        const s = this.formattingSettings.slicerBarCard;
        const maxSlicers = s.maxVisibleSlicers.value || 10;
        let slicerCount = 0;

        this.slicerRow.innerHTML = "";
        this.slicerRow.classList.remove("has-active-group");
        this.slicerRow.style.background = s.backgroundColor.value.value;
        this.slicerRow.style.width = viewportWidth + "px";

        // Center by default, right-justify when fan direction is left
        const dir = s.fanDirection.value.value || "auto";
        this.slicerRow.style.justifyContent = dir === "left" ? "flex-end" : "";

        // Date Period Section (counts as 1 slicer group)
        if (this.data.datePeriods.length > 0 && slicerCount < maxSlicers) {
            slicerCount++;
            const periodLabel = document.createElement("span");
            periodLabel.className = "osb-slicer-label";
            periodLabel.textContent = "PERIOD:";
            periodLabel.style.color = s.labelColor.value.value;
            periodLabel.style.fontSize = s.labelFontSize.value + "px";
            this.slicerRow.appendChild(periodLabel);

            const isButtons = s.datePeriodStyle.value.value === "buttons";
            if (isButtons) {
                this.renderDatePeriodChips(s);
            } else {
                this.renderDatePeriodDropdownTrigger(s);
            }
        }

        // Beat Dropdown (counts as 1 slicer group)
        if (this.data.beats.length > 0 && slicerCount < maxSlicers) {
            slicerCount++;
            if (slicerCount > 1) {
                const sep = document.createElement("span");
                sep.className = "osb-slicer-sep";
                this.slicerRow.appendChild(sep);
            }
            const beatLabel = document.createElement("span");
            beatLabel.className = "osb-slicer-label";
            beatLabel.textContent = "BEAT:";
            beatLabel.style.color = s.labelColor.value.value;
            beatLabel.style.fontSize = s.labelFontSize.value + "px";
            this.slicerRow.appendChild(beatLabel);
            this.renderBeatDropdownGroup(s);
        }

        // Page Filters (each counts as 1 slicer group)
        for (const pf of this.data.pageFilters) {
            if (slicerCount >= maxSlicers) break;
            slicerCount++;
            const sep = document.createElement("span");
            sep.className = "osb-slicer-sep";
            this.slicerRow.appendChild(sep);
            const filterLabel = document.createElement("span");
            filterLabel.className = "osb-slicer-label";
            filterLabel.textContent = pf.label.toUpperCase() + ":";
            filterLabel.style.color = s.labelColor.value.value;
            filterLabel.style.fontSize = s.labelFontSize.value + "px";
            this.slicerRow.appendChild(filterLabel);
            this.renderPageFilterGroup(pf, s);
        }
    }

    /* ─── Date Period Chips ─── */

    private renderDatePeriodChips(s: any): void {
        const maxVisible = s.maxVisiblePeriods.value || 8;
        const visible = this.data.datePeriods.slice(0, maxVisible);
        const overflow = this.data.datePeriods.slice(maxVisible);

        for (const dp of visible) {
            const chip = document.createElement("button");
            chip.className = "osb-period-chip";
            chip.textContent = dp.type;

            const isSelected = this.selectedDatePeriod === dp.type;
            if (isSelected) {
                chip.classList.add("selected");
                chip.style.background = s.chipColor.value.value;
                chip.style.color = s.chipTextColor.value.value;
                chip.style.borderColor = s.chipColor.value.value;
            }

            chip.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.onDatePeriodClick(dp.type);
            });

            chip.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.onDatePeriodClick(dp.type);
                }
            });

            this.slicerRow.appendChild(chip);
        }

        if (overflow.length > 0) {
            const group = this.createDropdownGroup(
                `+${overflow.length} more`,
                "period-overflow",
                (panel: HTMLElement) => this.buildPeriodDropdownItems(panel, overflow)
            );
            this.slicerRow.appendChild(group);
        }
    }

    private renderDatePeriodDropdownTrigger(s: any): void {
        const group = this.createDropdownGroup(
            this.selectedDatePeriod || "Select period",
            "period",
            (panel: HTMLElement) => this.buildPeriodDropdownItems(panel, this.data.datePeriods)
        );
        this.slicerRow.appendChild(group);
    }

    private buildPeriodDropdownItems(panel: HTMLElement, items: DatePeriodItem[]): void {
        const container = document.createElement("div");
        container.className = "osb-panel-items";
        for (const dp of items) {
            const item = document.createElement("div");
            item.className = "osb-dropdown-item";
            if (this.selectedDatePeriod === dp.type) item.classList.add("selected");
            item.textContent = dp.type;
            item.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.onDatePeriodClick(dp.type);
                this.closeAllDropdowns();
            });
            container.appendChild(item);
        }
        panel.appendChild(container);
    }

    private onDatePeriodClick(periodType: string): void {
        if (this.selectedDatePeriod === periodType) {
            this.selectedDatePeriod = "";
            this.applyFilter(null, "datePeriod");
        } else {
            this.selectedDatePeriod = periodType;
            this.applyFilter({
                $schema: BASIC_FILTER_SCHEMA,
                target: { table: "Date Periods", column: "Type" },
                operator: "In",
                values: [periodType],
                filterType: 1,
            }, "datePeriod");
        }
        this.renderSlicerBar(this.target.clientWidth);
    }

    /* ─── Beat Dropdown ─── */

    private renderBeatDropdownGroup(s: any): void {
        const count = this.selectedBeats.size;
        const label = (count === 0 || count === this.data.beats.length)
            ? "All beats" : `${count} selected`;

        const group = this.createDropdownGroup(label, "beat", (panel: HTMLElement) => {
            // Search box if > 10 items
            if (this.data.beats.length > 10) {
                const searchInput = document.createElement("input");
                searchInput.className = "osb-panel-search";
                searchInput.type = "text";
                searchInput.placeholder = "Search...";
                searchInput.addEventListener("click", (e) => e.stopPropagation());
                searchInput.addEventListener("input", () => {
                    this.renderBeatItems(itemsContainer, searchInput.value);
                });
                panel.appendChild(searchInput);
            }

            // Select all / Clear
            const actions = document.createElement("div");
            actions.className = "osb-panel-actions";

            const selectAll = document.createElement("button");
            selectAll.className = "osb-panel-action-btn";
            selectAll.textContent = "Select all";
            selectAll.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.data.beats.forEach(b => this.selectedBeats.add(b));
                this.applyBeatFilter();
                this.closeAllDropdowns();
                this.renderSlicerBar(this.target.clientWidth);

            });

            const clearAll = document.createElement("button");
            clearAll.className = "osb-panel-action-btn";
            clearAll.textContent = "Clear";
            clearAll.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.selectedBeats.clear();
                this.applyBeatFilter();
                this.closeAllDropdowns();
                this.renderSlicerBar(this.target.clientWidth);

            });

            actions.appendChild(selectAll);
            actions.appendChild(clearAll);
            panel.appendChild(actions);

            const itemsContainer = document.createElement("div");
            itemsContainer.className = "osb-panel-items";
            this.renderBeatItems(itemsContainer, "");
            panel.appendChild(itemsContainer);
        });
        this.slicerRow.appendChild(group);
    }

    private renderBeatItems(container: HTMLElement, filter: string): void {
        container.innerHTML = "";
        const filtered = filter
            ? this.data.beats.filter(b => b.toLowerCase().includes(filter.toLowerCase()))
            : this.data.beats;

        for (const beat of filtered) {
            const item = document.createElement("label");
            item.className = "osb-dropdown-item osb-checkbox-item";

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = this.selectedBeats.has(beat);
            cb.addEventListener("change", (e: Event) => {
                e.stopPropagation();
                if (cb.checked) {
                    this.selectedBeats.add(beat);
                } else {
                    this.selectedBeats.delete(beat);
                }
                this.applyBeatFilter();
                this.renderSlicerBar(this.target.clientWidth);

            });

            const span = document.createElement("span");
            span.textContent = beat;

            item.appendChild(cb);
            item.appendChild(span);
            item.addEventListener("click", (e) => e.stopPropagation());
            container.appendChild(item);
        }
    }

    private applyBeatFilter(): void {
        if (this.selectedBeats.size === 0 || this.selectedBeats.size === this.data.beats.length) {
            this.applyFilter(null, "beat");
        } else {
            this.applyFilter({
                $schema: BASIC_FILTER_SCHEMA,
                target: { table: "DimBeat", column: "Beat" },
                operator: "In",
                values: Array.from(this.selectedBeats),
                filterType: 1,
            }, "beat");
        }
    }

    /* ─── Page Filter Dropdowns ─── */

    private renderPageFilterGroup(pf: PageFilterMeta, s: any): void {
        const sel = this.selectedPageFilters.get(pf.column);
        const count = sel ? sel.size : 0;

        let label: string;
        if (count === 0 || count === pf.values.length) {
            label = `All ${pf.label}`;
        } else if (count === 1) {
            label = Array.from(sel!)[0];
        } else {
            label = `${count} ${pf.label}`;
        }

        const group = this.createDropdownGroup(label, `filter_${pf.column}`, (panel: HTMLElement) => {
            const currentSel = this.selectedPageFilters.get(pf.column) || new Set<string>();

            // Search if > 10 items
            if (pf.values.length > 10) {
                const searchInput = document.createElement("input");
                searchInput.className = "osb-panel-search";
                searchInput.type = "text";
                searchInput.placeholder = "Search...";
                searchInput.addEventListener("click", (e) => e.stopPropagation());
                searchInput.addEventListener("input", () => {
                    this.renderFilterItems(itemsContainer, pf, currentSel, searchInput.value);
                });
                panel.appendChild(searchInput);
            }

            const itemsContainer = document.createElement("div");
            itemsContainer.className = "osb-panel-items";
            this.renderFilterItems(itemsContainer, pf, currentSel, "");
            panel.appendChild(itemsContainer);
        });
        this.slicerRow.appendChild(group);
    }

    private renderFilterItems(container: HTMLElement, pf: PageFilterMeta, sel: Set<string>, filter: string): void {
        container.innerHTML = "";
        const filtered = filter
            ? pf.values.filter(v => v.toLowerCase().includes(filter.toLowerCase()))
            : pf.values;

        for (const val of filtered) {
            const item = document.createElement("label");
            item.className = "osb-dropdown-item osb-checkbox-item";

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = sel.has(val);
            cb.addEventListener("change", (e: Event) => {
                e.stopPropagation();
                if (cb.checked) {
                    sel.add(val);
                } else {
                    sel.delete(val);
                }
                this.selectedPageFilters.set(pf.column, sel);
                this.applyPageFilter(pf, sel);
                this.renderSlicerBar(this.target.clientWidth);

            });

            const span = document.createElement("span");
            span.textContent = val;

            item.appendChild(cb);
            item.appendChild(span);
            item.addEventListener("click", (e) => e.stopPropagation());
            container.appendChild(item);
        }
    }

    private applyPageFilter(pf: PageFilterMeta, sel: Set<string>): void {
        if (sel.size === 0 || sel.size === pf.values.length) {
            this.applyFilter(null, `pageFilter_${pf.column}`);
        } else {
            this.applyFilter({
                $schema: BASIC_FILTER_SCHEMA,
                target: { table: pf.table, column: pf.column },
                operator: "In",
                values: Array.from(sel),
                filterType: 1,
            }, `pageFilter_${pf.column}`);
        }
    }

    /* ═══════════════════════════════════════
     * DROPDOWN GROUP FACTORY + MANAGEMENT
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

        const panel = document.createElement("div");
        panel.className = "osb-dropdown-panel";

        trigger.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (this.openDropdownType === id) {
                this.closeAllDropdowns();
                return;
            }
            this.closeAllDropdowns();
            this.openDropdownType = id;
            trigger.classList.add("open");

            const dir = this.formattingSettings.slicerBarCard.fanDirection.value.value || "auto";

            // Hide other slicers and shift group for auto/right modes
            this.slicerRow.classList.add("has-active-group");
            group.classList.add("active-group");

            if (dir === "auto" || dir === "right") {
                // Shift group to left edge for maximum right-fan space
                const rowRect = this.slicerRow.getBoundingClientRect();
                const groupRect = group.getBoundingClientRect();
                const shiftX = groupRect.left - rowRect.left - 12;
                if (shiftX > 0) {
                    group.style.position = "relative";
                    group.style.left = `-${shiftX}px`;
                    group.style.zIndex = "1001";
                }
            } else if (dir === "left") {
                // Shift group to right edge for maximum left-fan space
                const rowRect = this.slicerRow.getBoundingClientRect();
                const groupRect = group.getBoundingClientRect();
                const shiftX = (rowRect.right - 12) - groupRect.right;
                if (shiftX > 0) {
                    group.style.position = "relative";
                    group.style.left = `${shiftX}px`;
                    group.style.zIndex = "1001";
                }
            }

            panel.innerHTML = "";
            buildItems(panel);
            this.applyPanelColors(panel, trigger);

            panel.classList.remove("flip-left");
            if (dir === "left") {
                panel.classList.add("flip-left");
            }
            panel.classList.add("open");

            // Auto: safety check for overflow
            if (dir === "auto") {
                const panelRect = panel.getBoundingClientRect();
                if (panelRect.right > window.innerWidth - 8) {
                    panel.classList.add("flip-left");
                }
            }
        });

        group.appendChild(trigger);
        group.appendChild(panel);
        return group;
    }

    private closeAllDropdowns(): void {
        this.target.querySelectorAll(".osb-dropdown-panel.open").forEach(
            (p) => p.classList.remove("open")
        );
        this.target.querySelectorAll(".osb-dropdown-trigger.open").forEach(
            (t) => t.classList.remove("open")
        );
        // Reset shifted groups and restore visibility
        this.slicerRow.classList.remove("has-active-group");
        this.target.querySelectorAll(".osb-slicer-group").forEach((g: HTMLElement) => {
            g.classList.remove("active-group");
            g.style.position = "";
            g.style.left = "";
            g.style.zIndex = "";
        });
        this.openDropdownType = "";
    }

    /* ═══════════════════════════════════════
     * FAN-OUT COLOUR APPLICATION
     * ═══════════════════════════════════════ */

    private applyPanelColors(panel: HTMLElement, trigger: HTMLElement): void {
        const s = this.formattingSettings.slicerBarCard;
        const chipBg = s.chipColor.value.value;       // selected background
        const chipText = s.chipTextColor.value.value;  // selected text
        const borderClr = s.borderColor.value.value;   // borders
        const bgClr = s.backgroundColor.value.value;   // panel background
        const labelClr = s.labelColor.value.value;     // default item text

        // Panel itself
        panel.style.background = bgClr;
        panel.style.borderColor = borderClr;

        // Trigger button
        trigger.style.borderColor = borderClr;
        trigger.style.background = bgClr;
        trigger.style.color = labelClr;

        // Action buttons (Select all / Clear)
        panel.querySelectorAll(".osb-panel-action-btn").forEach((btn: HTMLElement) => {
            btn.style.color = chipBg;
        });

        // Search input
        panel.querySelectorAll(".osb-panel-search").forEach((inp: HTMLElement) => {
            inp.style.borderColor = borderClr;
        });

        // Each dropdown item
        panel.querySelectorAll(".osb-dropdown-item").forEach((item: HTMLElement) => {
            const isSelected = item.classList.contains("selected");
            if (isSelected) {
                item.style.background = chipBg;
                item.style.color = chipText;
                item.style.borderColor = chipBg;
            } else {
                item.style.background = "#ffffff";
                item.style.color = "#1a1a1a";
                item.style.borderColor = borderClr;
            }

            // Hover/unhover for non-selected items
            item.addEventListener("mouseenter", () => {
                if (!item.classList.contains("selected")) {
                    item.style.borderColor = chipBg;
                    item.style.color = chipBg;
                    item.style.background = bgClr === "#ffffff" ? "#f0eef8" : bgClr;
                }
            });
            item.addEventListener("mouseleave", () => {
                if (!item.classList.contains("selected")) {
                    item.style.borderColor = borderClr;
                    item.style.color = "#1a1a1a";
                    item.style.background = "#ffffff";
                }
            });
        });
    }

    /* ═══════════════════════════════════════
     * FILTER APPLICATION
     * ═══════════════════════════════════════ */

    private applyFilter(filter: BasicFilter | null, action: string): void {
        this.selfFilterPending = true;
        try {
            if (filter) {
                (this.host as any).applyJsonFilter(filter, "general", "filter", 0 /* merge */);
            } else {
                // Build a dummy filter for the target to remove it
                const targetMap: Record<string, { table: string; column: string }> = {
                    datePeriod: { table: "Date Periods", column: "Type" },
                    beat: { table: "DimBeat", column: "Beat" },
                };
                if (action.startsWith("pageFilter_")) {
                    const col = action.replace("pageFilter_", "");
                    const pf = this.data.pageFilters.find(p => p.column === col);
                    if (pf) targetMap[action] = { table: pf.table, column: pf.column };
                }
                const target = targetMap[action];
                if (target) {
                    const removeFilter: BasicFilter = {
                        $schema: BASIC_FILTER_SCHEMA,
                        target,
                        operator: "In",
                        values: [],
                        filterType: 1,
                    };
                    (this.host as any).applyJsonFilter(removeFilter, "general", "filter", 1 /* remove */);
                } else {
                    (this.host as any).applyJsonFilter(null, "general", "filter", 1 /* remove */);
                }
            }
        } catch (err) {
            console.warn(`SlicerBar: filter apply failed (${action})`, err);
        }
    }

    private readAppliedFilters(options: VisualUpdateOptions): void {
        try {
            const jsonFilters = (options as any).jsonFilters || [];
            let foundDatePeriod = false;
            let foundBeat = false;

            for (const f of jsonFilters) {
                if (!f?.target) continue;
                const tbl = f.target.table || "";
                const col = f.target.column || "";

                if (tbl === "Date Periods" && col === "Type") {
                    this.selectedDatePeriod = f.values?.[0] || "";
                    foundDatePeriod = true;
                } else if (tbl === "DimBeat" && col === "Beat") {
                    this.selectedBeats = new Set(f.values || []);
                    foundBeat = true;
                } else {
                    this.selectedPageFilters.set(col, new Set(f.values || []));
                }
            }

            if (!foundDatePeriod) this.selectedDatePeriod = "";
            if (!foundBeat) this.selectedBeats = new Set();
        } catch {
            // Ignore filter read errors
        }
    }


    public destroy(): void {
        this.closeAllDropdowns();
    }
}
