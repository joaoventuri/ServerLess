"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Download, Upload, CheckCircle2, AlertCircle, Loader2, Settings } from "lucide-react";

export default function SettingsPage() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setResult(null);
    try {
      const token = localStorage.getItem("obb_token");
      const res = await fetch("/api/platform/export", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `serverless-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setResult({ type: "success", message: "Export downloaded successfully" });
    } catch (err: any) {
      setResult({ type: "error", message: err.message });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const confirmed = window.confirm(
        "WARNING: This will overwrite ALL existing data (users, servers, credentials, webhooks, etc.) with the data from the export file. This action cannot be undone.\n\nAre you sure you want to continue?"
      );
      if (!confirmed) return;

      setImporting(true);
      setResult(null);
      try {
        const text = await file.text();
        const payload = JSON.parse(text);

        if (!payload.version || !payload.data) {
          throw new Error("Invalid ServerLess export file");
        }

        const res = await api<{ success: boolean; stats: Record<string, number> }>("/platform/import", {
          method: "POST",
          body: payload,
        });

        const counts = Object.entries(res.stats)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ");

        setResult({
          type: "success",
          message: counts ? `Imported: ${counts}` : "All data already exists, nothing new to import",
        });
      } catch (err: any) {
        setResult({ type: "error", message: err.message });
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform configuration and data management</p>
      </div>

      {/* Export / Import */}
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-1">Platform Backup</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Export or import the entire ServerLess database — servers, credentials, health checks, webhooks, domains, stacks, backup schedules, and all configurations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-card/50 border-border">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Download className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Export</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Download a complete snapshot of this workspace. Use it to migrate to another ServerLess instance or as a full backup.
                  </p>
                  <Button onClick={handleExport} disabled={exporting} className="w-full">
                    {exporting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Exporting...</>
                    ) : (
                      <><Download className="h-4 w-4 mr-2" /> Export Database</>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-blue-500/10">
                  <Upload className="h-6 w-6 text-blue-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Import</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Restore from a ServerLess export file. Existing records are preserved — only new data is added.
                  </p>
                  <Button onClick={handleImport} disabled={importing} variant="outline" className="w-full">
                    {importing ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...</>
                    ) : (
                      <><Upload className="h-4 w-4 mr-2" /> Import Database</>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {result && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
            result.type === "success"
              ? "bg-green-500/10 text-green-400 border border-green-500/20"
              : "bg-red-500/10 text-red-400 border border-red-500/20"
          }`}>
            {result.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}
