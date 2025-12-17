import express from "express"
import createCalc from "./create.js"
import versions from "./versions.js"
import rows from "./rows.js"
import totals from "./totals.js"
import pdf from "./pdf.js"

const router = express.Router()

router.post("/create", createCalc)
router.get("/:calcId/versions", versions)
router.get("/:versionId/rows", rows)
router.get("/:versionId/totals", totals)
router.get("/:versionId/pdf", pdf)

export default router
