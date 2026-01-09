import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();
const EXECUTOR_STATE_ID = "00000000-0000-0000-0000-000000000001";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post("/", async (req, res) => {
  try {
    const { project_id, options, uploaded_files } = req.body || {};

    if (!project_id) {
      return res.status(400).json({ error: "MISSING_PROJECT_ID" });
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
        action: "PROJECT_SCAN",
        status: "open",
        assigned_to: "executor",
        payload: {
          options: options || {},
          uploaded_files: uploaded_files || 0
        }
      });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ status: "OK", project_id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
