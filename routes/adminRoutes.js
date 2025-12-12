import express from "express"
const router = express.Router()
router.get("/status", (req, res) => res.json({ status: "Admin actief" }))
export default router
