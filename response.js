import { patchWithStats, randomPoint } from "./core.js"

// navigator.geolocation.getCurrentPosition((coords) => console.log(coords), console.error, {enableHighAccuracy:true })

// TODO timer
const [lat, lng] = randomPoint(30.83556037963936, 120.10123587878017, 20)
patchWithStats(new Uint8Array($response.bodyBytes), {
  latitude: lat,
  longitude: lng,
  altitude: 8.487911266067622 + Math.random(),
  accuracy: 19.86234240298098 + Math.random() * 5,
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
