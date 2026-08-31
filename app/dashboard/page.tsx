import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Overview from "./Overview";
import PageHeader from "@/app/components/ui/PageHeader";

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
      <PageHeader
        title="Overview"
        description="Where you stand right now — the coaching insight, the patterns across your analyses, and the focus that will move the needle."
      />
      <Overview />
    </>
  );
}
