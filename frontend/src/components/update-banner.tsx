"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Download, Loader2, X } from "lucide-react";

interface UpdateInfo {
  updateAvailable: boolean;
  current: string;
  latest?: string;
  commits?: number;
}

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const check = () => {
      api<UpdateInfo>("/updater/check").then(setUpdate).catch(() => {});
    };
    check();
    const interval = setInterval(check, 5 * 60 * 1000); // check every 5 min
    return () => clearInterval(interval);
  }, []);

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      await api("/updater/apply", { method: "POST" });
      // Server will restart, poll until it's back
      setTimeout(() => {
        const poll = setInterval(() => {
          fetch("/api/health")
            .then((r) => { if (r.ok) { clearInterval(poll); window.location.reload(); } })
            .catch(() => {});
        }, 3000);
        // Stop polling after 3 min
        setTimeout(() => clearInterval(poll), 180000);
      }, 5000);
    } catch {
      setUpdating(false);
    }
  };

  if (!update?.updateAvailable || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-primary/95 text-primary-foreground backdrop-blur-sm">
      <div className="flex items-center justify-center gap-3 px-4 py-2 text-sm">
        <span className="font-medium">
          New update available
          {update.commits ? ` (${update.commits} commit${update.commits > 1 ? "s" : ""})` : ""}
          <span className="ml-2 text-xs opacity-70">{update.current} → {update.latest}</span>
        </span>
        <button
          onClick={handleUpdate}
          disabled={updating}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/20 hover:bg-white/30 px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          {updating ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Updating...</>
          ) : (
            <><Download className="h-3 w-3" /> Update Now</>
          )}
        </button>
        {!updating && (
          <button onClick={() => setDismissed(true)} className="ml-1 opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
