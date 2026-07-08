import { patchWithStats, randomPoint } from "./core.js"

const DEFAULTS = {
  mode: "random",
  centerLatitude: 30.30329,
  centerLongitude: 120.10133,
  radius: 5,
  latitude: null,
  longitude: null,
  altitude: 8,
  accuracy: 25,
}

function parseArgument(argument) {
  const params = new URLSearchParams(argument || "")
  const config = { ...DEFAULTS }

  for (const [key, value] of params.entries()) {
    if (!(key in config)) continue
    if (key === "mode") {
      config.mode = value
    } else {
      const number = Number(value)
      if (Number.isFinite(number)) config[key] = number
    }
  }

  return config
}

function targetFromConfig(config) {
  if (
    config.mode === "fixed" &&
    config.latitude != null &&
    config.longitude != null
  ) {
    return {
      latitude: config.latitude,
      longitude: config.longitude,
      altitude: config.altitude,
      accuracy: config.accuracy,
    }
  }

  const [latitude, longitude] = randomPoint(
    config.centerLatitude,
    config.centerLongitude,
    config.radius,
  )

  return {
    latitude,
    longitude,
    altitude: config.altitude == null ? null : config.altitude + Math.random(),
    accuracy: config.accuracy,
  }
}

function responseBodyBytes() {
  const body = $response.bodyBytes ?? $response.body

  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }

  throw new TypeError("wloc: response body is not binary; check binary-body-mode")
}

;(async () => {
  try {
    const config = parseArgument(typeof $argument === "string" ? $argument : "")
    const { body, stats } = await patchWithStats(
      responseBodyBytes(),
      targetFromConfig(config),
    )

    console.log(`wloc: ${JSON.stringify(stats)}`)
    $done({
      bodyBytes: body.buffer,
      body: body.buffer,
    })
  } catch (error) {
    console.log(`wloc: patch failed: ${error?.message || error}`)
    $done({})
  }
})()
