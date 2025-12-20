import express from "express"
import fs from "fs"
import { buildFactuurPdf } from "../services/factuurPdfService.js"

const router = express.Router()

router.get("/pdf/factuur/:factuurnummer", async (req, res) => {
  try {
    const { factuurnummer } = req.params

    const pdfPath = await buildFactuurPdf(factuurnummer)

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader(
      "Content-Disposition",
      `inline; filename="factuur-${factuurnummer}.pdf"`
    )

    const stream = fs.createReadStream(pdfPath)
    stream.pipe(res)
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: err.message
    })
  }
})

export default router
