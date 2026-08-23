import { redirect } from "next/navigation";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ all?: string }>;
};

export default async function HistoryPage({ searchParams }: PageProps) {
  const { all } = await searchParams;
  const showAll = all === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const activeProfile = await resolveActiveCareerProfile(supabase, user.id);

  const { data: analyses, error } = await supabase
    .from("analyses")
    .select("id, summary, created_at, raw_json")
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfile.id)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <>
        <h1 className="text-2xl font-bold mb-4">History error</h1>
        <pre className="bg-gray-100 p-4 rounded whitespace-pre-wrap text-sm">
          {JSON.stringify(error, null, 2)}
        </pre>
      </>
    );
  }

  const totalAnalyses = analyses?.length || 0;
  const visibleAnalyses = showAll ? analyses : analyses?.slice(0, 5);

  return (
    <>
      <h1 className="text-2xl font-bold">History</h1>

      {analyses?.length === 0 && (
        <div className="text-gray-500">
          No analyses yet. Run your first analysis to get started.
        </div>
      )}

      {visibleAnalyses?.map((a) => {
        const verdict = a.raw_json?.core_verdict;
        return (
          <a
            key={a.id}
            href={`/dashboard/${a.id}`}
            className="block border rounded p-4 hover:bg-gray-50 cursor-pointer"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm text-gray-500">
                {new Date(a.created_at).toLocaleString()}
              </div>
              {verdict && (
                <span
                  className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap ${
                    verdict === "Strong Hire"
                      ? "bg-green-100 text-green-800"
                      : verdict === "Borderline"
                      ? "bg-yellow-100 text-yellow-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {verdict}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-800 line-clamp-2 mt-1">
              {a.summary || "No summary"}
            </div>
            <div className="text-xs text-blue-600 mt-2">View analysis →</div>
          </a>
        );
      })}

      {!showAll && totalAnalyses > 5 && (
        <a
          href="?all=1"
          className="block text-center text-sm text-blue-600 underline py-2"
        >
          Show all analyses ({totalAnalyses})
        </a>
      )}
    </>
  );
}
