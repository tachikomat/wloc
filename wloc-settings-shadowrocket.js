const STORAGE_KEY = "wloc_settings"

function decodeParam(value) {
  try {
    return decodeURIComponent(String(value || "").replace(/\+/g, " "))
  } catch {
    return String(value || "")
  }
}

function parseQuery(url) {
  const query = String(url || "").split("?")[1] || ""
  const params = {}

  for (const part of query.split("&")) {
    if (!part) continue

    const equalIndex = part.indexOf("=")
    const key = equalIndex === -1 ? part : part.slice(0, equalIndex)
    const value = equalIndex === -1 ? "" : part.slice(equalIndex + 1)
    params[decodeParam(key)] = decodeParam(value)
  }

  return {
    get(key) {
      return Object.prototype.hasOwnProperty.call(params, key) ? params[key] : null
    },
  }
}

function jsonResponse(body) {
  return {
    response: {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: JSON.stringify(body),
    },
  }
}

function readSettings() {
  const value = $persistentStore.read(STORAGE_KEY)
  return value ? JSON.parse(value) : null
}

function writeSettings(settings) {
  return $persistentStore.write(JSON.stringify(settings), STORAGE_KEY)
}

function clearSettings() {
  return $persistentStore.write(null, STORAGE_KEY)
}

try {
  const params = parseQuery($request.url)
  const action = params.get("action") || "save"

  if (action === "query") {
    const settings = readSettings()
    $done(
      jsonResponse(
        settings ?
          { success: true, ...settings }
        : { success: false, error: "no saved location" },
      ),
    )
  } else if (action === "clear") {
    clearSettings()
    console.log("wloc-settings: cleared")
    $done(jsonResponse({ success: true }))
  } else {
    const longitude = Number(params.get("lon") || params.get("longitude"))
    const latitude = Number(params.get("lat") || params.get("latitude"))
    const accuracy = Number(params.get("acc") || params.get("accuracy") || 25)
    const altitudeValue = params.get("alt") || params.get("altitude")
    const altitude = altitudeValue == null ? null : Number(altitudeValue)

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      $done(jsonResponse({ success: false, error: "missing lon/lat" }))
    } else {
      const settings = {
        longitude,
        latitude,
        accuracy: Number.isFinite(accuracy) ? accuracy : 25,
        updatedAt: new Date().toISOString(),
      }

      if (Number.isFinite(altitude)) settings.altitude = altitude

      const success = writeSettings(settings)
      console.log(`wloc-settings: saved ${longitude},${latitude}`)
      $done(jsonResponse({ success, ...settings }))
    }
  }
} catch (error) {
  console.log(`wloc-settings: failed: ${error?.message || error}`)
  $done(jsonResponse({ success: false, error: error?.message || String(error) }))
}
