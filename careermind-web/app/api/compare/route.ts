import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase-admin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { resumeText, latestResume, jobDescriptions } = await req.json();

    if ((!resumeText && !latestResume?.file_path) || !jobDescriptions || jobDescriptions.length === 0) {
      return NextResponse.json({ error: "Missing input" }, { status: 400 });
    }

    let resumeContentParts: any[] = [];

    if (latestResume?.file_path) {
      const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from("resumes")
        .download(latestResume.file_path);

      if (downloadError) {
        throw downloadError;
      }

      const bytes = Buffer.from(await fileData.arrayBuffer());

      const openaiFile = await openai.files.create({
        file: new File([bytes], latestResume.file_name || "resume.pdf", {
          type: latestResume.mime_type || "application/octet-stream",
        }),
        purpose: "user_data",
      });

      resumeContentParts.push({
        type: "input_file",
        file_id: openaiFile.id,
      });
    }

    if (resumeText) {
      resumeContentParts.push({
        type: "input_text",
        text: `RESUME TEXT FALLBACK:\n${resumeText}`,
      });
    }

    const results = [];

    for (const jd of jobDescriptions) {
      const response = await openai.responses.create({
        model: "gpt-5.4",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: `You are CareerMind PM.

Analyze the candidate against the job description.

Return valid JSON with:
- company_name (string)
- core_verdict ("Strong Hire" | "Borderline" | "Below Bar")
- reasoning (short explanation)
- score (number from 1 to 5)

Be direct, specific, and decisive.`
              }
            ]
          },
          {
            role: "user",
            content: [
              ...resumeContentParts,
              {
                type: "input_text",
                text: `JOB DESCRIPTION:\n${jd}`
              }
            ]
          }
        ]
      });

      const text = response.output_text;
      console.log("COMPARE RAW OUTPUT:", text);

      const parsed = JSON.parse(text);
      results.push(parsed);
    }

    results.sort((a, b) => b.score - a.score);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("COMPARE API ERROR:", err);
    return NextResponse.json({ error: "Compare failed" }, { status: 500 });
  }
}