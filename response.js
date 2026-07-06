import { patchWithStats, randomPoint } from "./core.js"

// navigator.geolocation.getCurrentPosition((coords) => console.log(coords), console.error, {enableHighAccuracy:true })

// TODO timer
const [lat, lng] = randomPoint(30.3031, 120.10137, 20)
// const {
//   results: [{ elevation }],
// } = await fetch(
//   `https://api.opentopodata.org/v1/srtm90m?locations=${lat},${lng}`,
// ).then((res) => res.json())
const altitude = 8 + Math.random()

patchWithStats(new Uint8Array($response.bodyBytes), {
  latitude: lat,
  longitude: lng,
  altitude,
  accuracy: 19 + Math.random() * 5,
})
  .then(({ body, stats }) => {
    console.log(`stats: ${JSON.stringify(stats)}`)
    $done({
      bodyBytes: body.buffer,
    })
  })
  .catch((err) => {
    console.error(`err: ${err}`)
  })
