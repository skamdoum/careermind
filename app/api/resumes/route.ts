import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: userError?.message || "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { filePath, fileName, mimeType } = body;

    if (!filePath || !fileName) {
      return NextResponse.json(
        { error: "Missing filePath or fileName" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("resumes")
      .insert({
        user_id: user.id,
        file_path: filePath,
        file_name: fileName,
        mime_type: mimeType || null,
        is_primary: true,
        version: 1,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, resume: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to save resume metadata" },
      { status: 500 }
    );
  }
}