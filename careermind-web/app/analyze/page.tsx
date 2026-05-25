"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AppNavbar from "@/app/components/app-navbar";

export default function AnalyzePage() {
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedResume, setUploadedResume] = useState<any>(null);
  const [latestResume, setLatestResume] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState("No request yet");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [jobInputs, setJobInputs] = useState(["", "", ""]);
  const [compareResults, setCompareResults] = useState<any[]>([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
  async function loadUserAndResume() {
    // 👉 RESET UI STATE FIRST
    setResult(null);
    setStatus("Ready to analyze your profile");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    console.log("Loaded user:", user, userError);

    if (!user) {
      setUserId(null);
      return;
    }

    setUserId(user.id);

    const res = await fetch("/api/resumes/latest");
    const data = await res.json();

    if (!res.ok) {
      if (data.code === "LIMIT_REACHED") {
        setStatus("You’ve reached the free limit (3 analyses). Upgrade to continue.");
        return;
      }

      setStatus(data.error || "Analyze failed");
      return;
    }

    // 👉 SET LATEST RESUME IF EXISTS
    if (data?.resume) {
      setLatestResume(data.resume);
    }
  }

  loadUserAndResume();
}, []);

async function handleUploadResume() {
  if (!selectedFile) {
    setStatus("Select a file first");
    return;
  }

  setUploading(true);
  setStatus("Preparing resume...");

  try {
    // Logged-in users: upload to Supabase Storage + save metadata
    if (userId) {
      const fileExt = selectedFile.name.split(".").pop();
      const filePath = `${userId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(filePath, selectedFile, {
          upsert: false,
          contentType: selectedFile.type,
        });

      if (uploadError) {
        throw uploadError;
      }

      const res = await fetch("/api/resumes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath,
          fileName: selectedFile.name,
          mimeType: selectedFile.type,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save resume metadata");
      }

      setUploadedResume(data.resume);
      setLatestResume(data.resume);
      setStatus(userId ? "Resume uploaded successfully" : "Resume ready for analysis");
    } else {
      // Guest users: do NOT upload to Supabase Storage
      // Just keep the selected file locally for analysis
      setUploadedResume({
        file_name: selectedFile.name,
        mime_type: selectedFile.type,
        guest: true,
      });
      setStatus("Resume ready for analysis");
    }
  } catch (error: any) {
    console.error(error);
    setStatus(error.message || "Upload failed");
  } finally {
    setUploading(false);
  }
}

async function handleAnalyze() {
  setLoading(true);
  setStatus("Analyzing your profile...");
  setResult(null);

  try {
    // Guest mode: send as FormData if file is local only
    if (!userId && selectedFile) {
      const formData = new FormData();
      formData.append("jobDescription", jobDescription);
      formData.append("targetRole", "PM");
      formData.append("targetLevel", "Senior");
      formData.append("resumeFile", selectedFile);

      if (resumeText) {
        formData.append("resumeText", resumeText);
      }

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.code === "LIMIT_REACHED") {
          setStatus("You’ve reached the free limit. Upgrade to continue.");
          return;
        }

        setStatus(data.error || "Analyze failed");
        setResult({ error: data.error || "Analyze failed" });
        return;
      }

      setStatus("Analysis complete");
      setResult(data.result);
      return;
    }

    // Logged-in flow: existing JSON body
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        resumeText,
        jobDescription,
        targetRole: "PM",
        targetLevel: "Senior",
        latestResume,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.code === "LIMIT_REACHED") {
        setStatus("You’ve reached the free limit. Upgrade to continue.");
        return;
      }

      setStatus(data.error || "Analyze failed");
      setResult({ error: data.error || "Analyze failed" });
      return;
    }

    setStatus("Analysis complete");
    setResult(data.result);
  } catch (error) {
    console.error(error);
    setStatus("Request failed");
    setResult({ error: "Request failed" });
  } finally {
    setLoading(false);
  }
}

  async function handleCompare() {
  const filteredJobs = jobInputs.filter((j) => j.trim() !== "");

  if ((!latestResume && !resumeText) || filteredJobs.length < 2) {
    setStatus("Upload a resume (or paste resume text) and provide at least 2 job descriptions");
    return;
  }

  setComparing(true);
  setStatus("Comparing jobs...");
  setCompareResults([]);

  try {
    const res = await fetch("/api/compare", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resumeText,
        latestResume,
        jobDescriptions: filteredJobs,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Compare failed");
    }

    setCompareResults(data.results || []);
    setStatus("Job comparison complete");
  } catch (error: any) {
    console.error(error);
    setStatus(error.message || "Compare failed");
  } finally {
    setComparing(false);
  }
}

function getRecommendation(results: any[]) {
  if (!results || results.length === 0) return null;

  const top = results[0];
  const weak = results.find((r) => r.core_verdict === "Below Bar");

  let message = "";

  if (top) {
    message += `Focus on ${top.company_name || "the top-ranked role"} first — strongest fit.\n`;
  }

  const borderline = results.find((r) => r.core_verdict === "Borderline");

  if (borderline) {
    message += `\n${borderline.company_name || "Another role"} is viable but requires improvement.`;
  }

  if (weak) {
    message += `\n\nAvoid ${weak.company_name || "this role"} for now — below the bar based on current profile.`;
  }

  return message;
}
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6 text-black">
  <AppNavbar />

  <div className="space-y-2">
        <h1 className="text-3xl font-bold">Analyze Your Fit</h1>
        <p className="text-gray-600 max-w-2xl">
          Upload your resume, paste a target job description, and get a structured
          evaluation of your strengths, biggest gaps, and highest-leverage next steps.
        </p>
      </div>

      <section className="border rounded p-5 bg-white shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-lg">Step 1 — Upload Resume</h2>
        <p className="text-sm text-gray-600 mb-1">
        Upload your resume to get started.
        </p>
        <p className="text-xs text-gray-500 mb-4">
          Try CareerMind instantly. Log in to save analyses and track progress over time.
        </p>
        </div>

        {latestResume ? (
          <div className="p-3 bg-blue-50 border rounded">
            <div className="text-xs text-gray-600">Using latest resume</div>
            <div className="font-medium">{latestResume.file_name}</div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">No resume uploaded yet</div>
        )}

        <input
          type="file"
          accept=".pdf,.doc,.docx,.txt"
          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
        />
        <div className="text-sm text-gray-500">
  Selected file: {selectedFile ? selectedFile.name : "none"}
</div>

        <div className="flex gap-2">
<button
  className="px-5 py-3 rounded bg-black text-white disabled:opacity-50"
  onClick={handleUploadResume}
  disabled={uploading || !selectedFile}
>
  {uploading
    ? userId
      ? "Uploading..."
      : "Preparing..."
    : userId
      ? "Upload Resume"
      : "Use Resume for Analysis"}
</button>
        </div>

{!userId && (
  <div className="text-xs text-gray-500 mt-2">
    Your resume will not be saved unless you log in.
  </div>
)}

        {uploadedResume && (
          <div className="text-sm text-green-700">
            Uploaded: {uploadedResume.file_name}
          </div>
        )}

        <div className="text-xs text-gray-500">
          You can also paste resume text below as a fallback, but uploaded resume is preferred.
        </div>
      </section>

      <section className="border rounded p-5 bg-white shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-lg">Step 2 — Target Role</h2>
          <p className="text-sm text-gray-600">
            Paste the job description for the role you want to evaluate against.
          </p>
        </div>

        <textarea
          className="w-full border rounded p-3 min-h-[220px]"
          placeholder="Paste job description here"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
        />
      </section>

<section className="border rounded p-5 bg-white shadow-sm space-y-4">
  <div>
    <h2 className="font-semibold text-lg">Compare Multiple Jobs</h2>
    <p className="text-sm text-gray-600">
      Paste 2–3 job descriptions to see where you are strongest and where to focus.
    </p>
  </div>

  <div className="space-y-3">
    {jobInputs.map((job, i) => (
      <textarea
        key={i}
        value={job}
        onChange={(e) => {
          const updated = [...jobInputs];
          updated[i] = e.target.value;
          setJobInputs(updated);
        }}
        className="w-full border rounded p-3 min-h-[140px]"
        placeholder={`Job description ${i + 1}`}
      />
    ))}
  </div>

  <button
    onClick={handleCompare}
    className="px-5 py-3 rounded bg-black text-white disabled:opacity-50 w-full"
    disabled={comparing || (!latestResume && !resumeText)}
  >
    {comparing ? "Comparing..." : "Compare Jobs"}
  </button>

  {compareResults.length > 0 && (
    <div className="space-y-3 pt-2">
      <h3 className="font-semibold">Comparison Results</h3>

      <div className="border p-4 rounded bg-blue-50">
  <div className="font-semibold mb-2">🎯 Recommendation</div>
  <div className="text-sm whitespace-pre-line">
    {getRecommendation(compareResults)}
  </div>
</div>

      {compareResults.map((r, i) => (
        <div key={i} className="border p-4 rounded bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="font-medium">
              #{i + 1} — {r.company_name || `Job ${i + 1}`}
            </div>

            <div
              className={`px-2 py-1 rounded text-sm font-medium ${
                r.core_verdict === "Strong Hire"
                  ? "bg-green-100 text-green-800"
                  : r.core_verdict === "Borderline"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {r.core_verdict}
            </div>
          </div>

          <div className="text-sm text-gray-600 mt-1">
            Score: {r.score}/5
          </div>

          <div className="text-sm text-gray-700 mt-2">
            {r.reasoning}
          </div>
        </div>
      ))}
    </div>
  )}
</section>

      <section className="border rounded p-5 bg-white shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-lg">Optional Fallback</h2>
          <p className="text-sm text-gray-600">
            If you do not want to rely on the uploaded resume, you can paste resume text here.
          </p>
        </div>

        <textarea
          className="w-full border rounded p-3 min-h-[180px]"
          placeholder="Optional: paste resume text"
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
        />
      </section>

<section className="border rounded p-5 bg-white shadow-sm space-y-4">
  <div>
    <h2 className="font-semibold text-lg">Step 3 — Analyze</h2>
    <p className="text-sm text-gray-600">
      CareerMind will evaluate fit, identify gaps, and generate an action plan.
    </p>
  </div>

<button
  className="px-5 py-3 rounded bg-black text-white disabled:opacity-50 w-full"
  onClick={handleAnalyze}
  disabled={
    loading ||
    (!selectedFile && !latestResume && !resumeText) ||
    !jobDescription
  }
>
  {loading ? "Analyzing..." : "Run Analysis"}
</button>

<div className="text-xs text-gray-500">
  userId: {userId || "guest"} | selectedFile: {selectedFile ? selectedFile.name : "none"} | latestResume: {latestResume ? "yes" : "no"} | resumeText: {resumeText ? "yes" : "no"} | jobDescription: {jobDescription ? "yes" : "no"}
</div>

  <div className="mt-2 text-xs text-gray-500">
  No account required to try. Log in to save your results.
</div>

<div className="mt-3 space-y-3">
  <div className="text-sm text-gray-500">
    Free tier includes up to 3 analyses.
  </div>

  {status?.toLowerCase().includes("limit") && (
    <div className="p-4 border rounded bg-yellow-50">
      <div className="font-semibold mb-1">Free limit reached</div>
      <div className="text-sm text-gray-700 mb-3">
        You’ve used your 3 free analyses. Upgrade for unlimited analyses and deeper ongoing career insights.
      </div>

      <button
        className="px-4 py-2 bg-black text-white rounded"
        onClick={() => alert("Upgrade flow coming soon")}
      >
        Upgrade
      </button>
    </div>
  )}
</div>

<div className="border rounded p-3 bg-gray-50 text-sm">
  {status || "Ready to analyze your profile"}
</div>
</section>

      {result && (
        <div className="space-y-4">
          <section className="border rounded p-5 bg-white shadow-sm">
            <h2 className="font-semibold text-lg mb-3">Positioning Summary</h2>
            <p className="text-gray-800 leading-7">
              {result.positioning_summary}
            </p>
          </section>

          <section className="border rounded p-5 bg-green-50 shadow-sm">
            <h2 className="font-semibold text-lg mb-3">Next Best Action</h2>
            <p className="text-gray-900 font-medium leading-7">
              {result.plan?.next_best_action}
            </p>
          </section>

          <section className="border rounded p-5 bg-white shadow-sm">
            <h2 className="font-semibold text-lg mb-3">Top Gaps</h2>
            <div className="space-y-3">
              {result.gaps?.slice(0, 3).map((gap: any, i: number) => (
                <div key={i} className="border p-3 rounded bg-gray-50">
                  <div className="font-medium">
                    {gap.gap_title || `Gap ${i + 1}`}
                  </div>
                  <div className="text-sm text-gray-700 mt-1">
                    {gap.gap_description}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="flex gap-2">
            <button
              onClick={() => (window.location.href = "/dashboard")}
              className="px-4 py-2 bg-black text-white rounded"
            >
              Go to Dashboard
            </button>

            <button
              onClick={() => setResult(null)}
              className="px-4 py-2 border rounded"
            >
              Run Another Analysis
            </button>
          </div>
        </div>
      )}
    </main>
  );
}