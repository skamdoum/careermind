import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Insights from "../insights";

export default async function StrategyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Action Plan</h1>
      <Insights mode="strategy" />
    </>
  );
}
