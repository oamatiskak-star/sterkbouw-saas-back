import express from "express"
const router = express.Router()

router.get("/:submodule", async (req, res) => {
  const { submodule } = req.params

  // tijdelijk statisch, later live data
  const kpi = {
    systeem: [
      { key: "users", label: "Gebruikers", value: 12 },
      { key: "roles", label: "Rollen", value: 4 }
    ],
    calculaties: [
      { key: "aantal", label: "Calculaties", value: 38 },
      { key: "open", label: "Open", value: 6 }
    ]
  }

  res.json(kpi[submodule] || [])
})

export default router
