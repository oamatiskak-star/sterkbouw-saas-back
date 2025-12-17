import express from "express"
import modulesRoutes from "./modules.js"
import menuRoutes from "./menu.js"
import actionsRoutes from "./actions.js"

const router = express.Router()

router.use("/modules", modulesRoutes)
router.use("/menu", menuRoutes)
router.use("/actions", actionsRoutes)

export default router
