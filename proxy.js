import http from "node:http"
import { Readable } from "node:stream"
import { bytes } from "node:stream/consumers"
import { patchWithStats } from "./core.js"

const server = http
  .createServer(async (req, res) => {
    const response = await fetch("https://gs-loc.apple.com/clls/wloc", {
      method: "POST",
      headers: req.headers,
      // body: Readable.toWeb(req),
      body: await bytes(req),
    })
    if (!response.ok) {
      throw await response.text()
    }
    // return res.end(await response.bytes())
    const { body, stats } = await patchWithStats(await response.bytes(), {
      longitude: 124.233738,
      latitude: 29.469289,
      altitude: 5,
      accuracy: 25,
    })
    console.log(stats)
    res.end(body)
  })
  .listen(4900, () => {
    console.info(`Server running at http://localhost:${server.address().port}`)
  })
