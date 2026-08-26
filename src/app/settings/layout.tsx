import { AppShell } from "@/components/layout/app-shell";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="max-w-4xl mx-auto flex gap-10">
        <SettingsNav />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </AppShell>
  );
}
