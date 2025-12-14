import express from "express"

const router = express.Router()

router.get("/", (req, res) => {
res.json({
projecten: 12,
calculaties: 8,
bouwsom: "€ 8.450.000",
risico: "Laag",
marge: "18%"
})
})

export default router
