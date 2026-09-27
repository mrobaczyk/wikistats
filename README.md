# Wiki Activity

A static dashboard for contribution statistics from a Fandom wiki. It runs on GitHub Pages and fetches data directly from the selected wiki's MediaWiki API.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` publishes the repository root to GitHub Pages on every push to `main`. It can also be started manually from the repository's **Actions** tab. In **Settings → Pages**, select **GitHub Actions** as the build and deployment source if it is not already selected.

After the first successful deployment, open the Pages URL over HTTPS and enter the wiki subdomain and account names in the visible **Data source** section.

For local testing, serve the folder over HTTP. Do not open `index.html` as `file://`; browsers restrict API access and IndexedDB in that mode.

## Data and sync

- The first sync fetches the account's full contribution history, following API continuation pages.
- Later syncs request contributions newer than the newest cached timestamp and merge them without duplicates.
- **Full history** fetches the complete available history again. Use it to fill older imported records with `sizediff` and `comment` fields.
- Browser cache is separated by wiki subdomain and account name. It does not transfer automatically to another browser or device.
- Import and export JSON to move data manually. Exported files are named with their account, for example `fandom_edits_Robal91.json` and `fandom_edits_RobalBot.json`; the app loads these two published files as initial data for their matching accounts only.

GitHub Pages only serves static files, so the app cannot write changes directly back to the repository. Sync stores data in browser IndexedDB; exporting JSON is an explicit download.

## Statistics

The dashboard includes daily activity and a 30-active-day average, monthly comparisons for the main account and bot, namespace activity, most-edited pages, byte-size distribution, weekday/hour activity, and unique edited pages. Each chart can be downloaded as a PNG. Weekdays and hours use the browser's local time zone.

Size distribution and net byte change only include records with a `sizediff` field. Older imported files without that field require a full sync for complete size statistics.