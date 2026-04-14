"use strict";

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

/* ─── Interfaces ─── */

export interface SlicerItem {
    label: string;
    value: string;
    shortLabel: string;
    sort: number;
}

export interface SlicerSection {
    /** Category name from the bridge table — used as section identifier */
    name: string;
    /** "chips" or "dropdown" — from data column or formatting fallback */
    displayMode: string;
    /** "single" or "multi" — from data column or formatting fallback */
    selectionMode: string;
    /** Whether this section applies filters (false = static display) */
    interactive: boolean;
    /** Filter target: { table, column } parsed from Value field (Table.Column format) */
    filterTarget: { table: string; column: string } | null;
    /** Default selected value (from data or formatting) */
    defaultValue: string;
    /** Section-level sort order (minimum sortOrder of items) */
    sectionSort: number;
    /** Items in this section, sorted by sortOrder */
    items: SlicerItem[];
}

/* ─── Bridge Table Row ─── */

interface BridgeRow {
    category: string;
    label: string;
    value: string;
    shortLabel: string;
    defaultValue: string;
    sortOrder: number;
    displayMode: string;
    selectionMode: string;
}

/* ─── Parser ─── */

/**
 * Parse the slicer config bridge table into generic sections.
 * Each row: Category, Label, Value, SortOrder, DisplayMode (optional), SelectionMode (optional)
 *
 * - Rows are grouped by distinct Category values
 * - DisplayMode: "chips" or "dropdown" (default: "chips" for ≤8 items, "dropdown" otherwise)
 * - SelectionMode: "single" or "multi" (default: "single")
 * - Value field encodes filter target as "Table.Column" — if empty, section is non-interactive (static)
 */
export function parseDataView(dataView: DataView): SlicerSection[] {
    if (!dataView?.categorical) return [];

    const cat = dataView.categorical;
    const categories = cat.categories || [];
    const values = cat.values || [];

    const roleToCatIdx: Record<string, number> = {};
    categories.forEach((c, i) => {
        const roles = c.source.roles || {};
        for (const role of Object.keys(roles)) {
            if (roles[role]) roleToCatIdx[role] = i;
        }
    });

    const roleToValIdx: Record<string, number> = {};
    values.forEach((v, i) => {
        const roles = v.source.roles || {};
        for (const role of Object.keys(roles)) {
            if (roles[role]) roleToValIdx[role] = i;
        }
    });

    const catIdx = roleToCatIdx["category"];
    const labelIdx = roleToCatIdx["label"];
    const valueIdx = roleToCatIdx["value"];
    const shortLabelIdx = roleToCatIdx["shortLabel"];
    const defaultValueIdx = roleToCatIdx["defaultValue"];
    const displayModeIdx = roleToCatIdx["displayMode"];
    const selectionModeIdx = roleToCatIdx["selectionMode"];
    const sortIdx = roleToValIdx["sortOrder"];

    if (catIdx === undefined || labelIdx === undefined) return [];

    const rowCount = categories[0]?.values?.length ?? 0;

    const rows: BridgeRow[] = [];
    for (let r = 0; r < rowCount; r++) {
        rows.push({
            category: String(categories[catIdx].values[r] || ""),
            label: String(categories[labelIdx].values[r] || ""),
            value: valueIdx !== undefined ? String(categories[valueIdx].values[r] || "") : "",
            shortLabel: shortLabelIdx !== undefined ? String(categories[shortLabelIdx].values[r] || "") : "",
            defaultValue: defaultValueIdx !== undefined ? String(categories[defaultValueIdx].values[r] || "") : "",
            sortOrder: sortIdx !== undefined ? Number(values[sortIdx].values[r]) || 0 : 0,
            displayMode: displayModeIdx !== undefined ? String(categories[displayModeIdx].values[r] || "").toLowerCase() : "",
            selectionMode: selectionModeIdx !== undefined ? String(categories[selectionModeIdx].values[r] || "").toLowerCase() : "",
        });
    }

    // Group rows by category
    const grouped = new Map<string, BridgeRow[]>();
    const categoryOrder: string[] = [];
    for (const row of rows) {
        if (!row.category) continue;
        if (!grouped.has(row.category)) {
            grouped.set(row.category, []);
            categoryOrder.push(row.category);
        }
        grouped.get(row.category)!.push(row);
    }

    // Build sections in category order
    const sections: SlicerSection[] = [];
    for (const name of categoryOrder) {
        const groupRows = grouped.get(name)!;

        // Deduplicate items by label
        const seen = new Set<string>();
        const items: SlicerItem[] = [];
        for (const row of groupRows) {
            if (!row.label || seen.has(row.label)) continue;
            seen.add(row.label);
            items.push({ label: row.label, value: row.value, shortLabel: row.shortLabel, sort: row.sortOrder });
        }
        items.sort((a, b) => a.sort - b.sort);

        if (items.length === 0) continue;

        // Take config from first row (all rows in a category should share the same config)
        const firstRow = groupRows[0];

        // Section-level sort: minimum sortOrder of all items in this section
        const sectionSort = Math.min(...groupRows.map(r => r.sortOrder));

        // Parse filter target from Value field (Table.Column format)
        let filterTarget: { table: string; column: string } | null = null;
        const firstValue = firstRow.value || "";
        if (firstValue.includes(".")) {
            const dotIdx = firstValue.indexOf(".");
            filterTarget = {
                table: firstValue.substring(0, dotIdx),
                column: firstValue.substring(dotIdx + 1),
            };
        }

        // Determine interactive state — if no filter target, it's static display
        const interactive = filterTarget !== null;

        // Display mode: data column > smart default (≤8 items = chips, else dropdown)
        const dataDisplayMode = firstRow.displayMode;
        const displayMode = (dataDisplayMode === "chips" || dataDisplayMode === "dropdown")
            ? dataDisplayMode
            : (items.length <= 8 ? "chips" : "dropdown");

        // Selection mode: data column > default single
        const dataSelectionMode = firstRow.selectionMode;
        const selectionMode = (dataSelectionMode === "single" || dataSelectionMode === "multi")
            ? dataSelectionMode
            : "single";

        // Default value: first non-empty defaultValue from any row in this section
        const defaultValue = groupRows.find(r => r.defaultValue)?.defaultValue || "";

        sections.push({
            name,
            displayMode,
            selectionMode,
            interactive,
            filterTarget,
            defaultValue,
            sectionSort,
            items,
        });
    }

    // Sort sections by their minimum sortOrder
    sections.sort((a, b) => a.sectionSort - b.sectionSort);

    return sections;
}
