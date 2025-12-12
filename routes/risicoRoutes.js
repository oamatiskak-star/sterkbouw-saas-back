import express from "express"
import { getRisicoScore } from "../controllers/risicoController.js"
const router = express.Router()
router.get("/score", getRisicoScore)
export default router
