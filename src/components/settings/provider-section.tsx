"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { providersOfKind, type ProviderKind } from "@/lib/providers/registry";

export interface SourceInfo {
  /** "default" is a documented fallback that works unconfigured (the Ollama base URL). */
  source: "user" | "env" | "default" | "none";
  envVar?: string;
  /**
   * What to show in the empty input. API keys arrive masked from the server;
   * URL credentials arrive in the clear, because a base URL is configuration
   * rather than a secret and "http••••1434" reads as corruption.
   */
  masked?: string;
}

interface Props {
  kind: ProviderKind;
  title: string;
  blurb: string;
  feature: string;
  selectedId: string;
  credential: string;
  touched: boolean;
  source: SourceInfo;
  onSelect: (id: string) => void;
  onCredentialChange: (value: string) => void;
}

export function ProviderSection({
  kind, title, blurb, feature, selectedId, credential, touched, source,
  onSelect, onCredentialChange,
}: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const providers = providersOfKind(kind);
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0];
  const isUrl = selected.credential.type === "url";

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Omit the credential when untouched so an env key needs no retyping.
        body: JSON.stringify({
          kind,
          providerId: selected.id,
          ...(touched && credential ? { credential } : {}),
        }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, message: "Could not reach the server." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-1 text-xs tracking-wide text-muted">{title}</div>
      <p className="mb-4 text-xs text-muted/70">{blurb}</p>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { onSelect(p.id); setResult(null); }}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer",
              p.id === selected.id
                ? "border-accent bg-accent-muted"
                : "border-border bg-surface hover:border-accent/30"
            )}
          >
            <span className="block text-sm">{p.label}</span>
            <span className="block text-xs text-muted">{p.modelLabel}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type={isUrl ? "text" : "password"}
          value={credential}
          placeholder={source.masked ?? selected.credential.placeholder}
          onChange={(e) => { onCredentialChange(e.target.value); setResult(null); }}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted/40 focus:border-accent/50 focus:outline-none"
        />
        <Button variant="secondary" size="sm" loading={testing} onClick={runTest}>
          Test
        </Button>
      </div>

      <p className="mt-2 text-xs">
        {result ? (
          <span className={result.ok ? "text-success" : "text-danger"}>
            {result.ok ? "✓ Verified just now" : `✕ ${result.message}`}
          </span>
        ) : source.source === "user" ? (
          <span className="text-success">✓ saved here</span>
        ) : source.source === "env" ? (
          <span className="text-success">✓ from your environment ({source.envVar})</span>
        ) : source.source === "default" ? (
          <span className="text-success">✓ using the default ({source.masked})</span>
        ) : (
          <span className="text-warning">
            ⚠ Not configured — {feature} will fail until this is set
          </span>
        )}
      </p>
    </Card>
  );
}
