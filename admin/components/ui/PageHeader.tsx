import type { ReactNode } from "react";

// Phase 6 — shared page-title block. Extracted from the markup duplicated
// across `users/page.tsx` (title + count badge + description) so the four new
// Phase 6 pages (candidates, candidate detail, questions, analytics) render a
// consistent header without re-deriving that layout each time. `actions` is
// the right-aligned slot for page-level controls (e.g. questions' "Add
// Question" button, analytics' time-window pills, candidate-detail's "Back to
// Candidates" link) — kept generic (`ReactNode`) since each page's controls
// differ in kind, not just content.

interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, description, badge, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
          {badge ? (
            <span className="rounded-full bg-background-card px-2.5 py-1 text-xs font-semibold text-text-secondary">
              {badge}
            </span>
          ) : null}
        </div>
        {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}
