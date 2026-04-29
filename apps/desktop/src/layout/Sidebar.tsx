import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { GitBranch, LayoutDashboard, ListChecks, Settings, ChevronLeft, ChevronRight, Download, LogOut, Ticket } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { BrandMark } from "@/components/BrandLogo";
import { authStore } from "@/lib/auth-store";

const COLLAPSED_KEY = "reviewer.sidebar.collapsed";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const installed = window.matchMedia("(display-mode: standalone)").matches;

  return (
    <aside className={cn(
      "border-r border-border bg-zinc-950/60 flex flex-col transition-[width] duration-150",
      collapsed ? "w-[64px]" : "w-[240px]"
    )}>
      <div className={cn("h-14 flex items-center", collapsed ? "justify-center" : "px-4")}>
        <BrandMark size={28} tile />
        {!collapsed && <span className="ml-2 font-semibold tracking-tight">OpenGraphXEM</span>}
      </div>

      <div className="px-3 py-2">
        <Button variant="ghost" size="icon" className="w-full" onClick={() => setCollapsed((v) => !v)} aria-label="toggle sidebar">
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>

      <nav className="flex-1 px-2 space-y-1">
        <SectionLabel collapsed={collapsed}>Workspace</SectionLabel>
        <Item to="/app" icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" collapsed={collapsed} end />
        <Item to="/app/repos" icon={<GitBranch className="w-4 h-4" />} label="Repos" collapsed={collapsed} />
        <Item to="/app/tickets" icon={<Ticket className="w-4 h-4" />} label="Tickets" collapsed={collapsed} />
        <Item to="/app/jobs" icon={<ListChecks className="w-4 h-4" />} label="Reviews" collapsed={collapsed} />
        <SectionLabel collapsed={collapsed}>Settings</SectionLabel>
        <Item to="/app/settings" icon={<Settings className="w-4 h-4" />} label="Settings" collapsed={collapsed} />
      </nav>

      <div className="p-3 border-t border-border space-y-2">
        {!installed && installEvt && (
          <Button variant="outline" size={collapsed ? "icon" : "sm"} className="w-full"
            onClick={async () => {
              await installEvt.prompt();
              setInstallEvt(null);
            }}>
            <Download className="w-4 h-4" />
            {!collapsed && <span className="ml-2">Install desktop app</span>}
          </Button>
        )}
        <Button variant="ghost" size={collapsed ? "icon" : "sm"} className="w-full"
          onClick={async () => { await authStore.clear(); navigate("/login"); }}>
          <LogOut className="w-4 h-4" />
          {!collapsed && <span className="ml-2">Sign out</span>}
        </Button>
      </div>
    </aside>
  );
}

function SectionLabel({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  if (collapsed) return <div className="my-3 mx-2 h-px bg-border" />;
  return <div className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>;
}

function Item({ to, icon, label, collapsed, end }: { to: string; icon: React.ReactNode; label: string; collapsed: boolean; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(
        "flex items-center gap-2 rounded-md text-sm px-2 py-2",
        isActive ? "bg-zinc-800 text-foreground" : "text-muted-foreground hover:bg-zinc-900/40 hover:text-foreground",
        collapsed ? "justify-center" : ""
      )}
      title={collapsed ? label : undefined}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}
