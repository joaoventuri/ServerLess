"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { UpdateBanner } from "@/components/update-banner";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/lib/api";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, hydrate, setAuth, logout } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    const t = localStorage.getItem("obb_token");
    if (!t) {
      router.push("/login");
      return;
    }
    api("/auth/me")
      .then((data) => {
        setAuth({
          token: t,
          user: data.user,
          workspaces: data.workspaces,
          currentWorkspace: data.currentWorkspace,
        });
      })
      .catch(() => {
        logout();
        router.push("/login");
      });
  }, []);

  return (
    <div className="flex min-h-screen">
      <UpdateBanner />
      <Sidebar />
      <main className="flex-1 ml-64">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
