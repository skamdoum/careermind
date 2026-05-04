import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Insights from "../insights";
import AppNavbar from "@/app/components/app-navbar";

export default async function StrategyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6 text-black">
      <AppNavbar />
      <h1 className="text-2xl font-bold">Action Plan</h1>
      <Insights mode="strategy" />
    </main>
  );
}
