import express from "express"
import modulesRoutes from "./modules.js"
import menuRoutes from "./menu.js"
import actionsRoutes from "./actions.js"
import kpiRoutes from "./kpi.js"
import uiRoutes from "./ui/index.js"

const router = express.Router()

router.use("/modules", modulesRoutes)
router.use("/menu", menuRoutes)
router.use("/actions", actionsRoutes)
router.use("/kpi", kpiRoutes)
router.use("/ui", uiRoutes)

export default router
