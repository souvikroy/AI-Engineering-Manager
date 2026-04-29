import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useEffect, useState } from "react";
import { authStore } from "@/lib/auth-store";
import { Spinner } from "@/components/ui";
import { BrandMark } from "@/components/BrandLogo";

export function AppShell() {
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await authStore.hydrate();
      if (cancelled) return;
      if (!ok && !authStore.access) {
        navigate(`/login?next=${encodeURIComponent(loc.pathname)}`, { replace: true });
        return;
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [navigate, loc.pathname]);

  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Always-visible top bar: brand mark + wordmark, persistent across every page. */}
        <header className="h-12 flex items-center px-6 border-b border-border bg-zinc-950/40 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/30">
          <BrandMark size={22} tile />
          <span className="ml-2 font-semibold tracking-tight text-sm">OpenGraphXEM</span>
          <span className="ml-3 text-xs text-muted-foreground">AI code review · 224 rules · 21 workflows</span>
        </header>
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
