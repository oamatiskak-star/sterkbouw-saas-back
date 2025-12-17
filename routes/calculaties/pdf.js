import puppeteer from "puppeteer"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const { versionId } = req.params

  const { data: rows } = await supabase
    .from("calc_rows")
    .select("*")
    .eq("calc_version_id", versionId)
    .order("discipline")

  const { data: totals } = await supabase
    .from("calc_totals")
    .select("*")
    .eq("calc_version_id", versionId)
    .single()

  const html = `
    <html>
    <head>
      <style>
        body { font-family: Arial; font-size: 10px; }
        table { width:100%; border-collapse: collapse; }
        th, td { border:1px solid #000; padding:4px; }
      </style>
    </head>
    <body>
      <h2>Calculatie overzicht</h2>
      <table>
        <tr>
          <th>Discipline</th>
          <th>STABU</th>
          <th>Omschrijving</th>
          <th>Hoev</th>
          <th>Eenheid</th>
          <th>Norm h</th>
          <th>Totaal h</th>
          <th>Arbeid €</th>
          <th>Materiaal €</th>
          <th>Inkoop €</th>
          <th>Totaal €</th>
        </tr>
        ${rows.map(r => `
          <tr>
            <td>${r.discipline}</td>
            <td>${r.stabu_code}</td>
            <td>${r.omschrijving}</td>
            <td>${r.hoeveelheid}</td>
            <td>${r.eenheid}</td>
            <td>${r.norm_uren_per_eenheid}</td>
            <td>${r.totaal_normuren}</td>
            <td>${r.arbeidskosten_totaal}</td>
            <td>${r.materiaal_totaal}</td>
            <td>${r.inkoop_totaal}</td>
            <td>${r.regel_totaal}</td>
          </tr>
        `).join("")}
      </table>

      <h3>Eindtotaal: € ${totals.eindtotaal}</h3>
    </body>
    </html>
  `

  const browser = await puppeteer.launch({
    args: ["--no-sandbox"]
  })
  const page = await browser.newPage()
  await page.setContent(html)
  const pdf = await page.pdf({ format: "A4" })
  await browser.close()

  res.setHeader("Content-Type", "application/pdf")
  res.send(pdf)
}
