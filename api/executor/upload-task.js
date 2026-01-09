import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();
const EXECUTOR_STATE_ID = "00000000-0000-0000-0000-000000000001";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post("/", async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = req.body || {};
    const { project_id, files } = body;

    if (!project_id) {
      return res.status(400).json({ error: "MISSING_PROJECT_ID" });
    }

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "NO_FILES" });
    }

    for (const f of files) {
      if (!f.filename) {
        return res.status(400).json({ error: "FILE_MISSING_FILENAME" });
      }
    }

    const { error: stateError } = await supabase
      .from("executor_state")
      .upsert({
        id: EXECUTOR_STATE_ID,
        allowed: true,
        updated_at: new Date().toISOString()
      }, { onConflict: "id" });

    if (stateError) {
      return res.status(500).json({ error: stateError.message });
    }

    const { error } = await supabase
      .from("executor_tasks")
      .insert({
        project_id,
        action: "upload_files",
        status: "open",
        assigned_to: "executor",
        payload: {
          project_id,
          files: files.map(f => ({
            filename: f.filename,
            mime_type: f.mime_type || "application/octet-stream"
          }))
        }
      });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({
      status: "OK",
      project_id,
      files: files.length
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
