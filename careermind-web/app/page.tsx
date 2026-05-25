import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6 text-black">
      <section className="border rounded p-6 bg-white shadow-sm space-y-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">CareerMind</h1>
          <p className="text-gray-600 max-w-2xl">
            Land stronger PM roles with AI-powered resume analysis.
          </p>
          <p className="text-sm text-gray-500 max-w-2xl">
            Analyze your resume, identify gaps, and get a focused improvement plan.
          </p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Link
            href="/analyze"
            className="px-4 py-2 bg-black text-white rounded"
          >
            Start Analysis
          </Link>

          <Link
            href="/login"
            className="px-4 py-2 border rounded"
          >
            Log in
          </Link>

          <Link
            href="/dashboard"
            className="px-4 py-2 border rounded text-gray-700"
          >
            Dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}