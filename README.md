# Khabar

Khabar is a mobile-first newsroom with a curated reading and video edition. Open a report to explore its timeline, compare perspectives or inspect original documents and footage. Bookmarks, likes, notes and recent stories are kept in the current browser.

## Open the app

Run `node server.mjs` with Node 24.12 or newer and open [Khabar](http://127.0.0.1:4181/). The server serves the browser app and API together. Reading the edition requires no build step, package installation or model.

| Directory | Contents |
| --- | --- |
| `web/` | Feed, story reader, investigation views, reader state, styles and media |
| `server/` | HTTP routes, SQLite access, publication command and the seven-story seed edition |
| `workers/` | Model extraction and the standalone batch analysis command |
| `data/` | Local SQLite database and runtime files, excluded from Git |

For a phone on the same home network, start `node server.mjs --lan` and open the printed LAN URL for the PC’s Ethernet or Wi-Fi adapter. Stop the previous server on the same port first, or set `$env:PORT = '4183'` in a second PowerShell window. The Node server supplies both the UI and the published edition. The source-submission and analysis API is accessible from the PC.

## Publish or update a story

A new database starts with the curated stories in `server/seed/edition.json`. Use one object from that array as a template for a story file. Its lowercase slug is the permanent ID used by story links and bookmarks. Run the command from the checkout using the same `KHABAR_DB` setting as the running server.

```powershell
node server/publish.mjs .\story.json
```

A new ID leads the feed. Reusing an ID updates the existing story in place. Refresh the front page or reopen it to see the change. The seed only initializes an empty edition.

| Request | Response |
| --- | --- |
| `GET /api/feed` | An object containing a `stories` array of cards in editorial order |
| `GET /api/feed?q=stubble` | Matching cards, including matches in body text, sources and reporting angles |
| `GET /api/stories/delhi-air` | One full story with its body, timeline, perspectives and original sources |

## Analyze source material

**Analyze a source** accepts English and Hindi articles or transcripts. The local API stores the supplied text in SQLite. Each extraction contains a summary and up to five candidate claims quoted from the source. It records the model, prompt version and token usage. Verification against independent evidence comes later.

## Run with the existing local Qwen model

Start the model server in PowerShell using the assets already on this machine.

```powershell
$models = 'C:\Projects\khabar\khabar\data\local-ai'
& "$models\llama-b12441-vulkan\llama-server.exe" -m "$models\qwen3-4b-instruct-2507-q4_k_m.gguf" --alias khabar-qwen --host 127.0.0.1 --port 8081 -ngl 99 -c 4096 -np 1
```

Start the API in a second terminal with Node 24.12 or newer.

```powershell
cd C:\Projects\khabar\fresh-start
node server.mjs
```

By default the API listens on loopback port 4181. The model server is only needed for new extractions. Start with short articles or transcripts that fit the configured context window, including instructions and output.

## Submit a post

```powershell
$api = 'http://127.0.0.1:4181'
$body = @{
  url = 'https://example.org/sample-announcement'
  language = 'en'
  text = 'The school announced that the library will reopen on Monday.'
} | ConvertTo-Json
$post = Invoke-RestMethod "$api/posts" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
Invoke-RestMethod "$api/posts/$($post.id)/analyze" -Method Post | ConvertTo-Json -Depth 5
Invoke-RestMethod "$api/posts/$($post.id)" | ConvertTo-Json -Depth 5
```

The source URL provides attribution. Supply the article text or transcript in the request. Submitting identical content at the same URL and language returns the existing ID. Edited text creates a separate snapshot. Repeating an extraction reuses the stored result for the configured endpoint, model and prompt version. Invalid outputs and provider failures can be retried.

Interactive requests start an extraction worker on demand. For batch work, start the model endpoint and run the worker independently against the same database. It processes saved posts missing an analysis for its configured endpoint, model and prompt version. You can also supply a single post ID.

```powershell
node workers/analyze.mjs --pending
```

## Try hosted Inkling

Set the following in the API terminal before starting Node. On PowerShell 7, `Read-Host -MaskInput` lets you enter the OpenRouter API key without including it in command history.

```powershell
$env:KHABAR_LLM_BASE_URL = 'https://openrouter.ai/api/v1'
$env:KHABAR_LLM_MODEL = 'thinkingmachines/inkling-2-mini'
$env:KHABAR_LLM_API_KEY = Read-Host -MaskInput 'OpenRouter API key'
node server.mjs
```

A call to the analyze route sends that post's text to the configured provider. Other OpenAI-compatible chat completion endpoints can use the same three settings. Override the API port with `PORT` and the SQLite path with `KHABAR_DB`.
