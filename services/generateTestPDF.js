import fs from "fs";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function generateTestPDF(calculatieId) {
  // -------------------------------
  // Haal calculatie-data
  // -------------------------------
  const { data: regels } = await supabase
    .from("calculatie_regels")
    .select(`
      hoeveelheid, normuren, arbeidsprijs, loonkosten, materiaalprijs,
      stabu_posten(code, omschrijving, eenheid)
    `)
    .eq("calculatie_id", calculatieId);

  const { data: stelposten } = await supabase
    .from("calculatie_stelposten")
    .select("*")
    .eq("calculatie_id", calculatieId);

  const { data: staart } = await supabase
    .from("calculatie_staartblad")
    .select("*")
    .eq("calculatie_id", calculatieId);

  const { data: calc } = await supabase
    .from("calculaties")
    .select("totaal, verkoopprijs, marge")
    .eq("id", calculatieId)
    .single();

  // -------------------------------
  // Start PDF
  // -------------------------------
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream("test_calculatie_2jours.pdf"));

  doc.fontSize(16).text("Calculatie 2Jours Layout", { align: "center" });
  doc.moveDown();

  // -------------------------------
  // Hoofdtabel
  // -------------------------------
  const xPositions = [50, 90, 130, 170, 220, 280, 340, 380, 420, 460, 500];
  const headers = [
    "aantal", "eenh.", "uren", "loonkosten", "prijs/eenh.",
    "materiaal/eenh.", "o.a./eenh.", "o.a.", "stel/eenh.",
    "stelposten", "totaal"
  ];
  headers.forEach((h, i) => doc.text(h, xPositions[i]));
  doc.moveDown();

  regels.forEach((r) => {
    const totaal = (r.materiaalprijs + r.loonkosten) * r.hoeveelheid;
    const vals = [
      r.hoeveelheid.toFixed(3),
      r.stabu_posten.eenheid || "",
      r.normuren.toFixed(3),
      r.loonkosten.toFixed(2),
      r.arbeidsprijs.toFixed(2),
      r.materiaalprijs.toFixed(2),
      "0.00", "0.00", "0.00", "0.00", totaal.toFixed(2)
    ];
    vals.forEach((v, i) => doc.text(v, xPositions[i]));
    doc.moveDown();
  });

  // -------------------------------
  // Stelposten
  // -------------------------------
  doc.addPage().text("Opgenomen stelposten", { underline: true });
  const stelX = [50, 200, 250, 300, 370, 450];
  const stelHeaders = ["Omschrijving", "Aantal", "Eenh.", "Bruto Prijs", "Totaal excl. btw", "Totaal incl. btw"];
  stelHeaders.forEach((h, i) => doc.text(h, stelX[i]));
  doc.moveDown();

  stelposten.forEach((s) => {
    const vals = [
      s.omschrijving,
      s.hoeveelheid.toFixed(3),
      s.eenheid,
      s.prijs_excl_btw.toFixed(2),
      s.prijs_excl_btw.toFixed(2),
      s.prijs_incl_btw.toFixed(2)
    ];
    vals.forEach((v, i) => doc.text(v, stelX[i]));
    doc.moveDown();
  });

  // -------------------------------
  // STAARTBLAD
  // -------------------------------
  doc.addPage().text("STAARTBLAD", { underline: true });
  const staartX = [50, 200, 250, 300, 350, 400, 450, 500, 550, 600];
  const staartHeaders = [
    "Omschrijving", "Uren", "Uurloon", "Kostprijs",
    "AK", "ABK", "Risico", "Winst", "CAR", "Subtotaal"
  ];
  staartHeaders.forEach((h, i) => doc.text(h, staartX[i]));
  doc.moveDown();

  staart.forEach((s) => {
    const subtotaal =
      s.kostprijs * (1 + s.ak_pct / 100 + s.abk_pct / 100 + s.risico_pct / 100 + s.winst_pct / 100 + s.car_pct / 100);
    const vals = [
      s.omschrijving,
      s.uren.toFixed(2),
      s.uurloon.toFixed(2),
      s.kostprijs.toFixed(2),
      (s.kostprijs * s.ak_pct / 100).toFixed(2),
      (s.kostprijs * s.abk_pct / 100).toFixed(2),
      (s.kostprijs * s.risico_pct / 100).toFixed(2),
      (s.kostprijs * s.winst_pct / 100).toFixed(2),
      (s.kostprijs * s.car_pct / 100).toFixed(2),
      subtotaal.toFixed(2)
    ];
    vals.forEach((v, i) => doc.text(v, staartX[i]));
    doc.moveDown();
  });

  // -------------------------------
  // Subtotaal + BTW
  // -------------------------------
  doc.addPage().text("Totaal inclusief BTW", { underline: true });
  const totaalExclBtw = regels.reduce((sum, r) => sum + (r.loonkosten + r.materiaalprijs) * r.hoeveelheid, 0) +
                         stelposten.reduce((sum, s) => sum + s.prijs_excl_btw, 0);
  const btw21 = totaalExclBtw * 0.21;
  const btw9 = totaalExclBtw * 0.09;
  const totaalIncl = totaalExclBtw + btw21 + btw9;

  doc.text(`Subtotaal excl. BTW: € ${totaalExclBtw.toFixed(2)}`);
  doc.text(`Btw 21%: € ${btw21.toFixed(2)}`);
  doc.text(`Btw 9%: € ${btw9.toFixed(2)}`);
  doc.text(`Totaal incl. BTW: € ${totaalIncl.toFixed(2)}`);

  doc.end();
}

generateTestPDF("0b03ddc3-db29-4637-b748-0659f5a6acf8")
  .then(() => console.log("Test PDF succesvol gegenereerd!"))
  .catch((err) => console.error(err));
