import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();
const EXECUTOR_STATE_ID = "00000000-0000-0000-0000-000000000001";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post("/", async (req, res) => {
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "INVALID_JSON" });
  }

  const { workflow_key, project_id } = body || {};

  if (!workflow_key || !project_id) {
    return res.status(400).json({ error: "CONTEXT_REQUIRED" });
  }

  const { data: existing } = await supabase
    .from("executor_tasks")
    .select("id")
    .eq("project_id", project_id)
    .eq("task_type", workflow_key)
    .eq("status", "open")
    .maybeSingle();

  if (existing) {
    return res.status(409).json({
      error: "WORKFLOW_ALREADY_RUNNING"
    });
  }

  if (workflow_key === "analysis") {
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        analysis_status: "running",
        updated_at: new Date().toISOString()
      })
      .eq("id", project_id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
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

    const { error: taskError } = await supabase
      .from("executor_tasks")
      .insert({
        project_id,
        task_type: "analysis",
        status: "open",
        payload: { project_id }
      });

    if (taskError) {
      return res.status(500).json({ error: taskError.message });
    }
  } else {
    return res.status(400).json({
      error: "UNKNOWN_WORKFLOW"
    });
  }

  return res.status(200).json({
    ok: true,
    workflow_key,
    project_id
  });
});

export default router;
