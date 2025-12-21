import fs from "fs";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function generateCalculatiePDF(calculatieId) {
  // 1. Haal alle regels op
  const { data: regels, error } = await supabase
    .from("calculatie_regels")
    .select(`
      hoeveelheid,
      materiaalprijs,
      loonkosten,
      normuren,
      arbeidsprijs,
      stabu_id,
      stabu_posten (code, omschrijving)
    `)
    .eq("calculatie_id", calculatieId)
    .order("stabu_id", { ascending: true });

  if (error) throw new Error(error.message);

  // 2. Haal calculatie subtotalen op
  const { data: calc, error: calcErr } = await supabase
    .from("calculaties")
    .select(`
      totaal,
      verkoopprijs,
      marge
    `)
    .eq("id", calculatieId)
    .single();

  if (calcErr) throw new Error(calcErr.message);

  // 3. Start PDF
  const doc = new PDFDocument({ margin: 50 });
  const pdfPath = `calculatie_${calculatieId}.pdf`;
  doc.pipe(fs.createWriteStream(pdfPath));

  // 4. Header
  doc.fontSize(16).text("Calculatie 2Jours Layout", { align: "center" });
  doc.moveDown();

  // 5. Tabel header
  doc.fontSize(10);
  doc.text("Code", 50);
  doc.text("Omschrijving", 120);
  doc.text("Hoeveelheid", 300, undefined, { width: 50, align: "right" });
  doc.text("Materiaalprijs", 360, undefined, { width: 60, align: "right" });
  doc.text("Loonkosten", 430, undefined, { width: 60, align: "right" });
  doc.text("Regel Totaal", 500, undefined, { width: 70, align: "right" });
  doc.moveDown();

  // 6. Tabel inhoud
  regels.forEach((r) => {
    const regelTotaal =
      (r.materiaalprijs + r.loonkosten) * r.hoeveelheid;

    doc.text(r.stabu_posten.code, 50);
    doc.text(r.stabu_posten.omschrijving, 120);
    doc.text(r.hoeveelheid.toFixed(2), 300, undefined, {
      width: 50,
      align: "right",
    });
    doc.text(r.materiaalprijs.toFixed(2), 360, undefined, {
      width: 60,
      align: "right",
    });
    doc.text(r.loonkosten.toFixed(2), 430, undefined, {
      width: 60,
      align: "right",
    });
    doc.text(regelTotaal.toFixed(2), 500, undefined, {
      width: 70,
      align: "right",
    });
    doc.moveDown();
  });

  // 7. Subtotaal en verkoopprijs
  doc.moveDown();
  doc.text(`Totaal calculatie: ${calc.totaal.toFixed(2)}`, 400, undefined, { align: "right" });
  doc.text(`Verkoopprijs: ${calc.verkoopprijs.toFixed(2)}`, 400, undefined, { align: "right" });
  doc.text(`Marge: ${calc.marge.toFixed(2)}`, 400, undefined, { align: "right" });

  doc.end();
  console.log("PDF gegenereerd:", pdfPath);
  return pdfPath;
}

// Gebruik:
// generateCalculatiePDF("0b03ddc3-db29-4637-b748-0659f5a6acf8");
