import AppShell from "@/app/components/app-shell";

/**
 * Dashboard layout uses the "wide" content width — most dashboard
 * screens (Overview, Goals, History, Action Plan) are scan surfaces
 * and benefit from horizontal room. Reading-focused pages (Strategy,
 * Analysis Detail) constrain their own content to a narrower reading
 * column via an inner max-width wrapper.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell width="wide">{children}</AppShell>;
}
