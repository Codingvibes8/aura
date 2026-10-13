"use client";

import type { ReactNode } from "react";
import { Accessibility, BellRing, Contrast, Type, Vibrate, Zap } from "lucide-react";
import { useAura } from "@/components/aura-provider";
import { usePushNotifications } from "@/lib/use-push-notifications";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

/**
 * Accessibility control center: font scaling, high contrast, dark mode,
 * haptics, and reduced motion — persisted to localStorage.
 */
export function SettingsPanel() {
  const {
    fontScale,
    setFontScale,
    highContrast,
    toggleHighContrast,
    dark,
    toggleDark,
    haptics,
    toggleHaptics,
    reducedMotion,
    toggleReducedMotion,
  } = useAura();
  const push = usePushNotifications();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Open accessibility settings">
          <Accessibility className="size-4" aria-hidden="true" />
          <span className="sr-only">Accessibility settings</span>
        </Button>
      </SheetTrigger>
      <SheetContent aria-label="Accessibility settings" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Accessibility className="size-5 text-primary" aria-hidden="true" />
            Accessibility
          </SheetTitle>
          <SheetDescription>
            Every setting applies instantly and is saved on this device. Built for WCAG 2.2 AAA.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Font scaling */}
          <fieldset className="space-y-3">
            <legend className="flex items-center gap-2 text-sm font-semibold">
              <Type className="size-4 text-primary" aria-hidden="true" />
              Text size — {Math.round(fontScale * 100)}%
            </legend>
            <Slider
              aria-label="Text size"
              min={0.875}
              max={1.5}
              step={0.125}
              value={[fontScale]}
              onValueChange={([v]) => setFontScale(v)}
            />
            <p className="text-xs text-muted-foreground">
              Scales every word on the screen — transcripts, buttons, and captions.
            </p>
          </fieldset>

          <div className="h-px bg-border" role="separator" />

          {/* Toggles */}
          <ul className="space-y-4" aria-label="Display and feedback toggles">
            <ToggleRow
              id="hc"
              icon={<Contrast className="size-4 text-primary" aria-hidden="true" />}
              label="High contrast"
              description="Pure black/white with maximum separation"
              checked={highContrast}
              onCheckedChange={toggleHighContrast}
            />
            <ToggleRow
              id="dark"
              icon={<span className="inline-block size-4 rounded-full bg-foreground" aria-hidden="true" />}
              label="Dark mode"
              description="Low-glare interface for bright rooms"
              checked={dark}
              onCheckedChange={toggleDark}
            />
            <ToggleRow
              id="haptics"
              icon={<Vibrate className="size-4 text-primary" aria-hidden="true" />}
              label="Haptic alerts"
              description="Vibration on Android (iOS has no vibration API — critical alerts flash twice instead)"
              checked={haptics}
              onCheckedChange={toggleHaptics}
            />
            <ToggleRow
              id="push"
              icon={<BellRing className="size-4 text-primary" aria-hidden="true" />}
              label="Critical alert notifications"
              description={
                push.state === "unsupported"
                  ? "Notifications are not supported in this browser"
                  : push.state === "denied"
                    ? "Blocked — allow notifications in your browser settings"
                    : push.state === "on"
                      ? "On — critical sounds notify you even with the tab hidden"
                      : "Notify on critical sounds when the tab is hidden"
              }
              checked={push.state === "on"}
              onCheckedChange={() => {
                if (push.state === "on") void push.disable();
                else void push.enable();
              }}
            />
            <ToggleRow
              id="motion"
              icon={<Zap className="size-4 text-primary" aria-hidden="true" />}
              label="Reduce motion"
              description="Minimizes flashes, pulses, and transitions"
              checked={reducedMotion}
              onCheckedChange={toggleReducedMotion}
            />
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ToggleRow({
  id,
  icon,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5" aria-hidden="true">{icon}</span>
        <div>
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </li>
  );
}
