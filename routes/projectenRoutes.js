import express from "express"
import { getProjecten } from "../controllers/projectenController.js"
const router = express.Router()
router.get("/", getProjecten)
export default router
