import {
  Baby,
  Briefcase,
  Car,
  Coffee,
  Dog,
  DoorClosed,
  Flame,
  Laugh,
  Megaphone,
  Phone,
  Siren,
  Stethoscope,
  TrainFront,
  Wine,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  train: TrainFront,
  coffee: Coffee,
  briefcase: Briefcase,
  siren: Siren,
  "door-closed": DoorClosed,
  megaphone: Megaphone,
  flame: Flame,
  phone: Phone,
  baby: Baby,
  dog: Dog,
  laugh: Laugh,
  car: Car,
  wine: Wine,
};

export function IconByName({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? HelpCircle;
  return <Icon className={className} aria-hidden="true" />;
}
