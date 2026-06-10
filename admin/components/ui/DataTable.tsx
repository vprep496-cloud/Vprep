import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading: boolean;
  /** Phase 7: accepts ReactNode so callers can embed e.g. a "Clear filters"
   *  button alongside the empty-state message without a separate component. */
  emptyMessage?: ReactNode;
}

// Phase 7 spec: "DataTable skeleton must show 5 placeholder rows".
const SKELETON_ROWS = 5;

export default function DataTable<T>({
  columns,
  data,
  loading,
  emptyMessage = "No results found",
}: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border-soft bg-background-card shadow-soft">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border-soft bg-background-surface">
            {columns.map((column) => (
              <th key={column.key} className="px-4 py-3 font-semibold text-text-secondary">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
              <tr key={`skeleton-${rowIndex}`} className="border-b border-border-soft last:border-0">
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-4">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-background-surface" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => {
              const record = row as Record<string, unknown>;
              return (
                <tr
                  key={(record.id as string | undefined) ?? rowIndex}
                  className="border-b border-border-soft text-text-primary last:border-0 transition-colors duration-150 hover:bg-background-elevated"
                >
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3">
                      {column.render ? column.render(row) : (record[column.key] as ReactNode)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
