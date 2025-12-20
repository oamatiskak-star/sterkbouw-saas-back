import { createClient } from "@supabase/supabase-js"
import { generateFactuurPdf } from "../pdf/generateFactuurPdf.js"
import path from "path"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function buildFactuurPdf(factuurnummer) {
  const { data: header } = await supabase
    .from("v_pdf_factuur_header")
    .select("*")
    .eq("factuurnummer", factuurnummer)
    .single()

  if (!header) {
    throw new Error("FACTUUR_HEADER_NIET_GEVONDEN")
  }

  const { data: regels } = await supabase
    .from("v_pdf_factuur_regels")
    .select("*")
    .eq("factuurnummer", factuurnummer)

  const { data: btw } = await supabase
    .from("v_pdf_factuur_btw")
    .select("*")
    .eq("factuurnummer", factuurnummer)

  const { data: totaal } = await supabase
    .from("v_pdf_factuur_totaal")
    .select("*")
    .eq("factuurnummer", factuurnummer)
    .single()

  const pdfData = {
    header: {
      bedrijfsnaam: header.bedrijfsnaam,
      adres: header.adres,
      postcode: header.postcode,
      plaats: header.plaats,
      kvk: header.kvk,
      btw: header.btw,
      factuurnummer: header.factuurnummer,
      datum: header.factuurdatum,
      projectnummer: header.projectnummer
    },
    regels: regels.map(r => ({
      code: r.stabu_code,
      omschrijving: r.omschrijving,
      aantal: r.hoeveelheid,
      eenheid: r.eenheid,
      mnorm: r.mnorm,
      uren: r.uren,
      loon: r.loonkosten,
      materiaal: r.prijs_materiaal,
      stelpost: r.stelpost,
      totaal: r.bedrag_incl_btw
    })),
    btw,
    totalen: {
      excl: totaal.totaal_excl_btw,
      btw: totaal.totaal_btw,
      incl: totaal.totaal_incl_btw
    }
  }

  const outputPath = path.resolve(
    `/tmp/factuur-${factuurnummer}.pdf`
  )

  await generateFactuurPdf(pdfData, outputPath)

  return outputPath
}
