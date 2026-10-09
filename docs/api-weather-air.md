# API: Air quality

Current air quality for a location, on both the US (EPA) and European scales, plus the pollutant levels behind them and the UV index. Consumed by the Weather card (`cookson_pro_web/src/components/WeatherDisplay.jsx`).

Status: implemented in `cookson_pro_api` (`lib/service/airquality.js`).

## Request

```
GET /api/v1/weather/air/:lat/:lon
```

| Param | In | Required | Notes |
|---|---|---|---|
| `lat` | path | yes | Decimal degrees, -90..90 |
| `lon` | path | yes | Decimal degrees, -180..180 |

## Response `200`

```json
{
  "query": { "lat": 40.04, "lon": -74.87 },
  "source": "open-meteo",
  "time": "2026-10-09T15:00:00.000Z",
  "aqi": {
    "us": { "value": 55, "category": "moderate", "dominant": "pm2_5" },
    "eu": { "value": 31, "category": "fair", "dominant": "pm2_5" }
  },
  "pollutants": {
    "pm2_5": { "value": 9.5,   "unit": "μg/m³", "usAqi": 55, "euAqi": 31 },
    "pm10":  { "value": 11.0,  "unit": "μg/m³", "usAqi": 11, "euAqi": 8 },
    "ozone": { "value": 67.0,  "unit": "μg/m³", "usAqi": 13, "euAqi": 17 },
    "no2":   { "value": 13.7,  "unit": "μg/m³", "usAqi": 7,  "euAqi": 9 },
    "so2":   { "value": 3.6,   "unit": "μg/m³", "usAqi": 2,  "euAqi": 1 },
    "co":    { "value": 237.0, "unit": "μg/m³", "usAqi": 3,  "euAqi": null }
  },
  "uvIndex": 4.2
}
```

### Field rules

- **`time`**: the hour the values apply to, as an ISO 8601 UTC string. The client formats it in local time.
- **`aqi.us` / `aqi.eu`**: `null` when the source has no value for that scale. The card then shows that scale's chip as `—`, and hides the row when both are `null`.
- **`aqi.*.category`**, by scale:

  | US (EPA) | value | EU (Open-Meteo European AQI) | value |
  |---|---|---|---|
  | `good` | 0–50 | `good` | 0–20 |
  | `moderate` | 51–100 | `fair` | 21–40 |
  | `unhealthy_sensitive` | 101–150 | `moderate` | 41–60 |
  | `unhealthy` | 151–200 | `poor` | 61–80 |
  | `very_unhealthy` | 201–300 | `very_poor` | 81–100 |
  | `hazardous` | 301+ | `extremely_poor` | 101+ |

  The EU bands follow Open-Meteo's documented ranges for `european_aqi`, not the EEA's revised official bands.
- **`aqi.*.dominant`**: the pollutant key with the highest sub-index on that scale. Ties go to the earlier key in the order `pm2_5`, `pm10`, `ozone`, `no2`, `so2`, `co`. It is `null` when no sub-index is available. The two scales can name different pollutants.
- **`pollutants.*`**: concentration `value` with its `unit`, plus that pollutant's sub-index on each scale. The EU scale has no CO sub-index, so `co.euAqi` is always `null`. A pollutant with no concentration value is `null`.
- **`uvIndex`**: rounded to 1 decimal; `null` if unavailable.

## Errors

Non-2xx with the app's shared error body: `{ "status": "fail" | "error", "message": "<message>" }`.

| Status | When |
|---|---|
| `400` | lat/lon missing, not numeric, or out of range |
| `502` | Open-Meteo could not be reached or returned an error, and there is no cached value under 3 hours old |

## Coverage

Open-Meteo calculates both scales from the Copernicus (CAMS) model forecasts. Both scales are available worldwide. The grid is about 11 km in Europe and about 45 km elsewhere, so the values are modelled for the region, not measured at a station.

## Caching

The upstream data is hourly. The service caches it for each location (lat/lon rounded to 2 decimals) through `lib/common/cache.js`. A cached value is fresh for 30 minutes, and is served for up to 3 hours if Open-Meteo is failing. Responses carry `Cache-Control: public, max-age=900`.

## Implementation

`lib/service/airquality.js` calls the Open-Meteo Air Quality API (`air-quality-api.open-meteo.com/v1/air-quality`, `current=` fields). It needs no API key.
