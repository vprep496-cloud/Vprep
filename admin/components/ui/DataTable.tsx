import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

export interface DataTableColumn<T> {
  key: string;
  label: string;
  className?: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading: boolean;
  error?: boolean;
  emptyMessage?: ReactNode;
  onRetry?: () => void;
}

const SKELETON_ROWS = 5;

export default function DataTable<T>({
  columns,
  data,
  loading,
  error = false,
  emptyMessage = "No results found",
  onRetry,
}: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border-soft bg-background-card shadow-soft">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border-soft bg-background-surface/60">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-text-muted ${column.className ?? ""}`}
              >
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
                    <div
                      className="h-4 animate-pulse rounded-md bg-background-surface"
                      style={{ width: `${55 + (rowIndex * 13 + parseInt(column.key, 36)) % 35}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : error ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-14 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger/10">
                    <AlertTriangle size={18} className="text-danger" />
                  </div>
                  <p className="text-sm font-medium text-text-primary">Failed to load data</p>
                  <p className="text-xs text-text-muted">Could not reach the server. Check your connection.</p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-1 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-background-surface hover:text-text-primary"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-14 text-center text-sm text-text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => {
              const record = row as Record<string, unknown>;
              return (
                <tr
                  key={(record.id as string | undefined) ?? rowIndex}
                  className="group border-b border-border-soft text-text-primary last:border-0 transition-colors hover:bg-background-elevated"
                >
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-3.5 ${column.className ?? ""}`}>
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
