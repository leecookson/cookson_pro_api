# API: Tonight (proposal)

Stargazing conditions for one evening at a location: everything `/sunmoon` returns, plus a viewing window, the cloud forecast for that window, and the objects expected to be viewable in it (starting with ISS passes). The shape is meant to grow. New data sources (seeing, transparency, …) will be added as new top-level sections, and new kinds of object (planets, …) as new entries in `objects`, without changing the existing ones.

Status: implemented in `cookson_pro_api` (`lib/service/tonight.js`). The shape is open for frontend feedback before anything depends on it.

## Request

```
GET /api/v1/astro/tonight/:lat/:lon?date=YYYY-MM-DD&tz=<IANA zone>
```

Same parameters and validation as `/sunmoon` (spec: `cookson_pro_web/docs/api-astro-sunmoon.md`):

| Param | In | Required | Notes |
|---|---|---|---|
| `lat` | path | yes | Decimal degrees, -90..90 |
| `lon` | path | yes | Decimal degrees, -180..180 |
| `date` | query | no | Local calendar date in `tz` whose evening you want. Default: today in `tz` |
| `tz` | query | no | IANA zone. Default: `UTC` |

"Tonight" means the evening of `date`. A request made at 01:00 without `date` returns the coming evening, not the night that is ending.

## Response `200`

```json
{
  "query":  { "lat": 37.77, "lon": -122.42, "date": "2026-10-05", "tz": "America/Los_Angeles" },
  "status": "ok",
  "window": { "start": "2026-10-05T19:46:00-07:00", "end": "2026-10-06T00:00:00-07:00" },
  "sun":  { "...": "identical to /sunmoon sun" },
  "moon": { "...": "identical to /sunmoon moon" },
  "clouds": {
    "source": "open-meteo",
    "summary": {
      "sky": "clear",
      "steady": true,
      "meanCover": 4,
      "minCover": 1,
      "maxCover": 6,
      "clearest": null
    },
    "hourly": [
      { "time": "2026-10-05T19:00:00-07:00", "cover": 1, "low": 1, "mid": 0, "high": 0, "visibilityMeters": 30700 },
      { "time": "2026-10-05T20:00:00-07:00", "cover": 3, "low": 3, "mid": 0, "high": 0, "visibilityMeters": 22900 },
      { "time": "2026-10-06T00:00:00-07:00", "cover": 4, "low": 4, "mid": 0, "high": 0, "visibilityMeters": 17100 }
    ]
  },
  "objects": [
    {
      "id": "iss",
      "name": "International Space Station",
      "kind": "satellite",
      "passes": [
        {
          "start": { "time": "2026-10-05T20:46:30-07:00", "altitude": 10.3, "azimuth": 320.2 },
          "peak":  { "time": "2026-10-05T20:48:00-07:00", "altitude": 24.9, "azimuth": 324.1 },
          "end":   { "time": "2026-10-05T20:48:00-07:00", "altitude": 24.9, "azimuth": 324.1 },
          "durationSeconds": 90,
          "endsInShadow": true
        }
      ]
    }
  ],
  "unavailable": {}
}
```

(The ISS pass is illustrative. There's no visible evening pass over San Francisco on this date.)

### Sections

- **`query`, `sun`, `moon`**: exactly the `/sunmoon` response, so the existing Astro card components can be reused. These are present in every `200`, including `"na"`.
- **`status`**: `"ok"`, or `"na"` when there is no evening viewing window. See [Not applicable](#not-applicable-status-na).
- **`window`**: the viewing window, from sunset + 1 hour to local midnight (the start of the next local date). Timestamps use the offset of `tz`.
- **`clouds`**: the hourly forecast from [Open-Meteo](https://open-meteo.com/), which is free and needs no key.
  - `hourly` holds the samples on the hour within the window. It also includes the last sample at or before `window.start`, so the opening of the window is covered. All cover values are percentages, 0..100. `low`/`mid`/`high` are cloud layers. High thin cloud is often still usable for bright objects.
  - `summary` is computed over `hourly`:
    - `sky`: the band for `meanCover`: `clear` (< 20), `partly_cloudy` (< 50), `mostly_cloudy` (< 80) or `cloudy`.
    - `steady`: `true` when cover hardly changes over the window. That means it varies by 10 points or less, or every hour falls in the same band. Show this as "Clear all evening", "Cloudy all evening", and so on.
    - `clearest`: the first hour with the lowest cover, as `{ time, cover }`. It is **`null` when `steady` is `true`**, because no hour is meaningfully clearer than the others. Its `time` is never before `window.start`. If the lead-in sample is the clearest, `window.start` is reported instead.
- **`objects`**: things expected to be viewable during the window. Each entry has `id`, `name` and `kind`, plus fields for that kind. **Only objects that are actually viewable in the window are listed**, so `[]` means there's nothing to show. An object that is missing because its data source failed has a reason under `unavailable["objects.<id>"]`. Order is not significant yet.
  - **ISS** (`id: "iss"`, `kind: "satellite"`): `passes` lists each visible pass in time order. A pass counts as visible while the ISS is at least 10° above the horizon, the sun is at least 6° below the observer's horizon, and the ISS is in sunlight (not in Earth's shadow).
    - `start` / `peak` / `end`: `{ time, altitude, azimuth }`, in degrees with azimuth clockwise from true north. Times have second precision, because passes are only minutes long.
    - Passes are **clipped to the window**. A pass already in progress when the window opens starts at `window.start`, so `start` can equal `peak`.
    - `endsInShadow`: `true` when the ISS fades out by entering Earth's shadow rather than setting. The card can show this as "vanishes at 25° in the NW".
    - `durationSeconds`: from `start` to `end`.
    - Orbit data (a TLE) comes from CelesTrak, with ARISS and tle.ivanstanojevic.me as fallbacks, and is cached for 6 hours. Predictions are only made within 5 days of that orbit data, because accuracy drops after that.
- **`unavailable`**: when `status` is `"ok"`, maps a section name (or `objects.<id>`) to a human-readable reason for every section or object that could not be filled. It is `{}` when everything is present.

### Not applicable (`status: "na"`)

When the location has no evening viewing window on `date`, the response is "not applicable". `sun` and `moon` are still filled. `window`, `clouds`, `objects`, and any future window-based sections are `null`. A single top-level `reason` explains why, and `unavailable` is `{}`. No upstream provider is called.

```json
{
  "query":  { "lat": 78.22, "lon": 15.65, "date": "2026-06-21", "tz": "Arctic/Longyearbyen" },
  "status": "na",
  "reason": "The sun does not set on this date.",
  "window": null,
  "sun":    { "...": "/sunmoon sun, polar: \"always_up\"" },
  "moon":   { "...": "/sunmoon moon" },
  "clouds": null,
  "objects": null,
  "unavailable": {}
}
```

| Case | `reason` |
|---|---|
| Midnight sun (`sun.polar = "always_up"`) | "The sun does not set on this date." |
| Polar night (`sun.polar = "always_down"`) | "The sun does not rise or set on this date." |
| The sun rises but does not set (first day of midnight sun) | "No sunset on this date." |
| Sunset + 1 h is after midnight (high latitude in summer) | "Sunset plus one hour is after midnight." |

The card can show the `reason` with the sun/moon details instead of a forecast.

### Partial results (`status: "ok"`)

One failing data source does not fail the request. If a section can't be filled, it is `null`. If an object can't be computed, it is left out of `objects`. Either way, the reason is in `unavailable`:

| Case | Effect | `unavailable` |
|---|---|---|
| Normal | all filled | `{}` |
| No visible ISS pass in the window | ISS not in `objects` | `{}` |
| `date` outside the cloud forecast range (about 92 days back to 16 days ahead) | `clouds: null` | `clouds`: "Cloud forecast is not available for this date." |
| Cloud provider down or timed out (10 s) | `clouds: null` | `clouds`: "Cloud forecast provider could not be reached." |
| `date` more than about 5 days from the ISS orbit data | ISS not in `objects` | `objects.iss`: "ISS pass predictions are only available for a few days around today." |
| Every ISS orbit data source down (4 s timeout each), and nothing cached | ISS not in `objects` | `objects.iss`: "ISS orbit data could not be retrieved." |

Data sources are queried in parallel.

Clients should check `status` first, then test each section for `null`, instead of relying on the HTTP status. Future sections follow the same rules.

## Errors

Same as `/sunmoon`: `400` for invalid lat/lon/date/tz. The body uses the app-wide error shape `{ "status": "fail", "message": "<message>" }`.

## Caching

`Cache-Control: public, max-age=60`, the same as `/sunmoon`, because `sun.position` and `nextRise`/`nextSet` are relative to the time of the request.

## Open questions for frontend

1. **Polar night**: returns `"na"` for now. It is dark all day, so a later version could give it a window (for example a fixed 18:00 to midnight) instead.
2. **Window end**: midnight cuts off the darkest hours. Do we want an option to extend to astronomical dawn (`?until=dawn`)?
3. **Summary**: is mean/min/max/clearest enough, or would a single 0..100 "stargazing score" (combining cloud cover, moon illumination and moon-up time in the window) be more useful for the card?
4. **Moon in the window**: should the API say whether the moon is above the horizon during the window, or is the client happy to work that out from `moon.rise`/`moon.set`?
5. **ISS brightness**: should passes include an estimated magnitude? Most bright passes are already obvious from `peak.altitude`.
6. **Next objects**: planets (visible ones, with rise/set and their altitude across the window) seem the natural next entries in `objects`. Should the ISS list also include the next visible pass after tonight when there is none tonight?
