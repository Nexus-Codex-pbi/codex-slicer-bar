"use strict";

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import { formatModelNumber } from "./shared/numberFormat";

/* ─── Interfaces ─── */

export type FilterValue = string | number | boolean | null;

export interface SlicerItem {
    label: string;
    rawValue: FilterValue;
    value: string;
    shortLabel: string;
    sort: number;
}

export interface SlicerSection {
    /** Category name from the bridge table — used as section identifier */
    name: string;
    /** "chips" or "dropdown" — from data column or formatting fallback */
    displayMode: string;
    displayModeFromData: boolean;
    /** "single" or "multi" — from data column or formatting fallback */
    selectionMode: string;
    selectionModeFromData: boolean;
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
    rawValue: FilterValue;
    value: string;
    shortLabel: string;
    defaultValue: string;
    sortOrder: number;
    displayMode: string;
    selectionMode: string;
}

/* ─── Filter target extraction ─── */

/**
 * Derive { table, column } from a bound category column's source.expr —
 * a faithful mirror of Microsoft's extractFilterColumnTarget
 * (powerbi-visuals-utils-interactivityutils/src/interactivityFilterService.ts),
 * vendored rather than imported to keep the cert-audited bundle lean.
 * Detection is structural (shape of expr), not SQExprKind numerics, so it
 * carries no dependency on powerbi-models enum values:
 *  - plain column:      expr.source.entity + expr.ref
 *  - hierarchy level:   column = expr.level; table = the LAST identityExpr's
 *    source.entity when present (date hierarchies live in a virtual
 *    'LocalDateTable_<guid>' — the only correct filter target), else the
 *    hierarchy's own entity at expr.arg.arg.entity.
 * Returns null when no shape matches; callers fall back to queryName.
 */
function extractColumnTarget(
    categoryColumn: powerbi.DataViewCategoryColumn
): { table: string; column: string } | null {
    const col = categoryColumn as any;
    const expr = col?.source?.expr ?? col?.expr;
    if (!expr) return null;

    // Hierarchy level (incl. auto date hierarchy): column name is the level.
    if (typeof expr.level === "string" && expr.level) {
        let table: string | null = null;
        const idExprs = col.identityExprs;
        if (Array.isArray(idExprs) && idExprs.length) {
            table = idExprs[idExprs.length - 1]?.source?.entity ?? null;
        }
        if (!table) table = expr.arg?.arg?.entity ?? null;
        return table ? { table, column: expr.level } : null;
    }

    // Plain column reference.
    if (typeof expr.ref === "string" && expr.ref && expr.source?.entity) {
        return { table: expr.source.entity, column: expr.ref };
    }
    return null;
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
export function parseDataView(dataView: DataView, locale?: string): SlicerSection[] {
    if (!dataView?.categorical) return [];

    const cat = dataView.categorical;
    const categories = cat.categories || [];

    const roleToCatIdx: Record<string, number> = {};
    categories.forEach((c, i) => {
        const roles = c.source.roles || {};
        for (const role of Object.keys(roles)) {
            if (roles[role]) roleToCatIdx[role] = i;
        }
    });

    const catIdx = roleToCatIdx["category"];
    const labelIdx = roleToCatIdx["label"];
    const valueIdx = roleToCatIdx["value"];
    const shortLabelIdx = roleToCatIdx["shortLabel"];
    const defaultValueIdx = roleToCatIdx["defaultValue"];
    const displayModeIdx = roleToCatIdx["displayMode"];
    const selectionModeIdx = roleToCatIdx["selectionMode"];
    const sortIdx = roleToCatIdx["sortOrder"];
    const sortColumn = sortIdx !== undefined ? categories[sortIdx]
        : cat.values?.find(column => column.source.roles?.sortOrder);

    // Single-field simple mode (Neil live-QA 2026-07-16): when only ONE of
    // Category/Label is bound, that column supplies the item labels and the
    // visual renders a single section named after the column. Previously BOTH
    // were hard-required and the visual silently rendered nothing — which is
    // also the default cert-reviewer experience, since dragging one field onto
    // the visual lands it in Category (the first well). Bridge mode (both
    // bound) is unchanged.
    const effLabelIdx = labelIdx !== undefined ? labelIdx : catIdx;
    if (effLabelIdx === undefined) return [];
    const singleSectionName: string | null = (catIdx === undefined || labelIdx === undefined)
        ? (categories[effLabelIdx].source.displayName || "Filter")
        : null;

    const rowCount = categories[effLabelIdx]?.values?.length ?? 0;

    const rows: BridgeRow[] = [];
    for (let r = 0; r < rowCount; r++) {
        const raw = categories[effLabelIdx].values[r];
        const rawValue: FilterValue = raw instanceof Date ? raw.toISOString() : raw ?? null;
        const label = raw === null || raw === undefined ? "(Blank)"
            : raw === "" ? "(Empty)"
            : raw instanceof Date ? raw.toLocaleDateString(locale)
            : typeof raw === "number" ? formatModelNumber(raw, categories[effLabelIdx].source.format, locale)
            : String(raw);
        rows.push({
            category: singleSectionName ?? String(categories[catIdx].values[r] ?? "(Blank)"),
            label,
            rawValue,
            value: valueIdx !== undefined ? String(categories[valueIdx].values[r] ?? "") : "",
            shortLabel: shortLabelIdx !== undefined ? String(categories[shortLabelIdx].values[r] ?? "") : "",
            defaultValue: defaultValueIdx !== undefined ? String(categories[defaultValueIdx].values[r] ?? "") : "",
            sortOrder: sortColumn ? Number(sortColumn.values[r]) || 0 : 0,
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

        // Display strings are not identities: 0 and "0" must remain distinct.
        const seen = new Set<string>();
        const items: SlicerItem[] = [];
        for (const row of groupRows) {
            const key = JSON.stringify(row.rawValue);
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({ label: row.label, rawValue: row.rawValue, value: row.value, shortLabel: row.shortLabel, sort: row.sortOrder });
        }
        items.sort((a, b) => a.sort - b.sort);

        if (items.length === 0) continue;

        // Take config from first row (all rows in a category should share the same config)
        const firstRow = groupRows[0];

        // Section-level sort: minimum sortOrder of all items in this section
        const sectionSort = Math.min(...groupRows.map(r => r.sortOrder));

        // Resolve filter target — the bound field IS the link (1180.2.2.3,
        // fourth finding 2026-08-13). Priority order:
        //   1. Bridge-table mode: explicit "Table.Column" string in the Value
        //      data column. Kept as an OVERRIDE for multi-section composite
        //      slicers where one bridge feeds N different filter targets.
        //   2. DEFAULT — structural extraction from the bound column's
        //      source.expr, mirroring Microsoft's own
        //      extractFilterColumnTarget (utils-interactivityutils). This is
        //      what makes a bare "drag one column in" filter outwards with no
        //      configuration: entity+ref for plain columns, and for hierarchy
        //      levels the COLUMN is expr.level while the TABLE must come from
        //      the last identityExpr — date fields resolve to a virtual
        //      'LocalDateTable_<guid>' that no queryName string-split can
        //      ever produce, which is precisely how a reviewer dragging a
        //      date field got a filter aimed at a non-existent table.
        //   3. queryName "Table.Column" split — legacy last resort only.
        let filterTarget: { table: string; column: string } | null = null;
        const firstValue = firstRow.value || "";
        if (firstValue.includes(".")) {
            const dotIdx = firstValue.indexOf(".");
            filterTarget = {
                table: firstValue.substring(0, dotIdx),
                column: firstValue.substring(dotIdx + 1),
            };
        } else {
            // effLabelIdx: in single-field mode the bound column (whichever
            // well it landed in) is the filter target source.
            filterTarget = extractColumnTarget(categories[effLabelIdx]);
            if (!filterTarget) {
                const qn = (categories[effLabelIdx].source as { queryName?: string }).queryName || "";
                const dotIdx = qn.lastIndexOf(".");
                if (dotIdx > 0) {
                    filterTarget = {
                        table: qn.substring(0, dotIdx).replace(/^'|'$/g, ""),
                        column: qn.substring(dotIdx + 1),
                    };
                }
            }
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
            displayModeFromData: dataDisplayMode === "chips" || dataDisplayMode === "dropdown",
            selectionMode,
            selectionModeFromData: dataSelectionMode === "single" || dataSelectionMode === "multi",
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
