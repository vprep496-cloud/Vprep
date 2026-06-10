"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, ServerCog, Sparkles, XCircle } from "lucide-react";

import { adminApi } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import type { AIStatus } from "@/types";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
      }`}
    >
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {label}
    </span>
  );
}

function SettingRow({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="max-w-md truncate text-sm font-semibold text-text-primary">{value ?? "Not set"}</span>
    </div>
  );
}

function ModelsPanel({ status }: { status: AIStatus }) {
  return (
    <div className="rounded-2xl border border-border bg-background-card p-5">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-primary-400" />
        <h2 className="text-base font-bold text-text-primary">Model Routing</h2>
      </div>
      <div className="mt-3">
        <SettingRow label="Text model" value={status.models.text} />
        <SettingRow label="JSON model" value={status.models.json} />
        <SettingRow label="Audio/image model" value={status.models.multimodal} />
        <SettingRow label="Health-check model" value={status.models.health} />
      </div>
    </div>
  );
}

export default function AIPage() {
  const [liveStatus, setLiveStatus] = useState<AIStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["admin-ai-status"],
    queryFn: () => adminApi.getAIStatus(false),
  });

  const current = liveStatus ?? status;

  const runLiveCheck = async () => {
    setChecking(true);
    try {
      setLiveStatus(await adminApi.getAIStatus(true));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="AI Configuration"
        description="Gemini provider status, model routing, and live key validation."
        actions={
          <button
            type="button"
            onClick={runLiveCheck}
            disabled={checking || !current?.configured}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
          >
            {checking ? <Loader2 size={16} className="animate-spin" /> : <ServerCog size={16} />}
            Run Live Check
          </button>
        }
      />

      {isLoading || !current ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 size={16} className="animate-spin" />
          Loading AI status...
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-border bg-background-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <KeyRound size={18} className="text-primary-400" />
                <h2 className="text-base font-bold text-text-primary">Provider</h2>
              </div>
              <StatusPill ok={current.configured} label={current.configured ? "Configured" : "Missing key"} />
            </div>

            <div className="mt-4">
              <SettingRow label="Provider" value={current.provider} />
              <SettingRow label="SDK" value={current.sdk} />
              <SettingRow label="Key fingerprint" value={current.keyFingerprint} />
              <SettingRow label="Scoring temperature" value={current.generation.temperature} />
              <SettingRow label="Creative temperature" value={current.generation.creativeTemperature} />
              <SettingRow label="Max output tokens" value={current.generation.maxOutputTokens} />
            </div>

            {current.live ? (
              <div className="mt-4 rounded-xl border border-border bg-background-surface px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-text-primary">Live check</span>
                  <StatusPill ok={current.live.ok} label={current.live.ok ? "Passed" : "Failed"} />
                </div>
                <p className="mt-2 text-sm text-text-secondary">{current.live.message}</p>
              </div>
            ) : null}
          </div>

          <ModelsPanel status={current} />
        </div>
      )}
    </div>
  );
}
