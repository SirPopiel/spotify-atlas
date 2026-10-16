# Privacy & security

Spotify Atlas works entirely in your browser. There is no Spotify account login, OAuth, backend service, advertising tracker, analytics script, external fonts, or cover-art request. Your listening-history ZIP is read locally by the site and parsed through a browser Web Worker. The page **does not send your listening data anywhere**.

GitHub Pages, as the static hosting provider, can see ordinary HTTP visits/IP addresses when your browser downloads the application. This is different from your Spotify listening data being uploaded: the app does not upload it. Spotify's own website records normal requests when you deliberately click its external account-privacy link.

**Memory and clearing:** The app keeps normalized events in the current tab's working memory, never LocalStorage/IndexedDB. Click **Clear my data**, refresh, or close the tab to discard the in-memory data. JSZip decompresses ZIP entries in memory one at a time. The normalized internal event format intentionally excludes private account fields such as IP addresses, email addresses, user IDs and payment metadata. Country code, if present in Spotify's own history, is used only to show a local country ranking.

**Export:** Downloading a monthly CSV creates a new file on your own device. CSV contains your listening preferences; consider it private when sharing. Exported text is escaped against spreadsheet formula injection. The app never creates an embedded HTML snapshot of your data.

**Security limitations:** As with any code run in a browser, a malicious modified deployment could exfiltrate data. Use the project's official repository, review source and workflow, and avoid copies hosted by unknown parties. GitHub Pages is served over HTTPS. Huge or malicious ZIPs are capped by compressed and uncompressed size, entry count, and suspicious expansion ratio. Limits protect common cases but cannot guarantee complete protection against all resource exhaustion attacks.

**Accuracy:** Spotify records end times of plays. The calendar month/day/hour is based on that end time in the selected time zone. Play count is subject to the selected minimum threshold; minutes always use actual listening duration. Statistics are limited to the completeness of your Spotify export.
