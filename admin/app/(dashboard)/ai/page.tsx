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
    <div className="flex items-center justify-between gap-4 border-b border-border-soft py-3 last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="max-w-[60%] truncate text-sm font-semibold text-text-primary">{value ?? "—"}</span>
    </div>
  );
}

function ModelsPanel({ status }: { status: AIStatus }) {
  const codingReady = status.live?.codingModelReady;
  const codingUsesSpecializedModel = status.models.codingModelActive;

  return (
    <div className="rounded-2xl border border-border-soft bg-background-card p-5 shadow-soft">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/10">
          <Sparkles size={15} className="text-primary-600" />
        </div>
        <h2 className="text-base font-bold text-text-primary">Model Routing</h2>
      </div>
      <div className="mt-3">
        <SettingRow label="Default model" value={status.models.default} />
        <SettingRow label="Text model" value={status.models.text} />
        <SettingRow label="JSON model" value={status.models.json} />
        <SettingRow label="Voice / HR scoring" value={status.models.scoringVoiceHr} />
        <SettingRow label="Coding scoring" value={status.models.scoringCoding} />
        <SettingRow
          label="Coding route"
          value={codingUsesSpecializedModel ? "Code-specialized model" : "General scoring fallback"}
        />
        <SettingRow label="Coding context window" value={status.generation.codingNumCtx ?? null} />
        <SettingRow label="Coding timeout" value={status.generation.codingTimeoutSeconds ?? null} />
      </div>

      {codingReady === false || status.live?.codingModelWarning ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          {status.live?.codingModelWarning ??
            `Coding scoring is configured for ${status.models.scoringCoding}, but the live check did not confirm it is available.`}
        </div>
      ) : null}
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
        description="Local Ollama provider status, model routing, and live model validation."
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
          <div className="rounded-2xl border border-border-soft bg-background-card p-5 shadow-soft">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/10">
                  <KeyRound size={15} className="text-primary-600" />
                </div>
                <h2 className="text-base font-bold text-text-primary">Provider</h2>
              </div>
              <StatusPill ok={current.configured} label={current.configured ? "Configured" : "Needs setup"} />
            </div>

            <div className="mt-4">
              <SettingRow label="Provider" value={current.provider} />
              <SettingRow label="SDK" value={current.sdk} />
              <SettingRow label="Ollama endpoint" value={current.endpoint ?? "Not set"} />
              <SettingRow label="Scoring temperature" value={current.generation.temperature} />
              <SettingRow label="Creative temperature" value={current.generation.creativeTemperature} />
              <SettingRow label="Max output tokens" value={current.generation.maxOutputTokens} />
              <SettingRow label="Request timeout" value={current.generation.requestTimeoutSeconds ?? null} />
              <SettingRow label="Image OCR" value={current.media?.imageOcr ?? null} />
              <SettingRow label="Voice transcription" value={current.media?.audioTranscription ?? null} />
            </div>

            {current.live ? (
              <div className="mt-4 rounded-xl border border-border-soft bg-background-elevated px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-text-primary">Live check result</span>
                  <StatusPill ok={current.live.ok} label={current.live.ok ? "Passed" : "Failed"} />
                </div>
                <p className="mt-2 text-sm text-text-secondary">{current.live.message}</p>
                {current.live.availableModels?.length ? (
                  <p className="mt-2 text-xs text-text-muted">
                    Available models:{" "}
                    <span className="font-medium text-text-secondary">{current.live.availableModels.join(", ")}</span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <ModelsPanel status={current} />
        </div>
      )}
    </div>
  );
}
