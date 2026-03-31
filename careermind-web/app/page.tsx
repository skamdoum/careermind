import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6 text-black">
      <h1 className="text-3xl font-bold">CareerMind</h1>
      <p className="text-gray-600">
        AI career copilot for PMs targeting competitive roles.
      </p>

      <div className="flex gap-3">
        <Link href="/login" className="px-4 py-2 bg-black text-white rounded">
          Login
        </Link>
        <Link href="/analyze" className="px-4 py-2 border rounded">
          Analyze Resume
        </Link>
        <Link href="/dashboard" className="px-4 py-2 border rounded">
          Dashboard
        </Link>
      </div>
    </main>
  );
}