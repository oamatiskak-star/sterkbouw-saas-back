import express from "express"
import modules from "./modules.js"

const router = express.Router()

router.use("/modules", modules)

export default router
