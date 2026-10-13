"use client";

import * as React from "react";
import { useState } from "react";
import { Mic, Send, Square, Users, Volume2 } from "lucide-react";
import { useAura } from "@/components/aura-provider";
import { useServerTts } from "@/lib/use-server-tts";
import { LiveCaptions } from "@/components/live-captions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";

/**
 * Hearing User View — clean audio/video side with voice input, a smart
 * TTS composer with speed control, and speaker diarization legend.
 */
export default function HearingPage() {
  const { addCaption, vibrate } = useAura();
  const tts = useServerTts();
  const [message, setMessage] = useState("");

  const sendSpoken = () => {
    const text = message.trim();
    if (!text) return;
    addCaption({ speaker: "self", text });
    vibrate(20);
    void tts.speak(text);
    setMessage("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
          <Users className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="text-lg font-bold tracking-tight">Hearing view</h1>
          <p className="text-sm text-muted-foreground">
            Speak naturally — your words become captions for your conversation partner.
          </p>
        </div>
        <Badge variant="success" aria-live="polite">
          <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
          Captions streaming
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Conversation feed */}
          <Card aria-label="Conversation video feed" className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Face-to-face feed</CardTitle>
              <CardDescription>
                Remote video + live audio would stream over WebRTC here. Demo shows the local
                preview.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                role="img"
                aria-label="Local camera preview placeholder"
                className="flex h-56 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-gradient-to-br from-emerald-500/15 via-transparent to-indigo-500/15"
              >
                <span className="flex size-16 items-center justify-center rounded-full bg-secondary text-2xl font-bold text-secondary-foreground">
                  You
                </span>
                <div className="flex items-end gap-1" aria-hidden="true">
                  {[35, 60, 45, 80, 55, 70, 40].map((h, i) => (
                    <span
                      key={i}
                      className="w-1.5 animate-pulse rounded-full bg-emerald-500/70"
                      style={{ height: `${h}%`, animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Live microphone level</p>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Tip: your speech is captioned as <strong>Speaker B</strong> automatically.
                </p>
                <Mic className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
            </CardContent>
          </Card>

          {/* TTS composer */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Volume2 className="size-4 text-primary" aria-hidden="true" />
                Speak for your partner
              </CardTitle>
              <CardDescription>
                Type a message and Aura reads it aloud — also posted to the transcript.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="tts-voice" className="text-xs font-medium text-muted-foreground">
                  Voice
                </label>
                <select
                  id="tts-voice"
                  value={tts.voiceId}
                  onChange={(e) => tts.setVoiceId(e.target.value)}
                  className="h-9 max-w-56 cursor-pointer rounded-lg border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {tts.voices.length === 0 && <option value="">Loading voices…</option>}
                  {tts.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <Badge variant={tts.configured ? "success" : "secondary"} title="Speech synthesis engine">
                  {tts.configured ? "ElevenLabs" : "Browser voice"}
                </Badge>
              </div>
              <label htmlFor="tts-input" className="sr-only">
                Message to speak aloud
              </label>
              <textarea
                id="tts-input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendSpoken();
                }}
                placeholder="Type a message… (Ctrl+Enter to speak)"
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex flex-wrap items-center gap-3">
                <span id="rate-label" className="text-xs font-medium text-muted-foreground">
                  Speech rate — {tts.rate.toFixed(2)}×
                </span>
                <Slider
                  aria-labelledby="rate-label"
                  aria-label="Speech rate"
                  min={0.5}
                  max={2}
                  step={0.25}
                  value={[tts.rate]}
                  onValueChange={([v]) => tts.setRate(v)}
                  className="max-w-48"
                />
                <div className="ms-auto flex gap-2">
                  {(tts.speaking || tts.loading) && (
                    <Button type="button" variant="outline" size="sm" onClick={tts.stop}>
                      <Square aria-hidden="true" /> Stop
                    </Button>
                  )}
                  <Button type="button" size="sm" onClick={sendSpoken} disabled={!message.trim() || tts.loading}>
                    <Send aria-hidden="true" /> Speak aloud
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transcript + diarization */}
        <div className="flex min-h-[32rem] flex-col gap-4">
          <LiveCaptions compact className="min-h-0 flex-1" />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Speaker map</CardTitle>
              <CardDescription>Auto-diarization colors each voice.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="flex items-center gap-2 text-sm">
                <span className="size-3 rounded-full bg-indigo-500" aria-hidden="true" />
                Speaker A — your conversation partner
              </p>
              <p className="flex items-center gap-2 text-sm">
                <span className="size-3 rounded-full bg-emerald-500" aria-hidden="true" />
                Speaker B — you (voice or typed)
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
