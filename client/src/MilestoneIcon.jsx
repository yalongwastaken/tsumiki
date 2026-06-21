import { Sprout, Coins, Landmark, ShieldCheck, CircleCheck, Flame, Target, Award } from "lucide-react";

const MAP = { sprout: Sprout, coins: Coins, landmark: Landmark, shield: ShieldCheck, check: CircleCheck, flame: Flame, target: Target };

export default function MilestoneIcon({ name, size = 16, className = "" }) {
  const Icon = MAP[name] || Award;
  return <Icon size={size} className={className} />;
}
