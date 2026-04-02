import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Insights from "./insights";
import AppNavbar from "@/app/components/app-navbar";

export default async function DashboardPage() {
  const supabase = await createClient();
  

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: analyses, error } = await supabase
    .from("analyses")
    .select("id, summary, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

if (error) {
  return (
    <main className="max-w-4xl mx-auto p-6 text-black">
      <h1 className="text-2xl font-bold mb-4">Dashboard error</h1>
      <pre className="bg-gray-100 p-4 rounded whitespace-pre-wrap text-sm">
        {JSON.stringify(error, null, 2)}
      </pre>
    </main>
  );
}

  return (
    
   <main className="max-w-4xl mx-auto p-6 space-y-6 text-black">
  <AppNavbar />

  <div className="flex items-center justify-between">
    <h1 className="text-2xl font-bold">Your Analyses</h1>
  </div>

<Insights className="mb-6" />

      {analyses?.length === 0 && <div className="text-gray-500">
  No analyses yet. Run your first analysis to get started.
   </div>}

      {analyses?.map((a) => (
        <a
          key={a.id}
          href={`/dashboard/${a.id}`}
          className="block border rounded p-4 hover:bg-gray-50 cursor-pointer"
        >
          <div className="text-sm text-gray-500">
            {new Date(a.created_at).toLocaleString()}
          </div>
          <div className="font-medium">{a.summary || "No summary"}</div>
        </a>
      ))}
      
    </main>
  );
}