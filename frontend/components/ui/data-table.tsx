"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
  type TableOptions,
} from "@tanstack/react-table";
import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, any>[];
  pageSize?: number;
  enableRowSelection?: boolean;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  manualPagination?: boolean;
  pageCount?: number;
  pageIndex?: number;
  onPageChange?: (page: number) => void;
  className?: string;
  emptyMessage?: string;
  onRowClick?: (row: TData) => void;
  getRowProps?: (row: TData) => React.HTMLAttributes<HTMLTableRowElement>;
  enableColumnFilters?: boolean;
  onFiltersChange?: (filters: ColumnFiltersState) => void;
}

const filterSelectStyle: React.CSSProperties = {
  width: "100%", fontSize: 11, padding: "3px 6px",
  background: "rgba(15,23,42,0.8)", border: "1px solid rgba(99,102,241,0.3)",
  borderRadius: 4, color: "var(--text-muted)",
  cursor: "pointer", outline: "none", colorScheme: "dark",
};

/** Calcola {from, to} Date da un preset stringa */
function getPresetRange(preset: string): { from: Date | null; to: Date | null } {
  const now = new Date();
  const dow = now.getDay(); // 0=dom, 1=lun
  const monday = (d: Date, offset = 0) => { const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); m.setHours(0,0,0,0); return m; };
  const sunday = (d: Date, offset = 0) => { const m = monday(d, offset); m.setDate(m.getDate() + 6); m.setHours(23,59,59,999); return m; };
  switch (preset) {
    case "questa_settimana":   return { from: monday(now, 0),  to: sunday(now, 0)  };
    case "prossima_settimana": return { from: monday(now, 1),  to: sunday(now, 1)  };
    case "settimana_prec":     return { from: monday(now, -1), to: sunday(now, -1) };
    case "questo_mese": {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      const t = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { from: f, to: t };
    }
    case "mese_prec": {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { from: f, to: t };
    }
    case "quest_anno": {
      return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999) };
    }
    case "anno_scorso": {
      return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999) };
    }
    default: return { from: null, to: null };
  }
}

/** FilterFn da usare nelle colonne con filterVariant:"date" */
export function dateRangeFilterFn(row: any, columnId: string, filterValue: any): boolean {
  if (!filterValue) return true;
  const { preset, from, to } = filterValue as { preset: string; from: string; to: string };
  if (!preset) return true;
  const raw = row.getValue(columnId);
  if (!raw) return false;
  const cellDate = new Date(raw as string);
  if (isNaN(cellDate.getTime())) return false;
  if (preset === "personalizzata") {
    if (from && cellDate < new Date(from + "T00:00:00")) return false;
    if (to   && cellDate > new Date(to   + "T23:59:59")) return false;
    return true;
  }
  const range = getPresetRange(preset);
  if (range.from && cellDate < range.from) return false;
  if (range.to   && cellDate > range.to)   return false;
  return true;
}
dateRangeFilterFn.autoRemove = (val: any) => !val || !val.preset;

function DateFilterCell({ column }: { column: any }) {
  const [preset, setPreset] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (preset === "" ) { column.setFilterValue(undefined); return; }
    if (preset === "personalizzata") {
      if (from || to) column.setFilterValue({ preset, from, to });
      return;
    }
    column.setFilterValue({ preset, from: "", to: "" });
  }, [preset, from, to]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <select
        value={preset}
        onChange={(e) => { setPreset(e.target.value); setFrom(""); setTo(""); }}
        style={{ ...filterSelectStyle, color: preset ? "#a5b4fc" : "var(--text-muted)" }}
      >
        <option value="">Tutte le date</option>
        <option value="questa_settimana">Questa settimana</option>
        <option value="prossima_settimana">Prossima settimana</option>
        <option value="settimana_prec">Settimana prec.</option>
        <option value="questo_mese">Questo mese</option>
        <option value="mese_prec">Mese precedente</option>
        <option value="quest_anno">Quest&apos;anno</option>
        <option value="anno_scorso">Anno scorso</option>
        <option value="personalizzata">Personalizzata...</option>
      </select>
      {preset === "personalizzata" && (
        <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ ...filterSelectStyle, flex: 1 }}
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ ...filterSelectStyle, flex: 1 }}
          />
        </div>
      )}
    </div>
  );
}

export function DataTable<TData>({
  data,
  columns,
  pageSize = 10,
  enableRowSelection = false,
  onRowSelectionChange,
  manualPagination = false,
  pageCount,
  pageIndex = 0,
  onPageChange,
  className,
  emptyMessage = "Nessun dato",
  onRowClick,
  getRowProps,
  enableColumnFilters = false,
  onFiltersChange,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pagination, setPagination] = useState({ pageIndex, pageSize });

  const tableOptions: TableOptions<TData> = {
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    filterFns: { dateRange: dateRangeFilterFn } as any,
    onSortingChange: setSorting,
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnFilters) : updater;
      setColumnFilters(next);
      onFiltersChange?.(next);
    },
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      setRowSelection(next);
      onRowSelectionChange?.(next);
    },
    enableRowSelection,
    state: {
      sorting,
      columnFilters,
      rowSelection,
      ...(manualPagination
        ? { pagination: { pageIndex, pageSize } }
        : { pagination }),
    },
    ...(manualPagination
      ? { manualPagination: true, pageCount: pageCount ?? -1 }
      : {
          getPaginationRowModel: getPaginationRowModel(),
          onPaginationChange: setPagination,
        }),
  };

  const table = useReactTable(tableOptions);

  const currentPage = manualPagination ? pageIndex : table.getState().pagination.pageIndex;
  const totalPages = manualPagination ? (pageCount ?? 1) : table.getPageCount();

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Table */}
      <div className="table-wrap">
        <table className="table" style={{ width: "100%" }}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ cursor: header.column.getCanSort() ? "pointer" : "default", userSelect: "none" }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                          {header.column.getIsSorted() === "asc" ? "↑" : header.column.getIsSorted() === "desc" ? "↓" : "↕"}
                        </span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            ))}

            {/* Filter row */}
            {enableColumnFilters && table.getHeaderGroups().map((headerGroup) => (
              <tr key={`filter-${headerGroup.id}`} style={{ background: "rgba(255,255,255,0.02)" }}>
                {headerGroup.headers.map((header) => {
                  const meta = (header.column.columnDef.meta as any);
                  const filterVariant = meta?.filterVariant as string | undefined;

                  if (!filterVariant) {
                    return <th key={header.id} style={{ padding: "4px 6px" }} />;
                  }

                  const filterValue = (header.column.getFilterValue() as string) ?? "";

                  if (filterVariant === "select") {
                    return (
                      <th key={header.id} style={{ padding: "4px 6px" }} onClick={(e) => e.stopPropagation()}>
                        <select
                          value={filterValue}
                          onChange={(e) => header.column.setFilterValue(e.target.value || undefined)}
                          style={{
                            width: "100%", fontSize: 11, padding: "3px 6px",
                            background: "rgba(15,23,42,0.8)", border: "1px solid rgba(99,102,241,0.3)",
                            borderRadius: 4, color: filterValue ? "#a5b4fc" : "var(--text-muted)",
                            cursor: "pointer", outline: "none",
                          }}
                        >
                          <option value="">Tutti</option>
                          {(meta.options as string[]).map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      </th>
                    );
                  }

                  if (filterVariant === "text") {
                    return (
                      <th key={header.id} style={{ padding: "4px 6px" }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={filterValue}
                          onChange={(e) => header.column.setFilterValue(e.target.value || undefined)}
                          placeholder="Filtra…"
                          style={{
                            width: "100%", fontSize: 11, padding: "3px 6px",
                            background: "rgba(15,23,42,0.8)", border: "1px solid rgba(99,102,241,0.3)",
                            borderRadius: 4, color: "var(--text-primary)",
                            outline: "none", boxSizing: "border-box",
                          }}
                        />
                      </th>
                    );
                  }

                  if (filterVariant === "date") {
                    return (
                      <th key={header.id} style={{ padding: "4px 6px" }} onClick={(e) => e.stopPropagation()}>
                        <DateFilterCell column={header.column} />
                      </th>
                    );
                  }

                  return <th key={header.id} style={{ padding: "4px 6px" }} />;
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px 0", fontSize: 13 }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const rp = getRowProps?.(row.original) ?? {};
                const { style: rpStyle, ...rpRest } = rp;
                return (
                  <tr
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    onClick={() => onRowClick?.(row.original)}
                    {...rpRest}
                    style={{ cursor: onRowClick ? "pointer" : "default", ...(rpStyle ?? {}) }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Pagina {currentPage + 1} di {totalPages}
          </span>
          <button
            className="btn btn-secondary"
            style={{ padding: "4px 12px", fontSize: 12 }}
            onClick={() => manualPagination ? onPageChange?.(currentPage - 1) : table.previousPage()}
            disabled={currentPage === 0}
          >
            ‹ Prec.
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: "4px 12px", fontSize: 12 }}
            onClick={() => manualPagination ? onPageChange?.(currentPage + 1) : table.nextPage()}
            disabled={currentPage >= totalPages - 1}
          >
            Succ. ›
          </button>
        </div>
      )}
    </div>
  );
}

export type { ColumnDef };
