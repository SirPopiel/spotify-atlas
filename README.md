# Spotify Atlas

Private Spotify listening stats from your history ZIP. No login, uploads, or tracking.

## How to use

1. Request **Extended Streaming History** at [Spotify Privacy](https://www.spotify.com/account/privacy/) → Download your data.
2. Open the [Spotify Atlas website](https://sirpopiel.github.io/spotify-atlas/) and select the ZIP (do not unzip it).
3. Explore artists, songs, albums, monthly/yearly trends and listening patterns.

All analysis runs in your browser. Your history stays on your device.

## Development

```bash
npm test
npm run build
npm run dev
```

GitHub Pages deployment is configured in `.github/workflows/publish.yml`.

MIT. Not affiliated with Spotify.

## Abandoned favorites

Find songs with at least 30 historical plays (30 seconds each) and no recorded listening in four years. Adjust the thresholds, search tracks, open them on Spotify, or export CSV. Uses the full uploaded history, dated relative to the last event in the archive.
