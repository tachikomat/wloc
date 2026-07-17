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

function finiteNumber(value) {
  if (value == null || value === "") return null

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function requestJson(url) {
  if (typeof fetch === "function") {
    return fetch(url).then((response) => response.json())
  }

  return new Promise((resolve, reject) => {
    if (typeof $httpClient === "undefined" || !$httpClient.get) {
      reject(new Error("no HTTP client available"))
      return
    }

    $httpClient.get(url, (error, response, body) => {
      if (error) {
        reject(error)
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch (parseError) {
        reject(parseError)
      }
    })
  })
}

async function fetchElevation(latitude, longitude) {
  const url = `https://api.opentopodata.org/v1/srtm90m?locations=${latitude},${longitude}`
  const data = await requestJson(url)
  const elevation = finiteNumber(data?.results?.[0]?.elevation)

  return elevation
}

function randomizeAltitude(altitude) {
  return altitude + Math.random()
}

;(async () => {
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
      const longitude = finiteNumber(params.get("lon") || params.get("longitude"))
      const latitude = finiteNumber(params.get("lat") || params.get("latitude"))
      const accuracy = finiteNumber(params.get("acc") || params.get("accuracy")) ?? 25
      const altitudeValue = params.get("alt") || params.get("altitude")
      const elevationValue = params.get("elevation") || params.get("ele")
      let altitude = finiteNumber(altitudeValue)
      let elevation = null

      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        $done(jsonResponse({ success: false, error: "missing lon/lat" }))
      } else {
        if (!Number.isFinite(altitude) && elevationValue != null && elevationValue !== "") {
          elevation = finiteNumber(elevationValue)
          altitude = Number.isFinite(elevation) ? randomizeAltitude(elevation) : null
        }

        if (!Number.isFinite(altitude)) {
          try {
            elevation = await fetchElevation(latitude, longitude)
          } catch (error) {
            console.log(`wloc-settings: elevation failed: ${error?.message || error}`)
          }

          altitude = randomizeAltitude(Number.isFinite(elevation) ? elevation : 8)
        }

        const settings = {
          longitude,
          latitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : 25,
          altitude,
          updatedAt: new Date().toISOString(),
        }

        if (Number.isFinite(elevation)) settings.elevation = elevation

        const success = writeSettings(settings)
        console.log(
          `wloc-settings: saved ${longitude},${latitude}, altitude=${altitude}`,
        )
        $done(jsonResponse({ success, ...settings }))
      }
    }
  } catch (error) {
    console.log(`wloc-settings: failed: ${error?.message || error}`)
    $done(jsonResponse({ success: false, error: error?.message || String(error) }))
  }
})()
