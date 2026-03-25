"use strict";

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

/* ─── Interfaces ─── */

export interface DatePeriodItem {
    type: string;
    sort: number;
}

export interface PageFilterMeta {
    label: string;
    table: string;
    column: string;
    values: string[];
}

export interface SlicerData {
    datePeriods: DatePeriodItem[];
    beats: string[];
    pageFilters: PageFilterMeta[];
}

/* ─── Bridge Table Row ─── */

interface BridgeRow {
    category: string;
    label: string;
    value: string;
    sortOrder: number;
}

/* ─── Parser ─── */

/**
 * Parse the SlicerConfig bridge table.
 * Each row: Category, Label, Value, SortOrder
 * Category values: "Period", "Beat", "Filter1", "Filter2"
 */
export function parseDataView(dataView: DataView): SlicerData {
    const result: SlicerData = {
        datePeriods: [],
        beats: [],
        pageFilters: [],
    };

    if (!dataView?.categorical) return result;

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
    const sortIdx = roleToValIdx["sortOrder"];

    if (catIdx === undefined || labelIdx === undefined) return result;

    const rowCount = categories[0]?.values?.length ?? 0;

    const rows: BridgeRow[] = [];
    for (let r = 0; r < rowCount; r++) {
        rows.push({
            category: String(categories[catIdx].values[r] || ""),
            label: String(categories[labelIdx].values[r] || ""),
            value: valueIdx !== undefined ? String(categories[valueIdx].values[r] || "") : "",
            sortOrder: sortIdx !== undefined ? Number(values[sortIdx].values[r]) || 0 : 0,
        });
    }

    // ─── Date Periods ───
    const seenPeriods = new Set<string>();
    for (const row of rows) {
        if (row.category !== "Period" || !row.label || seenPeriods.has(row.label)) continue;
        seenPeriods.add(row.label);
        result.datePeriods.push({ type: row.label, sort: row.sortOrder });
    }
    result.datePeriods.sort((a, b) => a.sort - b.sort);

    // ─── Beats ───
    const seenBeats = new Set<string>();
    for (const row of rows) {
        if (row.category !== "Beat" || !row.label || seenBeats.has(row.label)) continue;
        seenBeats.add(row.label);
        result.beats.push(row.label);
    }
    result.beats.sort();

    // ─── Page Filters ───
    for (const filterCat of ["Filter1", "Filter2"]) {
        const filterRows = rows.filter(r => r.category === filterCat && r.label);
        if (filterRows.length === 0) continue;

        const firstValue = filterRows[0].value || "";
        const parts = firstValue.split(".");
        const table = parts.length > 1 ? parts[0] : "";
        const column = parts.length > 1 ? parts[1] : filterRows[0].label;
        const label = column;

        const vals: string[] = [];
        const seen = new Set<string>();
        for (const row of filterRows) {
            if (!seen.has(row.label)) {
                seen.add(row.label);
                vals.push(row.label);
            }
        }

        if (vals.length > 0) {
            result.pageFilters.push({ label, table, column, values: vals });
        }
    }

    return result;
}
