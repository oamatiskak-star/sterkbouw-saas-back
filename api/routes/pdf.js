import express from "express";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/pdf/calculatie/:id
router.get("/calculatie/:id", async (req, res) => {
  const calculatieId = req.params.id;

  try {
    // -------------------------------
    // 1. Haal calculatie-regels op inclusief STABU info
    // -------------------------------
    const { data: regels, error: regErr } = await supabase
      .from("calculatie_regels")
      .select(`
        hoeveelheid,
        normuren,
        arbeidsprijs,
        loonkosten,
        materiaalprijs,
        stabu_id,
        stabu_posten (code, omschrijving, eenheid),
        hoofdstuk_id
      `)
      .eq("calculatie_id", calculatieId)
      .order("hoofdstuk_id", { ascending: true })
      .order("stabu_id", { ascending: true });

    if (regErr) throw new Error(regErr.message);

    // -------------------------------
    // 2. Haal calculatie subtotalen op
    // -------------------------------
    const { data: calc, error: calcErr } = await supabase
      .from("calculaties")
      .select(`
        totaal,
        verkoopprijs,
        marge,
        ak_pct,
        abk_pct,
        wr_pct
      `)
      .eq("id", calculatieId)
      .single();

    if (calcErr) throw new Error(calcErr.message);

    // -------------------------------
    // 3. Haal stelposten op
    // -------------------------------
    const { data: stelposten, error: stelErr } = await supabase
      .from("calculatie_stelposten")
      .select(`
        omschrijving,
        hoeveelheid,
        eenheid,
        prijs_excl_btw,
        prijs_incl_btw
      `)
      .eq("calculatie_id", calculatieId);

    if (stelErr) throw new Error(stelErr.message);

    // -------------------------------
    // 4. Haal STAARTBLAD info op
    // -------------------------------
    const { data: staart, error: staartErr } = await supabase
      .from("calculatie_staartblad")
      .select(`
        omschrijving,
        uren,
        uurloon,
        kostprijs,
        ak_pct,
        abk_pct,
        risico_pct,
        winst_pct,
        car_pct
      `)
      .eq("calculatie_id", calculatieId);

    if (staartErr) throw new Error(staartErr.message);

    // -------------------------------
    // 5. Start PDF
    // -------------------------------
    const doc = new PDFDocument({ margin: 50 });
    let chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=calculatie_${calculatieId}.pdf`
      );
      res.send(pdfBuffer);
    });

    doc.fontSize(16).text("Calculatie 2Jours Layout", { align: "center" });
    doc.moveDown();

    // -------------------------------
    // 6. Hoofdstukken + regels
    // -------------------------------
    let currentHoofdstuk = null;
    regels.forEach((r) => {
      if (r.hoofdstuk_id !== currentHoofdstuk) {
        currentHoofdstuk = r.hoofdstuk_id;
        doc.moveDown();
        doc.fontSize(12).text(`Hoofdstuk ${currentHoofdstuk}`, { underline: true });
        doc.moveDown(0.5);

        // Tabel header
        const headers = [
          "aantal", "eenh.", "uren", "loonkosten", "prijs/eenh.",
          "materiaal/eenh.", "o.a./eenh.", "o.a.", "stel/eenh.",
          "stelposten", "totaal"
        ];
        const xPositions = [50, 90, 130, 170, 220, 280, 340, 380, 420, 460, 500];
        headers.forEach((h, i) => doc.text(h, xPositions[i]));
        doc.moveDown(0.5);
      }

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
      const xPositions = [50, 90, 130, 170, 220, 280, 340, 380, 420, 460, 500];
      vals.forEach((v, i) => doc.text(v, xPositions[i]));
      doc.moveDown(0.5);
    });

    // -------------------------------
    // 7. Stelposten
    // -------------------------------
    doc.addPage().fontSize(12).text("Opgenomen stelposten", { underline: true });
    const stelHeaders = ["Omschrijving", "Aantal", "Eenh.", "Bruto Prijs", "Totaal excl. btw", "Totaal incl. btw"];
    const stelX = [50, 200, 250, 300, 370, 450];
    stelHeaders.forEach((h, i) => doc.text(h, stelX[i]));
    doc.moveDown(0.5);
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
      doc.moveDown(0.5);
    });

    // -------------------------------
    // 8. STAARTBLAD
    // -------------------------------
    doc.addPage().fontSize(12).text("STAARTBLAD", { underline: true });
    const staartHeaders = [
      "Omschrijving", "Uren", "Uurloon", "Kostprijs",
      "AK", "ABK", "Risico", "Winst", "CAR", "Subtotaal"
    ];
    const staartX = [50, 200, 250, 300, 350, 400, 450, 500, 550, 600];
    staartHeaders.forEach((h, i) => doc.text(h, staartX[i]));
    doc.moveDown(0.5);
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
      doc.moveDown(0.5);
    });

    // -------------------------------
    // 9. Totaalberekeningen
    // -------------------------------
    doc.addPage().fontSize(12).text("Totaal inclusief BTW", { underline: true });
    const totaalExclBtw = regels.reduce((sum, r) => sum + (r.loonkosten + r.materiaalprijs) * r.hoeveelheid, 0) +
                           stelposten.reduce((sum, s) => sum + s.prijs_excl_btw, 0);
    const btw21 = totaalExclBtw * 0.21;
    const btw9 = totaalExclBtw * 0.09; // als aparte posten
    const totaalIncl = totaalExclBtw + btw21 + btw9;

    doc.text(`Subtotaal excl. BTW: € ${totaalExclBtw.toFixed(2)}`);
    doc.text(`Btw 21%: € ${btw21.toFixed(2)}`);
    doc.text(`Btw 9%: € ${btw9.toFixed(2)}`);
    doc.text(`Totaal incl. BTW: € ${totaalIncl.toFixed(2)}`);

    doc.end();

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
