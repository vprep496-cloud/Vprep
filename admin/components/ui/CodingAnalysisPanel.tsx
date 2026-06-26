"use client";

import { AlertCircle, CheckCircle2, Code2, Cpu, XCircle } from "lucide-react";

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function boolLabel(value: unknown): { label: string; tone: "good" | "bad" | "neutral" } {
  if (value === true) return { label: "Yes", tone: "good" };
  if (value === false) return { label: "No", tone: "bad" };
  return { label: "Unknown", tone: "neutral" };
}

function chipTone(tone: "good" | "bad" | "neutral") {
  if (tone === "good") return "border-success/25 bg-success/10 text-success";
  if (tone === "bad") return "border-danger/25 bg-danger/10 text-danger";
  return "border-border bg-background-surface text-text-muted";
}

function DetailPill({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-border bg-background-surface px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-text-primary">{value}</p>
    </div>
  );
}

export default function CodingAnalysisPanel({
  metadata,
}: {
  metadata: Record<string, unknown> | null | undefined;
}) {
  if (!metadata) return null;

  const codeAnalysis = metadata.code_analysis as Record<string, unknown> | undefined;
  const provider = textValue(metadata.provider);
  const modelName = textValue(metadata.model_name) ?? provider?.replace(/^ollama\//, "") ?? null;
  const modelRole = textValue(metadata.model_role);
  const requestedModel = textValue(metadata.coding_model_requested);
  const scoringMode = textValue(metadata.scoring_mode);

  if (!codeAnalysis && !provider && scoringMode !== "coding_logic_image") return null;

  const algorithm = textValue(codeAnalysis?.algorithm_category)?.replace(/_/g, " ") ?? null;
  const timeComplexity = textValue(codeAnalysis?.time_complexity);
  const spaceComplexity = textValue(codeAnalysis?.space_complexity);
  const language = textValue(codeAnalysis?.language_detected);
  const reconstructedCode = textValue(codeAnalysis?.reconstructed_code);
  const optimal = boolLabel(codeAnalysis?.is_optimal);
  const mainCase = boolLabel(codeAnalysis?.main_case_correct);
  const usingSpecialized = modelRole === "code_specialized" || metadata.coding_model_active === true;

  return (
    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10">
            <Code2 size={15} className="text-sky-700" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-sky-800">
              Coding Scoring Analysis
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {usingSpecialized ? "Code-specialized qwen/coder route" : "General model fallback"}
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
            usingSpecialized
              ? "border-success/25 bg-success/10 text-success"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          <Cpu size={11} />
          {modelName ?? "model unknown"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <DetailPill label="Algorithm" value={algorithm} />
        <DetailPill label="Time" value={timeComplexity} />
        <DetailPill label="Space" value={spaceComplexity} />
        <DetailPill label="Language" value={language} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${chipTone(mainCase.tone)}`}>
          {mainCase.tone === "good" ? <CheckCircle2 size={12} /> : mainCase.tone === "bad" ? <XCircle size={12} /> : <AlertCircle size={12} />}
          Main case correct: {mainCase.label}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${chipTone(optimal.tone)}`}>
          {optimal.tone === "good" ? <CheckCircle2 size={12} /> : optimal.tone === "bad" ? <XCircle size={12} /> : <AlertCircle size={12} />}
          Optimal: {optimal.label}
        </span>
        {requestedModel && requestedModel !== modelName ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            Requested: {requestedModel}
          </span>
        ) : null}
      </div>

      {reconstructedCode ? (
        <div className="mt-3">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Reconstructed Solution
          </p>
          <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-background-card px-3 py-2.5 text-xs leading-5 text-text-secondary">
            <code>{reconstructedCode}</code>
          </pre>
        </div>
      ) : null}
    </div>
  );
}
