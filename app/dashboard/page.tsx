import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Insights from "./insights";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Overview</h1>
      <Insights mode="overview" />
    </>
  );
}
