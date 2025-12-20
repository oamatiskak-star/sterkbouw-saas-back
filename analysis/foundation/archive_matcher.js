export function matchArchiveData({ bouwjaar, regio }) {
  if (!bouwjaar) return null

  if (bouwjaar < 1970) {
    return {
      type: "Houten palen",
      risico: "hoog",
      toelichting: "Bouwjaar < 1970, verhoogd risico paalrot"
    }
  }

  if (bouwjaar < 1990) {
    return {
      type: "Betonpalen",
      risico: "middel",
      toelichting: "Overgangsperiode betonpalen"
    }
  }

  return {
    type: "Moderne fundering",
    risico: "laag",
    toelichting: "Na 1990 standaard beton/poeren"
  }
}
