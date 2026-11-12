# Khabar

Khabar is a mobile-first civic news app for Delhi NCR. Each story brings together a short explanation and links to the documents, data, and reporting behind it. The feed has an end.

## Run the demo

Use a current Node.js 24 LTS release. Version 24.22.3 includes the November 2026 security fixes.

~~~sh
npm run dev
~~~

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The demo has no package dependencies. To open it on a phone on the same Wi-Fi network, start it with HOST set to 0.0.0.0 (in PowerShell, run $env:HOST = '0.0.0.0' first) and use your computer's LAN IP and port 4173. For a shareable HTTPS demo, serve the contents of public/ from a static host.

If port 4173 is already in use, open the URL first to see whether Khabar is already running. To launch a separate instance in PowerShell, run `$env:PORT = '4174'` followed by `npm run dev`, then open [http://127.0.0.1:4174](http://127.0.0.1:4174).

## What to try

1. Open **Watch** and scroll through **Shorts** or **Full videos**. The clip in view starts muted. Use YouTube’s controls to unmute or pause, or press **Play** if autoplay is unavailable. **Open on YouTube** opens the original.
2. Try **Read & sources** on the Peek TV or Samdish clip. Open **Read** to browse the rest of the written edition and filter by topic.
3. Bookmark a story, then reload and open **Saved**.
4. Use **Submit a link** to paste a public article, reel, or video URL. A recognized link offers a shortcut to the story or video. New links stay in the browser and the app never fetches their contents.
5. Open **Bias review** or **Review bias** on a clip. Add the segment, assess the framing against the rubric, and record supporting evidence. Saving the review shows its label on the clip in the same browser.

The app includes a web manifest and home-screen icons. Bookmarks and submitted links use local storage. Sample stories live in `public/stories.js`. Add curated YouTube IDs to `public/videos.js` with a title, format, and optional ID of a related written story. Playback uses YouTube’s player and requires internet access.

## Discover YouTube Shorts candidates

Enable YouTube Data API v3 in Google Cloud, then run discovery from PowerShell:

```powershell
$env:YOUTUBE_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'YouTube Data API key' -AsSecureString)).Password
node ./scripts/discover-youtube.js --limit 5
```

The default lineup includes Ravish Kumar, Faye D'Souza, Unfiltered by Samdish, Barkha Dutt's Mojo Story, Peek TV, Newslaundry, NDTV India, and The Indian Express. The limit is per channel. To choose your own lineup, repeat `--channel` with handles or channel IDs:

```powershell
node ./scripts/discover-youtube.js --channel '@fayedsouza' --channel '@indianexpress' --limit 5
```

Keep real keys in the worker's `YOUTUBE_API_KEY` environment variable. Command-line arguments can appear in local process listings. Multiple channels print one JSON object per channel, one per line. A single channel prints a formatted JSON object. Channel failures go to stderr, and the exit code is nonzero if any channel fails.

Candidates are public, embeddable uploads up to three minutes long that are available in India. Review them on YouTube for news relevance and Shorts format, then add the clips you choose to `public/videos.js`. Use `format: 'shorts'` for Shorts and `format: 'full'` for longer videos.

## Keep the video queue fresh

Start the server in your own terminal with `node server.js`. In a separate PowerShell terminal, run one sync:

```powershell
$env:YOUTUBE_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'YouTube Data API key' -AsSecureString)).Password
node .\scripts\sync-youtube.js sync --limit 5
node .\scripts\sync-youtube.js queue
```

After reviewing a video, pass its YouTube ID to `publish`. Use `--story` to link an existing written explainer:

```powershell
$videoId = Read-Host 'Video ID from the queue'
node .\scripts\sync-youtube.js publish $videoId --format shorts --story delhi-air-quality
```

Refresh **Watch** to see the published clip. Use `unpublish VIDEO_ID` to return it to the queue. The existing discovery command remains available for inspecting a channel without saving its results.

To keep syncing while the computer is on, run `node scripts/sync-youtube.js sync --interval-minutes 60` in the worker terminal. The worker and server share `data/khabar.sqlite`. They can also use the same directory configured with `KHABAR_DATA_DIR`. The server does not need the YouTube key.

On a cloud host, place that directory on a persistent volume shared by the server and worker on the same machine. Use the foreground worker or schedule the one-shot `sync` command. Sync updates recent candidates and rechecks published clips. Source metadata expires after 30 days without a successful check. Written stories are edited in `public/stories.js`.

## Bias review

Assess the framing from the editor-provided text and evidence. A label records an editorial judgment about the submitted segment. Assess factual accuracy separately. Reviews and labels are saved in local storage and can be updated or removed.

The planned pilot uses Next.js and Postgres for shared stories, submissions, and review. The publisher portability milestone is to test an AT Protocol host migration and correction with one story.
