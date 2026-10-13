/**
 * AudioSet label → Aura ambient-sound mapping (Phase 4.2).
 *
 * The AST classifier returns AudioSet class names ("Siren", "Knock", …).
 * This module maps them onto Aura's curated, priority-tagged detections,
 * applies the confidence threshold, and enforces per-sound cooldowns so a
 * continuous siren doesn't spam the room.
 */

import type { AmbientPriority } from "../../lib/realtime/schema.ts";

export interface AmbientDef {
  /** stable id shown in chips + captions */
  id: string;
  label: string;
  icon: string;
  intensity: number;
  priority: AmbientPriority;
}

export interface MappedDetection extends AmbientDef {
  /** engine confidence that produced this detection */
  score: number;
}

/** AudioSet label substring (lowercase) → Aura def. First match wins. */
const LABEL_MAP: { match: string[]; def: AmbientDef }[] = [
  {
    match: ["siren", "emergency vehicle", "fire engine", "ambulance", "police"],
    def: { id: "siren", label: "Siren approaching", icon: "siren", intensity: 0.92, priority: "critical" },
  },
  {
    match: ["fire alarm", "smoke alarm", "alarm"],
    def: { id: "fire-alarm", label: "Fire alarm", icon: "flame", intensity: 0.95, priority: "critical" },
  },
  {
    match: ["knock", "door", "doorbell"],
    def: { id: "door-knock", label: "Door knock", icon: "door-closed", intensity: 0.7, priority: "warning" },
  },
  {
    match: ["baby cry", "infant cry", "crying baby"],
    def: { id: "baby-crying", label: "Baby crying", icon: "baby", intensity: 0.65, priority: "warning" },
  },
  {
    match: ["glass shatter", "glass breaking", "shatter"],
    def: { id: "glass-breaking", label: "Glass breaking", icon: "wine", intensity: 0.8, priority: "warning" },
  },
  {
    match: ["dog bark", "barking", "dog"],
    def: { id: "dog-barking", label: "Dog barking", icon: "dog", intensity: 0.6, priority: "info" },
  },
  {
    match: ["laughter", "laugh", "giggle", "chuckle"],
    def: { id: "laughter", label: "Laughter", icon: "laugh", intensity: 0.5, priority: "info" },
  },
  {
    match: ["car horn", "vehicle horn", "horn", "traffic"],
    def: { id: "car-horn", label: "Car horn", icon: "car", intensity: 0.75, priority: "info" },
  },
  {
    match: ["telephone ring", "phone ring", "ringtone", "telephone"],
    def: { id: "phone-ring", label: "Phone ringing", icon: "phone", intensity: 0.55, priority: "info" },
  },
  {
    match: ["shout", "yell", "scream", "calling"],
    def: { id: "name-called", label: "Shouting nearby", icon: "megaphone", intensity: 0.6, priority: "warning" },
  },
];

/** Engine labels that must never surface (STT owns speech; music is noise). */
const IGNORE = ["speech", "music", "silence", "white noise", "background noise"];

export interface MapOptions {
  /** minimum engine score to surface (default 0.3) */
  threshold?: number;
  /** per-sound cooldown in ms (default 20_000) */
  cooldownMs?: number;
  now?: number;
}

/**
 * Stateful mapper — holds last-fired timestamps for cooldowns.
 * One instance per ambient session.
 */
export class DetectionMapper {
  private lastFired = new Map<string, number>();
  private threshold: number;
  private cooldownMs: number;

  constructor(opts?: { threshold?: number; cooldownMs?: number }) {
    this.threshold = opts?.threshold ?? 0.3;
    this.cooldownMs = opts?.cooldownMs ?? 20_000;
  }

  map(predictions: { label: string; score: number }[], opts?: MapOptions): MappedDetection[] {
    const threshold = opts?.threshold ?? this.threshold;
    const cooldownMs = opts?.cooldownMs ?? this.cooldownMs;
    const now = opts?.now ?? Date.now();
    const out: MappedDetection[] = [];
    const seen = new Set<string>();

    // highest-confidence first so the best label wins each def
    const sorted = [...predictions].sort((a, b) => b.score - a.score);

    for (const pred of sorted) {
      const label = (pred.label ?? "").toLowerCase();
      if (!label || pred.score < threshold) continue;
      if (IGNORE.some((ig) => label.includes(ig))) continue;

      for (const { match, def } of LABEL_MAP) {
        if (seen.has(def.id)) continue;
        if (!match.some((m) => label.includes(m))) continue;
        const last = this.lastFired.get(def.id);
        if (last !== undefined && now - last < cooldownMs) continue;
        this.lastFired.set(def.id, now);
        seen.add(def.id);
        out.push({ ...def, score: pred.score });
        break;
      }
    }
    return out;
  }
}
