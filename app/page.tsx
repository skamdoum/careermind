import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white text-black">
      <div className="max-w-3xl mx-auto px-6 py-16 text-center space-y-6">
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight">CareerMind</h1>

        <p className="text-2xl md:text-3xl font-semibold text-gray-900">
          AI-powered career strategy for Senior PM roles.
        </p>

        <p className="text-gray-600 text-lg">
          Analyze your resume against real jobs, uncover recurring gaps, and get a prioritized plan to improve your positioning.
        </p>

        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/analyze" className="px-5 py-2.5 bg-black text-white rounded font-medium">
            Start Analysis
          </Link>
          <Link href="/dashboard" className="px-5 py-2.5 border rounded font-medium text-gray-800">
            View Dashboard
          </Link>
          <Link href="/login" className="px-5 py-2.5 rounded font-medium text-gray-500 hover:text-gray-800">
            Log in
          </Link>
        </div>

        <p className="text-sm text-gray-400">
          Built for experienced Product Managers targeting Senior and Principal roles.
        </p>
      </div>
    </main>
  );
}
