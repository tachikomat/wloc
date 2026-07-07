import { patchWithStats, randomPoint } from "./core.js"

// navigator.geolocation.getCurrentPosition((coords) => console.log(coords), console.error, {enableHighAccuracy:true })
export async function response() {
  const [lat, lng] = randomPoint(30.30329, 120.10133, 5)
  // const {
  //   results: [{ elevation }],
  // } = await fetch(
  //   `https://api.opentopodata.org/v1/srtm90m?locations=${lat},${lng}`,
  // ).then((res) => res.json())
  const altitude = 8 + Math.random()

  const { body, stats } = await patchWithStats(
    new Uint8Array($response.bodyBytes),
    {
      latitude: lat,
      longitude: lng,
      altitude,
      accuracy: 19 + Math.random() * 5,
    },
  )
  console.log(`stats: ${JSON.stringify(stats)}`)
  $done({
    bodyBytes: body.buffer,
  })
}
