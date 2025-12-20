import express from "express"
import { runInitializationOrchestrator } from "../../services/initialization_orchestrator.js"

const router = express.Router()

router.post("/run-initialization", async (req, res) => {
  try {
    const { project_id, options } = req.body

    if (!project_id || !options) {
      return res.status(400).json({ error: "INVALID_PAYLOAD" })
    }

    const result = await runInitializationOrchestrator({
      project_id,
      options
    })

    res.json({ status: "ok", result })
  } catch (err) {
    console.error("INIT ERROR:", err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
