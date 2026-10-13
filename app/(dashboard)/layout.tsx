import { AuraProvider } from "@/components/aura-provider";
import { RealtimeProvider } from "@/components/realtime-provider";
import { CloudSync } from "@/components/cloud-sync";
import { ModeHeader } from "@/components/mode-header";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      <AuraProvider>
        <CloudSync />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ModeHeader />
        <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          {children}
        </main>
        <footer className="border-t border-border py-4">
          <p className="mx-auto max-w-7xl px-4 text-xs text-muted-foreground">
            Aura — live transport via WebSocket signaling server (Phase 1).
          </p>
        </footer>
      </AuraProvider>
    </RealtimeProvider>
  );
}
