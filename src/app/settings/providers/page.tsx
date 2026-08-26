"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProviderSection, type SourceInfo } from "@/components/settings/provider-section";
import { providersOfKind, type ProviderKind } from "@/lib/providers/registry";

interface SettingsPayload {
  settings: Record<string, string | undefined>;
  sources: Record<string, SourceInfo>;
}

interface SectionConfig {
  kind: ProviderKind;
  title: string;
  blurb: string;
  feature: string;
  providerField: string;
}

const SECTIONS: SectionConfig[] = [
  { kind: "llm", title: "TEXT", blurb: "Campaigns, scripts and brand analysis", feature: "campaign generation", providerField: "llmProvider" },
  { kind: "image", title: "IMAGES", blurb: "Photoshoot and campaign visuals", feature: "image generation", providerField: "imageProvider" },
  { kind: "video", title: "VIDEO", blurb: "UGC Studio", feature: "UGC Studio", providerField: "videoProvider" },
];

const DEFAULT_PROVIDER: Record<string, string> = {
  llmProvider: "openai", imageProvider: "openai", videoProvider: "veo",
};

export default function ProvidersPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings");
    setData(await res.json());
    setDraft({});
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data) {
    return <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
  }

  const valueOf = (field: string) =>
    draft[field] ?? data.settings[field] ?? DEFAULT_PROVIDER[field] ?? "";
  const set = (field: string, value: string) => setDraft((d) => ({ ...d, [field]: value }));
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-10">
        <h1 className="mb-2 text-3xl font-[family-name:var(--font-heading)] italic">Providers</h1>
        <p className="text-sm text-muted">
          Which models generate your content. Keys saved here override your environment.
        </p>
      </div>

      <div className="space-y-5 pb-24">
        {SECTIONS.map((s) => {
          // The credential field is a property of the SELECTED provider, not
          // a constant on the section: llmApiKey for OpenAI/Anthropic/Gemini,
          // but ollamaUrl for Ollama. Deriving it from the registry entry
          // keeps a typed base URL from ever landing in the API-key column.
          const providers = providersOfKind(s.kind);
          const selectedId = valueOf(s.providerField);
          const selected = providers.find((p) => p.id === selectedId) ?? providers[0];
          const credentialField = selected.credential.field;

          return (
            <ProviderSection
              key={s.kind}
              kind={s.kind}
              title={s.title}
              blurb={s.blurb}
              feature={s.feature}
              selectedId={selected.id}
              credential={draft[credentialField] ?? ""}
              touched={credentialField in draft}
              source={data.sources[credentialField]}
              onSelect={(id) => set(s.providerField, id)}
              onCredentialChange={(v) => set(credentialField, v)}
            />
          );
        })}
      </div>

      {dirty && (
        <div className="sticky bottom-0 -mx-8 flex items-center justify-between border-t border-border bg-surface px-8 py-3">
          <span className="text-xs text-accent">Unsaved changes</span>
          <Button size="sm" loading={saving} onClick={save}>Save</Button>
        </div>
      )}
    </div>
  );
}
