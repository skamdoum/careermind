import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TaskList from "./task-list";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AnalysisDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: analysis, error } = await supabase
    .from("analyses")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !analysis) {
    return <div>Analysis not found</div>;
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("analysis_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const { data: tasks } = plan
    ? await supabase
        .from("plan_tasks")
        .select("*")
        .eq("plan_id", plan.id)
        .order("priority", { ascending: true })
    : { data: [] };

  const data = analysis.raw_json;
  const totalTasks = tasks?.length || 0;
  const doneTasks = tasks?.filter((t: any) => t.status === "done").length || 0;
  const inProgressTasks =
    tasks?.filter((t: any) => t.status === "in_progress").length || 0;
  const notStartedTasks =
    tasks?.filter((t: any) => t.status === "not_started").length || 0;
  const completionPercent =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6 text-black">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Analysis</h1>
        <p className="text-sm text-gray-500">
          Review your fit, biggest gaps, and the highest-leverage next steps.
        </p>
      </div>

      <section className="border rounded p-5 bg-white shadow-sm">
    <h2 className="font-semibold text-lg mb-2">Verdict</h2>

    <div className="flex items-center justify-between">
      <div className="text-xl font-bold">
        {data?.core_verdict || "No verdict available"}
      </div>

      <div
        className={`px-3 py-1 rounded text-sm font-medium ${
          data?.core_verdict === "Strong Hire"
            ? "bg-green-100 text-green-800"
            : data?.core_verdict === "Borderline"
            ? "bg-yellow-100 text-yellow-800"
            : "bg-red-100 text-red-800"
        }`}
      >
        Hiring Signal
      </div>
    </div>
  </section>

      <section className="border rounded p-5 bg-white shadow-sm">
        <h2 className="font-semibold text-lg mb-3">Positioning Summary</h2>
        <p className="text-gray-800 leading-7">
          {analysis.summary || data?.positioning_summary}
        </p>
      </section>

      <section className="border rounded p-5 bg-green-50 shadow-sm">
        <h2 className="font-semibold text-lg mb-3">Next Best Action</h2>
        <p className="text-gray-900 font-medium leading-7">
          {plan?.next_best_action || data?.plan?.next_best_action}
        </p>
      </section>

      <section className="border rounded p-5 bg-white shadow-sm">
        <h2 className="font-semibold text-lg mb-4">Strength Signals</h2>

        <div className="space-y-3">
          {data?.signals?.map((s: any, i: number) => (
            <div key={i} className="border p-4 rounded bg-gray-50">
              <div className="flex items-start justify-between gap-3">
                <div className="font-medium">
                  {s.signal_name || s.name}
                </div>

                <div
                  className={`text-sm px-2 py-1 rounded font-medium ${
                    s.score >= 4
                      ? "bg-green-100 text-green-800"
                      : s.score === 3
                      ? "bg-yellow-100 text-yellow-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {s.score}/5
                </div>
              </div>

              <div className="text-sm text-gray-700 mt-2 leading-6">
                {s.rationale || s.reasoning}
              </div>

              {s.evidence?.length > 0 && (
                <ul className="list-disc pl-5 mt-2 text-sm text-gray-600 space-y-1">
                  {s.evidence.map((item: string, idx: number) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="border rounded p-5 bg-white shadow-sm">
        <h2 className="font-semibold text-lg mb-4">Key Gaps</h2>

        <div className="space-y-3">
          {data?.gaps?.map((g: any, i: number) => (
            <div key={i} className="border p-4 rounded bg-gray-50">
              <div className="font-medium">
                {g.gap_title || g.title || `Gap ${i + 1}`}
              </div>

              <div className="text-sm text-gray-700 mt-2 leading-6">
                {g.gap_description || g.description}
              </div>

              {g.recommended_fix && (
                <div className="text-sm text-gray-600 mt-2">
                  <span className="font-medium">Suggested fix:</span>{" "}
                  {g.recommended_fix}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="border rounded p-5 bg-white shadow-sm">
        <h2 className="font-semibold text-lg mb-2">Plan Execution</h2>

        <div className="border rounded p-4 bg-gray-50 mb-4 space-y-2">
          <h3 className="font-semibold">Progress</h3>

          <div className="text-sm text-gray-700">
            Total tasks: {totalTasks} | Done: {doneTasks} | In progress:{" "}
            {inProgressTasks} | Not started: {notStartedTasks}
          </div>

          <div className="w-full bg-gray-200 rounded h-3 overflow-hidden">
            <div
              className="bg-black h-3"
              style={{ width: `${completionPercent}%` }}
            />
          </div>

          <div className="text-sm font-medium">{completionPercent}% complete</div>
        </div>

        <TaskList tasks={tasks || []} />
      </section>
    </main>
  );
}