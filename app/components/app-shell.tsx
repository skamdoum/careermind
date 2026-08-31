"use client";

import AppNavbar from "@/app/components/app-navbar";

type Width = "reading" | "standard" | "wide";

const WIDTH_CLASSES: Record<Width, string> = {
  // ~48rem, comfortable line length for editorial reading
  reading: "max-w-[48rem]",
  // ~56rem, task-focused screens and forms
  standard: "max-w-[56rem]",
  // ~72rem, dashboards, tables, scan surfaces
  wide: "max-w-[72rem]",
};

/**
 * App shell. Renders the primary top bar full-width, then constrains
 * page content to one of three widths per §10 of the design audit.
 * Default is "standard" — pages opt into narrower (reading) or wider
 * (wide) explicitly.
 */
export default function AppShell({
  children,
  width = "standard",
}: {
  children: React.ReactNode;
  width?: Width;
}) {
  return (
    <main className="min-h-screen bg-[color:var(--color-page)] text-[color:var(--color-text-primary)]">
      <AppNavbar />
      <div className={`w-full mx-auto px-6 py-8 space-y-8 ${WIDTH_CLASSES[width]}`}>
        {children}
      </div>
    </main>
  );
}
