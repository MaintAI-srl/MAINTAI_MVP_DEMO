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
import React, { useState } from "react";
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
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
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
