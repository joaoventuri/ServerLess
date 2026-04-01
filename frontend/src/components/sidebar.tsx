"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Server,
  KeyRound,
  Activity,
  BarChart3,
  Container,
  Code2,
  Bell,
  Settings,
  LogOut,
  Globe,
  Archive,
  Layers,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Server Vault", href: "/servers", icon: Server },
  { name: "Access Hub", href: "/vault", icon: KeyRound },
  { name: "WebHealth", href: "/health", icon: Activity },
  { name: "Telemetry", href: "/telemetry", icon: BarChart3 },
  { name: "Docker Manager", href: "/docker", icon: Container },
  { name: "Stacks", href: "/stacks", icon: Layers },
  { name: "Domains", href: "/domains", icon: Globe },
  { name: "Backups", href: "/backups", icon: Archive },
  { name: "Cloud IDE", href: "/ide", icon: Code2 },
  { name: "Webhooks", href: "/webhooks", icon: Bell },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-[#0c0c0c] flex flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center justify-center border-b border-border px-4">
        <span className="tracking-tight" style={{
          fontSize: "2.5rem",
          lineHeight: "1.75rem",
          fontWeight: 1000,
          color: "#4ade80",
          textShadow: "0 0 7px #22c55e, 0 0 20px #22c55e80, 0 0 40px #22c55e40",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>
          Server<span style={{ color: "#86efac" }}>Less</span>
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <div className="space-y-1">
          {navigation.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all",
                  isActive
                    ? "bg-primary/10 text-primary neon-border border border-primary/20"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className={cn("h-4 w-4", isActive && "drop-shadow-[0_0_4px_rgba(34,197,94,0.5)]")} />
                {item.name}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User footer */}
      <div className="border-t border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {user?.name?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name || "User"}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email || ""}</p>
            </div>
          </div>
          <button
            onClick={() => { logout(); window.location.href = "/login"; }}
            className="text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
