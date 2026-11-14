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

1. Khabar opens in **Watch** on phones and desktop. Scroll through **Shorts** or switch to **Full videos**. The clip in view starts muted. Use YouTube's controls to unmute or pause, or press **Play** if autoplay is unavailable.
2. Try **Context & sources** on the Peek TV or Samdish clip, then use **Back to video** to return to it. Open **Read** to browse the rest of the written edition and filter by topic.
3. Bookmark a story, then reload and open **Saved**.
4. Use **Submit a link** to paste a public article, reel, or video URL. A recognized link offers a shortcut to the story or video. New links stay in the browser and the app never fetches their contents.
5. Open a clip's **More** menu for **Review bias** and its original YouTube link. Add the segment, assess the framing against the rubric, and record supporting evidence. Saving the review shows its label in that clip's menu in the same browser.

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

### Try Liquid AI d1-2B locally

Install llama.cpp build `b11960` or newer. On Windows, `winget install llama.cpp` is one option. In PowerShell, start the model server. The first run downloads the 4-bit weights from Hugging Face.

```powershell
llama-server -hf LiquidAI/d1-2B-GGUF:Q4_K_M --host 127.0.0.1 -b 8192 -ub 8192
```

In another terminal, run `node server.js` from the project directory. Open [Bias review](http://127.0.0.1:4173/#bias) on the same computer. Choose **Standalone segment**, paste an article excerpt or transcript up to 6,000 characters, enter a headline if available, and select **Analyse with d1-2B**. The trial checks whether the headline presents an allegation as fact and who used loaded wording. When the model selects evidence for the journalist's own wording, the page displays the passage from the supplied text. The analysis does not set an editorial label or affect publication. The model endpoint uses only the local server on port 8080.

Khabar also runs a background pass over its written stories and videos with transcripts. The result is saved in `data/khabar.sqlite` against the post and source text. Use the label on a post to open its evidence and select **Refresh analysis**. If a refresh fails, Khabar keeps the last result for that version. Changed source text gets a new analysis. A video with no transcript shows **Transcript needed**.

Pass a transcript when publishing a new video, or attach one to an existing video. Use a UTF-8 text file. Khabar attempts the initial scan before publishing when text is available. If the model is unavailable, the post can go live with **Analysis pending** and the local server retries it in the background.

```powershell
node .\scripts\sync-youtube.js publish $videoId --transcript .\transcript.txt
node .\scripts\sync-youtube.js transcript $videoId --transcript .\transcript.txt
```

The result covers the first 6,000 characters of longer transcripts. The static demo needs the Node server to display or refresh saved analyses.

### Transcribe local media with Whisper

Use the original audio or video file supplied by a creator or otherwise available for processing. Set up the local Python environment from the project directory in PowerShell:

```powershell
python -m venv .\data\local-ai\whisper-venv
& .\data\local-ai\whisper-venv\Scripts\python.exe -m pip install 'faster-whisper>=1.2.1,<2'
$env:KHABAR_WHISPER_PYTHON = (Resolve-Path '.\data\local-ai\whisper-venv\Scripts\python.exe').Path
```

Attach a transcript to an existing video or generate it during publishing:

```powershell
node .\scripts\sync-youtube.js transcript $videoId --media '.\clip.mp4'
node .\scripts\sync-youtube.js publish $videoId --media '.\clip.mp4'
```

The first run downloads `large-v3-turbo` to `data/local-ai/whisper-models`. Whisper transcribes the original speech with multilingual decoding and stores timestamped lines. Khabar saves the transcript and attempts the same local bias analysis it uses for text imports. CPU is the default. If CUDA 12 cuBLAS and cuDNN 9 are installed and available to the Python process on Windows, set `$env:KHABAR_WHISPER_DEVICE = 'cuda'` in the same PowerShell session to use the NVIDIA GPU.

### Fact checks for embedded videos

Save editorial fact checks against the YouTube video ID. Readers can open **Fact-Check** under the player to see the claim, verdict, explanation, evidence links and, when supplied, a timestamp in seconds. Adding checks replaces the previous list for that video. A related written story appears as context.

```powershell
node .\scripts\sync-youtube.js fact-check $videoId --file .\checks.json
```

The file is a JSON array. Use `supported`, `contradicted`, `needs-context`, or `unverified` as the verdict. Include at least one evidence link for each verdict other than `unverified`.

```json
[
  {
    "claim": "The clip says a new timetable starts on Monday.",
    "timestamp": 24,
    "verdict": "unverified",
    "explanation": "An official timetable with an effective date is needed.",
    "sources": []
  }
]
```

Each evidence link has `title`, `publisher`, and `url` fields.

The planned pilot uses Next.js and Postgres for shared stories, submissions, and review. The publisher portability milestone is to test an AT Protocol host migration and correction with one story.
