"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import axios from "axios";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { adminApi } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable";
import type { TrackInput, TrackSummary } from "@/types";

const FIELD_CLASS =
  "w-full rounded-xl border border-border bg-background-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500";

function csvToList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function TracksPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const isSuperadmin = session?.user?.role === "superadmin";

  const [form, setForm] = useState({
    id: "",
    name: "",
    description: "",
    icon: "briefcase-outline",
    color: "#818CF8",
    totalDays: 30,
    topicAreas: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: tracks, isLoading } = useQuery({
    queryKey: ["admin-tracks"],
    queryFn: adminApi.getTracks,
  });

  const sortedTracks = useMemo(() => tracks ?? [], [tracks]);
  const isValid = form.name.trim().length > 0 && form.description.trim().length > 0;

  const reset = () =>
    setForm({
      id: "",
      name: "",
      description: "",
      icon: "briefcase-outline",
      color: "#818CF8",
      totalDays: 30,
      topicAreas: "",
    });

  const handleCreate = async () => {
    if (!isValid || !isSuperadmin) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: TrackInput = {
        ...(form.id.trim() ? { id: form.id.trim() } : {}),
        name: form.name.trim(),
        description: form.description.trim(),
        icon: form.icon.trim() || "briefcase-outline",
        color: form.color.trim() || "#818CF8",
        totalDays: form.totalDays,
        topicAreas: csvToList(form.topicAreas),
      };
      await adminApi.createTrack(payload);
      reset();
      queryClient.invalidateQueries({ queryKey: ["admin-tracks"] });
    } catch (err) {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setError(typeof detail === "string" ? detail : "Could not create this track.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (trackId: string) => {
    if (!isSuperadmin) return;
    await adminApi.deleteTrack(trackId);
    queryClient.invalidateQueries({ queryKey: ["admin-tracks"] });
  };

  const columns: DataTableColumn<TrackSummary>[] = [
    {
      key: "name",
      label: "Track",
      render: (track) => (
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: track.color }} />
          <div>
            <p className="text-sm font-semibold text-text-primary">{track.name}</p>
            <p className="text-xs text-text-muted">{track.id}</p>
          </div>
        </div>
      ),
    },
    {
      key: "description",
      label: "Description",
      render: (track) => <span className="line-clamp-2 text-sm text-text-secondary">{track.description}</span>,
    },
    {
      key: "totalDays",
      label: "Days",
      render: (track) => track.totalDays,
    },
    {
      key: "topicAreas",
      label: "Topic Areas",
      render: (track) => (
        <div className="flex max-w-sm flex-wrap gap-1.5">
          {track.topicAreas.slice(0, 5).map((topic) => (
            <span key={topic} className="rounded-full bg-background-surface px-2 py-0.5 text-xs text-text-muted">
              {topic}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (track) =>
        isSuperadmin ? (
          <button
            type="button"
            onClick={() => handleDeactivate(track.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <Trash2 size={13} />
            Deactivate
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Tracks"
        badge={`${sortedTracks.length} active`}
        description="Create role tracks that power assessments, plans, questions, and mock interviews."
      />

      {isSuperadmin ? (
        <div className="mt-6 rounded-2xl border border-border bg-background-card p-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-6">
            <input
              value={form.id}
              onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
              placeholder="track_id optional"
              className={FIELD_CLASS}
            />
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Track name"
              className={FIELD_CLASS}
            />
            <input
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Description"
              className="lg:col-span-2 w-full rounded-xl border border-border bg-background-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <input
              value={form.topicAreas}
              onChange={(event) => setForm((current) => ({ ...current, topicAreas: event.target.value }))}
              placeholder="topics, comma separated"
              className={FIELD_CLASS}
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!isValid || submitting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Create
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              type="color"
              value={form.color}
              onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
              className="h-10 w-14 rounded-lg border border-border bg-background-surface"
              aria-label="Track color"
            />
            <input
              value={form.icon}
              onChange={(event) => setForm((current) => ({ ...current, icon: event.target.value }))}
              placeholder="Ionicon name"
              className="w-48 rounded-xl border border-border bg-background-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <input
              type="number"
              min={1}
              max={180}
              value={form.totalDays}
              onChange={(event) => setForm((current) => ({ ...current, totalDays: Number(event.target.value) }))}
              className="w-32 rounded-xl border border-border bg-background-surface px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </div>
      ) : null}

      <div className="mt-6">
        <DataTable columns={columns} data={sortedTracks} loading={isLoading} emptyMessage="No active tracks found" />
      </div>
    </div>
  );
}
