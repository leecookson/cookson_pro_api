#!/bin/bash

# Load environment variables from .env file
source .env

# 1. Concatenate the App ID and App Secret with a colon
# 2. Base64 encode the resulting string. The '-n' for echo prevents a trailing newline.
# 3. Format the final Authorization header string.
auth_header="Basic $(echo -n "${ASTRO_APP_ID}:${ASTRO_APP_SECRET}" | base64)"

# Make the API call using the generated header
curl -X POST 'https://api.astronomyapi.com/api/v2/studio/star-chart' \
-H "Accept: application/json" \
-H "Content-Type: application/json" \
-H "Authorization: ${auth_header}" \
-d '{"style":"inverted","observer":{"latitude":40.0713,"longitude":-74.8449,"date":"2025-08-23"},"view":{"type":"area","parameters":{"position":{"equatorial":{"rightAscension":12.286923382588228,"declination":40.0713}},"zoom":5}}}'
