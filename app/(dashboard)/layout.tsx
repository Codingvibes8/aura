import { AuraProvider } from "@/components/aura-provider";
import { ModeHeader } from "@/components/mode-header";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuraProvider>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <ModeHeader />
      <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-border py-4">
        <p className="mx-auto max-w-7xl px-4 text-xs text-muted-foreground">
          Aura demo — every feature runs locally in your browser. No audio leaves this device.
        </p>
      </footer>
    </AuraProvider>
  );
}
