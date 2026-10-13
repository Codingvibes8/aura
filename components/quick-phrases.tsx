"use client";

import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { MessageSquare, Plus, Sparkles } from "lucide-react";
import { useAura } from "@/components/aura-provider";
import { useServerTts } from "@/lib/use-server-tts";
import { useCloudPhrases } from "@/lib/use-cloud-phrases";
import { useRealtime } from "@/components/realtime-provider";
import { sealText } from "@/lib/realtime/crypto";
import { roomKey } from "@/lib/realtime/room-key";
import { PHRASE_CATEGORIES, PREDICTIVE_SUGGESTIONS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconByName } from "@/components/icon-by-name";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * One-tap quick phrases with full keyboard navigation:
 * arrow keys move through the grid (roving tabindex), Enter/Space speaks.
 */
export function QuickPhrases({ className }: { className?: string }) {
  const { addCaption, vibrate, captions } = useAura();
  const tts = useServerTts();
  const { custom, add: addCloudPhrase, remove: removeCloudPhrase, cloud } = useCloudPhrases();
  const { roomId, roomPrivate, sendCaption } = useRealtime();
  const [activeTab, setActiveTab] = useState(PHRASE_CATEGORIES[0].id);
  const [newPhrase, setNewPhrase] = useState("");
  const gridRef = useRef<HTMLDivElement | null>(null);

  const speakPhrase = useCallback(
    (phrase: string) => {
      addCaption({ speaker: "self", text: phrase });
      vibrate(25);
      // Server ElevenLabs audio when configured, browser voice otherwise
      void tts.speak(phrase);
      // Share with the room so remote participants read it (sealed if private)
      if (roomId) {
        const key = roomPrivate ? roomKey(roomId) : undefined;
        if (key) {
          void sealText(key, phrase).then(
            (crypto) => sendCaption({ text: "", isFinal: true, speaker: "Speaker B", crypto }),
            () => undefined
          );
        } else {
          sendCaption({ text: phrase, isFinal: true, speaker: "Speaker B" });
        }
      }
    },
    [addCaption, vibrate, tts, roomId, roomPrivate, sendCaption]
  );

  /* Predictive suggestions inferred from the most recent peer caption */
  const suggestions = useMemo(() => {
    const lastPeer = [...captions].reverse().find((c) => c.speaker === "peer");
    if (!lastPeer) return [];
    const text = lastPeer.text.toLowerCase();
    return PREDICTIVE_SUGGESTIONS.filter((s) => s.match.some((m) => text.includes(m)))
      .map((s) => s.reply)
      .slice(0, 3);
  }, [captions]);

  const categories = useMemo(
    () => [
      ...PHRASE_CATEGORIES,
      { id: "custom", label: "Custom", icon: "plus", phrases: custom },
    ],
    [custom]
  );

  const activeCategory = categories.find((c) => c.id === activeTab) ?? categories[0];
  const columns = 2;

  const focusButton = useCallback((index: number) => {
    const grid = gridRef.current;
    if (!grid) return;
    const buttons = grid.querySelectorAll<HTMLButtonElement>("[data-phrase-btn]");
    buttons[index]?.focus();
  }, []);

  /* Roving-tabindex arrow-key navigation across the phrase grid */
  const onGridKeyDown = (event: React.KeyboardEvent) => {
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>("[data-phrase-btn]");
    if (!buttons || buttons.length === 0) return;
    const current = Array.from(buttons).findIndex((b) => b === document.activeElement);
    if (current === -1) return;
    let next = current;
    switch (event.key) {
      case "ArrowRight":
        next = Math.min(buttons.length - 1, current + 1);
        break;
      case "ArrowLeft":
        next = Math.max(0, current - 1);
        break;
      case "ArrowDown":
        next = Math.min(buttons.length - 1, current + columns);
        break;
      case "ArrowUp":
        next = Math.max(0, current - columns);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = buttons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusButton(next);
  };

  const addCustomPhrase = (event: React.FormEvent) => {
    event.preventDefault();
    const text = newPhrase.trim();
    if (!text) return;
    setNewPhrase("");
    void addCloudPhrase(text);
  };

  const removeCustomPhrase = (phrase: string) => {
    void removeCloudPhrase(phrase);
  };

  return (
    <section
      aria-label="Quick phrases"
      className={cn("flex flex-col rounded-xl border border-border bg-card", className)}
    >
      <div className="flex items-center gap-2 border-b border-border p-3">
        <MessageSquare className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Quick Phrases</h2>
        <Badge variant="secondary">One tap speaks</Badge>
        {cloud && <Badge variant="outline" title="Custom phrases sync to your account">Cloud sync</Badge>}
      </div>

      {suggestions.length > 0 && (
        <div
          role="status"
          aria-label="Suggested replies based on the conversation"
          className="flex flex-wrap items-center gap-2 border-b border-border bg-accent/40 px-3 py-2"
        >
          <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" /> Suggested:
          </span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => speakPhrase(s)}
              className="cursor-pointer rounded-full border border-border bg-background px-3 py-1 text-xs font-medium transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        aria-label="Phrase categories"
        className="flex flex-1 flex-col px-3 pt-3"
      >
        <TabsList className="grid w-full grid-cols-5" role="tablist">
          {categories.map((cat) => (
            <TabsTrigger key={cat.id} value={cat.id} role="tab" id={`tab-${cat.id}`}>
              <IconByName name={cat.icon} className="hidden sm:block" />
              <span className="sm:hidden">{cat.label.slice(0, 3)}</span>
              <span className="hidden sm:inline">{cat.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div
          ref={gridRef}
          role="tabpanel"
          aria-labelledby={`tab-${activeCategory.id}`}
          onKeyDown={onGridKeyDown}
          className="mt-3 grid flex-1 grid-cols-1 gap-2 pb-3 sm:grid-cols-2"
        >
          {activeCategory.phrases.map((phrase, i) => (
            <span key={phrase} className="flex items-stretch gap-1">
              <button
                type="button"
                data-phrase-btn
                tabIndex={i === 0 ? 0 : -1}
                onClick={() => speakPhrase(phrase)}
                aria-label={`Say: ${phrase}`}
                className={cn(
                  "flex min-h-12 flex-1 cursor-pointer items-center rounded-lg border border-border bg-background px-3 py-2 text-left text-sm font-medium transition-colors",
                  "hover:border-primary hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                )}
              >
                <Sparkles className="mr-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {phrase}
              </button>
              {activeCategory.id === "custom" && (
                <button
                  type="button"
                  onClick={() => removeCustomPhrase(phrase)}
                  aria-label={`Delete custom phrase: ${phrase}`}
                  className="cursor-pointer rounded-lg border border-border px-2 text-muted-foreground transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </span>
          ))}
          {activeCategory.id === "custom" && (
            <form onSubmit={addCustomPhrase} className="flex gap-2 sm:col-span-2">
              <input
                type="text"
                value={newPhrase}
                onChange={(e) => setNewPhrase(e.target.value)}
                placeholder="Add your own phrase…"
                aria-label="New custom phrase"
                className="h-11 flex-1 rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="lg" disabled={!newPhrase.trim()}>
                <Plus aria-hidden="true" /> Add
              </Button>
            </form>
          )}
        </div>
      </Tabs>

      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        Keyboard: <kbd className="rounded border border-border bg-muted px-1">Tab</kbd> to grid, arrow
        keys to move, <kbd className="rounded border border-border bg-muted px-1">Enter</kbd> to speak.
      </p>
    </section>
  );
}
