import fetch from "node-fetch"

const BRO_ENDPOINT =
  "https://publiek.broservices.nl/grondwatermonitoringnetwerken/v1"

export async function fetchBroFoundationData({ postcode, plaats }) {
  const query = `${BRO_ENDPOINT}/search?postcode=${postcode}&plaats=${plaats}`

  const res = await fetch(query)
  if (!res.ok) {
    throw new Error("BRO_FETCH_FAILED")
  }

  const json = await res.json()

  return json.results || []
}
