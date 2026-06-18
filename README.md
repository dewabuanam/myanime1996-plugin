# myanime1996-plugin

Source plugins for myanime1996 are packaged as JSON artifacts and imported into the main app.

This repository currently ships example plugins:

- KickAssAnime (`dist/kickassanime.plugin.json`)
- Animex (`dist/animex.plugin.json`)
- AnimeOnsen (`dist/animeonsen.plugin.json`)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Build the plugin artifact:

```bash
npm run build
```

3. Import into app:

- Open myanime1996 app
- Go to Plugins panel
- Click Import Plugin
- Select either `dist/kickassanime.plugin.json` or `dist/animex.plugin.json`
- Or select `dist/animeonsen.plugin.json`

## Repository Layout

- `src/kickassanimePlugin.mjs`: KickAss plugin source definition + resolver code
- `src/animexPlugin.mjs`: Animex plugin source definition + resolver code
- `src/animeonsenPlugin.mjs`: AnimeOnsen plugin source definition + resolver code
- `scripts/build-kickassanime-plugin.mjs`: validates and writes KickAss artifact JSON
- `scripts/build-animex-plugin.mjs`: validates and writes Animex artifact JSON
- `scripts/build-animeonsen-plugin.mjs`: validates and writes AnimeOnsen artifact JSON
- `dist/*.plugin.json`: generated artifact files (import into app)

## How Plugin Implementation Works

Each plugin artifact has three important parts:

1. Metadata
- `id`, `name`, `version`
- optional `iconPng` used by plugin UI and source dropdown

2. Host requirements
- `hostRequirements.connectSrcOrigins`
- `hostRequirements.frameSrcOrigins`
- `hostRequirements.httpAllowlist`

3. Resolver
- `resolver.kind` must be `inline-js`
- `resolver.code` is a JavaScript function string executed in app runtime
- `resolver.timeoutMs` controls max resolver runtime

## Artifact Schema (v2)

```json
{
  "schemaVersion": 2,
  "compatibilityApiVersion": "1.0",
  "plugin": {
    "id": "com.example.source",
    "name": "Example Source",
    "version": "1.0.0",
    "compatibilityApiVersion": "1.0",
    "hostRequirements": {
      "connectSrcOrigins": ["https://example.com"],
      "frameSrcOrigins": ["https://example.com"],
      "httpAllowlist": ["https://example.com/*"]
    },
    "iconPng": {
      "mimeType": "image/png",
      "dataBase64": "...",
      "width": 32,
      "height": 32
    },
    "resolver": {
      "kind": "inline-js",
      "code": "async function resolvePluginSource(request, api) { ... }",
      "timeoutMs": 7000
    }
  }
}
```

## How To Implement a New Plugin

1. Create a new source file in `src/`.
- Example: `src/mySourcePlugin.mjs`
- Export a resolver function and artifact object.

2. Implement resolver logic.
- Input: `request` (anime/episode context) and `api` helpers (`fetch`, `signal`, etc.)
- Output: source result with playable URL/options expected by app runtime
- Add defensive parsing and error handling for unstable upstream APIs

3. Add plugin metadata.
- Use a unique `id` (reverse-domain style recommended)
- Keep `compatibilityApiVersion: "1.0"`
- Add `hostRequirements` for every domain the resolver touches

4. Optional icon.
- Add a 32x32 PNG as base64 in `iconPng`
- Use `mimeType: "image/png"`

5. Create build script.
- Copy `scripts/build-kickassanime-plugin.mjs` as a template
- Import your artifact object
- Reuse validation checks before writing JSON to `dist/`

6. Update `package.json` scripts.
- Add a build command for your new plugin (or aggregate build script)

7. Build and import.
- Run `npm run build`
- Import generated artifact from app Plugins panel

## Minimal Resolver Skeleton

```js
export async function resolveMySource(request, api) {
  const query = request?.title || request?.titleEnglish || '';
  if (!query) return null;

  const response = await api.fetch('https://example.com/search?q=' + encodeURIComponent(query), {
    method: 'GET',
    signal: api.signal,
  });

  if (!response.ok) return null;
  const payload = await response.json();

  // Convert provider response into app-compatible source options
  return {
    options: [
      {
        id: 'default',
        label: 'Default',
        language: 'sub',
        server: 'Example',
        url: payload?.streamUrl,
      },
    ],
  };
}
```

## Current Example Behavior (KickAssAnime)

- Uses title matching with normalization and similarity scoring
- Caches lookup results and episode slugs with TTL
- Searches via `https://kaa.lt/api/search`
- Produces multiple source options when available
- Includes fallback/error logs for network and parsing issues

## Current Example Behavior (Animex)

- Searches title via GraphQL endpoint `https://graphql.animex.one/graphql`
- Resolves servers from `https://pp.animex.one/rest/api/servers`
- For sub requests, uses all sub providers whose tip includes `Hard sub`
- For dub requests, uses available `dubProviders`
- Resolves final stream URLs via `https://pp.animex.one/rest/api/sources`
- Returns direct source options with provider/language/quality labels
- Uses in-memory cache and retry logic for unstable upstream responses

## Current Example Behavior (AnimeOnsen)

- Searches title data via Meilisearch endpoint `https://search.animeonsen.xyz/indexes/content/search`
- Resolves episode stream metadata from `https://api.animeonsen.xyz/v4/content/{contentId}/video/{episode}`
- Returns direct source option plus soft subtitle tracks from `uri.subtitles`
- Uses in-memory cache and retry logic for unstable upstream responses
- Adds 429 cooldown behavior to avoid hammering upstream APIs

### AnimeOnsen Auth Note

- Search bearer token is currently stable in resolver constants.
- Video API bearer token may rotate upstream.
- If video resolution starts failing with 401/403, refresh the token from AnimeOnsen watch-page XHR and rebuild the plugin artifact.

## Troubleshooting

- Build fails with validation error:
  - Ensure `schemaVersion` is `2`
  - Ensure `compatibilityApiVersion` is `1.0` in both root and plugin
  - Ensure `hostRequirements` arrays are non-empty strings
  - Ensure `resolver.kind` is `inline-js` and code is non-empty

- Import succeeds but source does not resolve:
  - Verify domains in `hostRequirements` match actual resolver requests
  - Check endpoint response shape has not changed
  - Add safer parsing and fallback matching in resolver

- Icon not shown in app:
  - Ensure `iconPng.dataBase64` is valid PNG base64
  - Ensure `mimeType` is `image/png`

## Notes

- Resolver code runs inside the main app runtime after plugin import.
- Avoid depending on a private plugin backend unless absolutely necessary.
- Keep resolver deterministic and resilient: remote APIs may be unstable.
