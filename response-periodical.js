import { response } from "./response-common.js"

function tryParseJSON(str, defaultValue) {
  try {
    return JSON.parse(str)
  } catch (e) {
    return defaultValue
  }
}

;(async () => {
  const lastPatchedAt = tryParseJSON(
    $prefs.valueForKey("wloc_lastPatchedAt"),
    0,
  )
  const now = new Date()
  const minutes = now.getHours() * 60 + now.getMinutes()
  if (
    // 8:45-9:15, 18:00-18:30
    (minutes >= 8 * 60 + 50 && minutes <= 9 * 60 + 10) ||
    (minutes >= 18 * 60 + 0 && minutes <= 18 * 60 + 30)
  ) {
    const diff = Date.now() - lastPatchedAt
    if (diff > 2 * 3600_000) {
      console.log("wloc: start patching")
      $prefs.setValueForKey(JSON.stringify(Date.now()), "wloc_lastPatchedAt")
      await response()
      $notify(`Wloc successfully patched`)
    } else if (diff <= 5000) {
      // multiple calls in a short period
      console.log("wloc: continue patching")
      await response()
    } else {
      console.log("wloc: skip, already patched")
      $done()
    }
  } else {
    console.log("wloc: skip, not in period")
    $done()
  }
})()
