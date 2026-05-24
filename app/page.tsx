import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-black">
      <div className="max-w-5xl mx-auto px-6 py-14 space-y-20">

        {/* Hero */}
        <section className="text-center space-y-6">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">CareerMind</h1>
          <p className="text-2xl md:text-3xl font-semibold text-gray-900">
            AI-powered career strategy for Senior PM roles.
          </p>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Analyze your resume against real jobs, uncover recurring gaps, and get
            a prioritized plan to improve your positioning.
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
        </section>

        {/* Problem */}
        <section className="space-y-8">
          <h2 className="text-2xl font-bold text-center">
            Most PMs don't know why they're getting rejected.
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              "Feedback is vague or inconsistent",
              "Resume advice conflicts across sources",
              "You don't know what actually matters for senior roles",
            ].map((text, i) => (
              <div key={i} className="border rounded p-5 bg-white shadow-sm text-gray-700">
                {text}
              </div>
            ))}
          </div>
        </section>

        {/* Solution */}
        <section className="space-y-8">
          <h2 className="text-2xl font-bold text-center">
            CareerMind turns job applications into a structured career strategy.
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { step: "1", title: "Analyze your fit", desc: "Upload your resume and paste a job description. Get a structured evaluation of your strengths and gaps." },
              { step: "2", title: "Identify recurring gaps", desc: "Run multiple analyses to surface the patterns that consistently hold you back." },
              { step: "3", title: "Execute a focused plan", desc: "Follow a prioritized action plan built around your highest-leverage improvements." },
            ].map(({ step, title, desc }) => (
              <div key={step} className="border rounded p-5 bg-white shadow-sm space-y-2">
                <div className="w-7 h-7 rounded-full bg-black text-white text-sm font-semibold flex items-center justify-center">
                  {step}
                </div>
                <div className="font-semibold">{title}</div>
                <div className="text-sm text-gray-600">{desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Differentiation */}
        <section className="space-y-8">
          <h2 className="text-2xl font-bold text-center">Not another resume tool.</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded p-5 bg-white shadow-sm space-y-3">
              <div className="font-semibold text-gray-500">Typical tools</div>
              <ul className="text-sm text-gray-600 space-y-2">
                {["Generic advice", "One-off feedback", "No prioritization"].map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-gray-300">—</span> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border rounded p-5 bg-black text-white shadow-sm space-y-3">
              <div className="font-semibold">CareerMind</div>
              <ul className="text-sm space-y-2">
                {["Structured evaluation", "Cross-job insights", "Prioritized action plan"].map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-gray-400">✓</span> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center space-y-6 pb-8">
          <h2 className="text-2xl font-bold">Stop guessing. Start improving.</h2>
          <Link href="/analyze" className="inline-block px-6 py-3 bg-black text-white rounded font-medium">
            Start Analysis
          </Link>
        </section>

      </div>
    </main>
  );
}
