/**
 * Demo data for Aura — runs fully client-side with zero backend.
 * Used by the simulated conversation engine and ambient sound detector.
 */

export interface PhraseCategory {
  id: string;
  label: string;
  icon: string; // lucide icon key consumed by <IconByName />
  phrases: string[];
}

export const PHRASE_CATEGORIES: PhraseCategory[] = [
  {
    id: "medical",
    label: "Medical",
    icon: "stethoscope",
    phrases: [
      "I need a doctor, please.",
      "I'm allergic to penicillin.",
      "This is an emergency — call 911.",
      "Where is the nearest hospital?",
      "I need my medication.",
      "Please face me when you speak.",
      "Could you write that down?",
      "I am Deaf — please type or caption.",
    ],
  },
  {
    id: "transit",
    label: "Transit",
    icon: "train",
    phrases: [
      "Which platform for the train?",
      "Is this bus wheelchair accessible?",
      "Does this train have visual announcements?",
      "I missed my stop — what now?",
      "Where is the elevator?",
      "Is this the right platform for downtown?",
    ],
  },
  {
    id: "ordering",
    label: "Ordering",
    icon: "coffee",
    phrases: [
      "Could I see the menu, please?",
      "I'll have the coffee, no sugar.",
      "Is this gluten-free?",
      "Could you repeat that more slowly?",
      "The check, please.",
      "Could you speak a little louder? I use captions.",
    ],
  },
  {
    id: "work",
    label: "Work",
    icon: "briefcase",
    phrases: [
      "Let's schedule a follow-up meeting.",
      "Please turn on live captions.",
      "Can we move this to email?",
      "I didn't catch that — once more, please.",
      "Could you face the camera?",
      "Can we use the chat for details?",
    ],
  },
];

/** Predictive quick replies inferred from live transcript keywords. */
export const PREDICTIVE_SUGGESTIONS: { match: string[]; reply: string }[] = [
  { match: ["where", "located"], reply: "It's just around the corner, I'll show you." },
  { match: ["how", "much", "cost", "price"], reply: "It's on the menu — let me point it out." },
  { match: ["allergy", "allergic"], reply: "I'll make the staff aware right away." },
  { match: ["emergency", "911", "help"], reply: "Calling emergency services now. Stay with me." },
  { match: ["repeat", "again", "slower"], reply: "Of course — no problem, one more time." },
  { match: ["thank"], reply: "You're very welcome!" },
];

export type AmbientPriority = "info" | "warning" | "critical";

export interface AmbientientSoundDef {
  id: string;
  label: string;
  icon: string;
  intensity: number; // 0..1 loudness used by the visualizer
  priority: AmbientPriority;
}

export const AMBIENT_SOUNDS: AmbientientSoundDef[] = [
  { id: "siren", label: "Siren approaching", icon: "siren", intensity: 0.92, priority: "critical" },
  { id: "door-knock", label: "Door knock", icon: "door-closed", intensity: 0.7, priority: "warning" },
  { id: "name-called", label: "Name called", icon: "megaphone", intensity: 0.6, priority: "warning" },
  { id: "fire-alarm", label: "Fire alarm", icon: "flame", intensity: 0.95, priority: "critical" },
  { id: "phone-ring", label: "Phone ringing", icon: "phone", intensity: 0.55, priority: "info" },
  { id: "baby-crying", label: "Baby crying", icon: "baby", intensity: 0.65, priority: "warning" },
  { id: "dog-barking", label: "Dog barking", icon: "dog", intensity: 0.6, priority: "info" },
  { id: "laughter", label: "Laughter", icon: "laugh", intensity: 0.5, priority: "info" },
  { id: "car-horn", label: "Car horn", icon: "car", intensity: 0.75, priority: "info" },
  { id: "glass-breaking", label: "Glass breaking", icon: "wine", intensity: 0.8, priority: "warning" },
];

/** Simulated two-way conversation for demo mode (cafe intake scenario). */
export interface DemoLine {
  speaker: "peer" | "self";
  text: string;
  /** ms to wait after the previous line */
  delay: number;
}

export const DEMO_CONVERSATION: DemoLine[] = [
  { speaker: "peer", text: "Hi! Welcome in — have you been here before?", delay: 900 },
  { speaker: "self", text: "No, first time. I'm Deaf, so please face me when you speak.", delay: 2600 },
  { speaker: "peer", text: "Of course! Let me grab a menu for you.", delay: 2400 },
  { speaker: "self", text: "Thank you. Could you turn on the live captions too?", delay: 2400 },
  { speaker: "peer", text: "Already on! What can I get you today?", delay: 2600 },
  { speaker: "self", text: "A coffee, no sugar — and is the blueberry muffin gluten-free?", delay: 3000 },
  { speaker: "peer", text: "It is! I'll get that started for you right away.", delay: 2800 },
  { speaker: "self", text: "Perfect, thank you so much.", delay: 2400 },
];

/** Interpreter queue mock progression (seconds in queue → status text). */
export const INTERPRETER_QUEUE_STEPS: { at: number; label: string }[] = [
  { at: 0, label: "Requesting video relay…" },
  { at: 2, label: "In queue — 2 interpreters ahead of you" },
  { at: 6, label: "In queue — 1 interpreter ahead of you" },
  { at: 10, label: "Connecting to certified interpreter…" },
  { at: 14, label: "Interpreter connected — video starting" },
];
