// MilestoneIcon.jsx — maps a milestone key to its lucide icon.
import {
  Sprout,
  Coins,
  Landmark,
  ShieldCheck,
  CircleCheck,
  Flame,
  Target,
  Award,
  PencilLine,
  ListChecks,
  Ban,
  CalendarDays,
  Sparkles,
} from "lucide-react";

const MAP = {
  sprout: Sprout,
  coins: Coins,
  landmark: Landmark,
  shield: ShieldCheck,
  check: CircleCheck,
  flame: Flame,
  target: Target,
  pencil: PencilLine,
  list: ListChecks,
  ban: Ban,
  calendar: CalendarDays,
  sparkles: Sparkles,
};

/** Render the lucide icon for a milestone key (falls back to Award). Decorative —
 * the milestone label always sits beside it, so it's hidden from assistive tech. */
export default function MilestoneIcon({ name, size = 16, className = "" }) {
  const Icon = MAP[name] || Award;
  return <Icon size={size} className={className} aria-hidden="true" />;
}
