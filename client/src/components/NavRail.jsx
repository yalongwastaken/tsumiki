// NavRail.jsx — the left navigation: collapsible icon-rail on desktop, slide-in drawer
// on mobile. NAV is the single source of truth for the tabs (also used by the header to
// label the current section).
import {
  Home as HomeIcon,
  Target,
  History,
  TrendingUp,
  Trophy,
  Settings as SettingsIcon,
  Wallet,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

export const NAV = [
  ["home", "Home", HomeIcon],
  ["plan", "Plan", Target],
  ["activity", "Activity", History],
  ["grow", "Grow", TrendingUp],
  ["goals", "Goals", Trophy],
  ["accounts", "Accounts", Wallet],
  ["settings", "Settings", SettingsIcon],
];

export default function NavRail({ tab, setTab, menuOpen, setMenuOpen, collapsed, toggleRail }) {
  return (
    <aside
      className={`fixed z-40 inset-y-0 left-0 bg-white border-r border-slate-200 flex flex-col transform transition-all duration-300 ease-out md:static md:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "w-60 md:w-16" : "w-60"}`}
    >
      <div className="px-4 py-4 flex items-center gap-2 border-b border-slate-100">
        <svg
          width="22"
          height="22"
          viewBox="0 0 64 64"
          aria-hidden="true"
          className="flex-shrink-0"
        >
          <rect x="6" y="37" width="18" height="18" rx="3" fill="#C9C0FB" />
          <rect x="23" y="23" width="18" height="18" rx="3" fill="#9B8AFA" />
          <rect x="40" y="9" width="18" height="18" rx="3" fill="#7C6FE8" />
        </svg>
        <span className={`font-bold text-slate-800 ${collapsed ? "md:hidden" : ""}`}>Tsumiki</span>
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setMenuOpen(false);
            }}
            title={label}
            className={`press w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${collapsed ? "md:justify-center" : ""} ${tab === key ? "bg-brand-100 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}
          >
            <Icon size={20} className="flex-shrink-0" />
            <span className={collapsed ? "md:hidden" : ""}>{label}</span>
          </button>
        ))}
      </nav>
      <button
        onClick={toggleRail}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden md:flex items-center gap-2 px-4 py-3 border-t border-slate-100 text-slate-500 hover:text-slate-600 text-sm"
      >
        {collapsed ? (
          <PanelLeftOpen size={18} />
        ) : (
          <>
            <PanelLeftClose size={18} /> Collapse
          </>
        )}
      </button>
    </aside>
  );
}
