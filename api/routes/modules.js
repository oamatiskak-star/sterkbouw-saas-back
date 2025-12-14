import express from "express"

const router = express.Router()

router.get("/", (req, res) => {
  res.json({
    ok: true,
    modules: [
      {
        key: "calculaties",
        label: "Calculaties",
        path: "/calculator",
        description: "STABU en Fixed Price calculaties"
      },
      {
        key: "projecten",
        label: "Projecten",
        path: "/projecten",
        description: "Projectbeheer en voortgang"
      },
      {
        key: "bim",
        label: "BIM Architectuur",
        path: "/bim",
        description: "BIM modellen en uploads"
      },
      {
        key: "risico",
        label: "Risico Analyse",
        path: "/risico",
        description: "Risico en haalbaarheid"
      },
      {
        key: "constructeurs",
        label: "Constructeurs",
        path: "/constructeurs",
        description: "Constructieve berekeningen"
      },
      {
        key: "kopersportaal",
        label: "Kopersportaal",
        path: "/kopersportaal",
        description: "Kopers en huurders"
      },
      {
        key: "team",
        label: "Teambeheer",
        path: "/team",
        description: "Gebruikers en rollen"
      },
      {
        key: "notificaties",
        label: "Notificaties",
        path: "/notificaties",
        description: "Systeemmeldingen"
      }
    ]
  })
})

export default router
