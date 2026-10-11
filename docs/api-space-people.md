# API: People in space

Everyone in space right now, with their station, spacecraft, crew role, agency, country and days in space. Built by merging two sources, each cached on its own.

Status: implemented in `cookson_pro_api` (`lib/service/people.js`). The frontend card is not built yet.

## Request

```
GET /api/v1/space/people
```

No parameters.

## Response `200`

```json
{
  "sources": ["launch-library-2", "corquaid"],
  "count": 10,
  "stations": [
    { "name": "ISS", "count": 7 },
    { "name": "Tiangong", "count": 3 }
  ],
  "people": [
    {
      "name": "Pyotr Dubrov",
      "agency": "Roscosmos",
      "country": "Russia",
      "countryCode": "RU",
      "spacecraft": "Soyuz MS-29",
      "station": "ISS",
      "role": "Commander",
      "launched": "2026-07-14T14:47:43Z",
      "image": "https://thespacedevs-prod.nyc3.digitaloceanspaces.com/media/images/....jpeg",
      "wiki": "https://en.wikipedia.org/wiki/Pyotr_Dubrov",
      "daysInSpace": 89
    }
  ],
  "unavailable": {}
}
```

### Field rules

- **`people`**: sorted by station (`ISS`, `Tiangong`, then others and `null`), then launch time, then role (commander, pilot, others), then name.
- **`station`**: `"ISS"`, `"Tiangong"`, or `null` for a free-flying mission or an unrecognized spacecraft.
- **`role`**: the crew position, e.g. `"Commander"`, `"Flight Engineer"`. `null` when the corquaid feed is unavailable or doesn't list the person.
- **`launched`**: start of the current flight, ISO 8601 UTC.
- **`daysInSpace`**: whole days on the current flight, computed from `launched` at the time of the request.
- **`countryCode`**: ISO 3166-1 alpha-2, uppercase. Suitable for a flag emoji.
- **`stations`**: number of people per station, in the same order as `people`.
- **`sources`**: the sources this response was built from.
- **`unavailable`**: a message for each source that failed, keyed `launchLibrary2` or `corquaid`. Empty when both worked. The messages are safe to show to users.

## Sources and merging

| Source | Used for | Notes |
|---|---|---|
| [Launch Library 2](https://ll.thespacedevs.com/2.3.0/astronauts/?in_space=true) | **Who** is in space; launch time, photo, Wikipedia link, current mission name | Updated automatically at launches and landings. Free tier is ~15 requests/hour. Non-human "astronauts" (Starman) are left out |
| [corquaid people-in-space](https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json) | Station, spacecraft, crew role, agency and country names | Maintained by hand, so it can lag behind a landing. Its `days_in_space` is wrong and is ignored |

- Names are matched ignoring case, accents and punctuation.
- When both sources work, LL2 decides who is listed. Anyone in the corquaid feed but not in LL2 has most likely landed and is left out.
- When one source fails, the other is used alone and the failure is reported under `unavailable`. Without LL2, a recently landed crew member may still be listed. Without corquaid, `role` is `null`, and `station` is inferred from the mission name (Shenzhou → Tiangong; Soyuz, Crew-N, Ax-N → ISS).
- [Open Notify](http://api.open-notify.org/astros.json) is not used. It is HTTP-only, and its crew list stopped updating in 2024.

## Errors

| Status | When |
|---|---|
| `502` | Both sources failed and neither has a cached value under 24 hours old |

## Caching

Each source is cached separately through `lib/common/cache.js`, after being reduced to the fields above. The raw LL2 response is about 500 KB, which is over DynamoDB's 400 KB item limit. A cached source is fresh for 1 hour and is served for up to 24 hours if its provider fails. LL2 is therefore called at most about once an hour across all containers, well within its rate limit. Responses carry `Cache-Control: public, max-age=600`.
