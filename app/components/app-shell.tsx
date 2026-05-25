"use client";

import AppNavbar from "@/app/components/app-navbar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl w-full mx-auto px-6 pt-6">
        <AppNavbar />
      </div>
      <div className="max-w-4xl w-full mx-auto px-6 py-6 space-y-6 text-black">
        {children}
      </div>
    </main>
  );
}
