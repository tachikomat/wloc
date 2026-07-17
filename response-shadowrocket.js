import { patchWithStats, randomPoint } from "./core.js"

const DEFAULTS = {
  mode: "pass",
  centerLatitude: null,
  centerLongitude: null,
  radius: 5,
  latitude: null,
  longitude: null,
  altitude: 8,
  accuracy: 25,
  logLevel: "info",
}

function decodeParam(value) {
  try {
    return decodeURIComponent(String(value || "").replace(/\+/g, " "))
  } catch {
    return String(value || "")
  }
}

function parseParams(input) {
  const query = String(input || "").replace(/^\?/, "")
  const entries = []

  for (const part of query.split("&")) {
    if (!part) continue

    const equalIndex = part.indexOf("=")
    const key = equalIndex === -1 ? part : part.slice(0, equalIndex)
    const value = equalIndex === -1 ? "" : part.slice(equalIndex + 1)
    entries.push([decodeParam(key), decodeParam(value)])
  }

  return entries
}

function parseArgument(argument) {
  const config = { ...DEFAULTS }

  for (const [key, value] of parseParams(argument)) {
    if (!(key in config)) continue
    if (key === "mode") {
      config.mode = value
    } else if (key === "logLevel") {
      config.logLevel = value
    } else {
      const number = Number(value)
      if (Number.isFinite(number)) config[key] = number
    }
  }

  return config
}

function defaultAltitude() {
  return DEFAULTS.altitude + Math.random()
}

function readSavedConfig() {
  try {
    const value = $persistentStore?.read("wloc_settings")
    if (!value) return null

    const settings = JSON.parse(value)
    const longitude = Number(settings.longitude)
    const latitude = Number(settings.latitude)
    const accuracy = Number(settings.accuracy ?? DEFAULTS.accuracy)
    const altitude =
      settings.altitude == null ? defaultAltitude() : Number(settings.altitude)

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null

    return {
      mode: "fixed",
      longitude,
      latitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : DEFAULTS.accuracy,
      altitude: Number.isFinite(altitude) ? altitude : defaultAltitude(),
    }
  } catch (error) {
    console.log(`wloc: read settings failed: ${error?.message || error}`)
    return null
  }
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

  if (
    config.mode !== "random" ||
    config.centerLatitude == null ||
    config.centerLongitude == null
  ) {
    return null
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
    const argumentConfig = parseArgument(
      typeof $argument === "string" ? $argument : "",
    )
    const target = targetFromConfig(readSavedConfig() ?? argumentConfig)

    if (!target) {
      console.log("wloc: pass-through, no target location")
      $done({})
      return
    }

    const { body, stats } = await patchWithStats(responseBodyBytes(), target)

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
