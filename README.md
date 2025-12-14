# GIT Table (Obsidian plugin)

GIT Table helps you build a clean **HTML table gallery** from a GitHub folder/repo of images, while giving you a visual way to **reorder**, **preview**, and **download** images inside Obsidian.

The popup window is fixed at **1377×768** and is designed to fit with **no scrollbars**.

## What it does

- Scan a **GitHub link** and collect image files into a list (LIST).
- Reorder the list (↑ / ↓) to control final placement order.
- Preview any image (PREVIEW).
- Download the current image (DOWN) or every image (DOWN ALL) into your vault.
- Generate:
  - **HTML gallery** (CODE → GENERATE)
  - **Plain links list** (CODE → LINKS)

## Panels

### [LIST]
Shows image **filenames** (not full URLs).  
Click an item to select it and show it in **[PREVIEW]**.

Actions:
- **↑ / ↓** — move selected item up/down
- **DELETE** — remove selected item from the active list (won’t be used for generation)
- **UNDO** — restore the last deleted item back to its original position

### [PREVIEW]
Shows the currently selected image from [LIST].

Actions:
- **DOWN** — downloads the currently previewed image into your vault
- **DOWN ALL** — downloads all images in [LIST] (in the current order)

### [SETTINGS]
- **COL** (1–5): number of thumbnails per row in the generated gallery
- **TITLE** (optional):
  - enable checkbox to activate the input
  - type a title and press **Enter** to confirm
  - title is inserted as a **centered row above the table** (preview + generated HTML)

### [TABLE]
A visual preview of the final grid layout based on [LIST] order and COL.

- Uses a small placeholder image (**50×50**) in each cell.
- Shows the **LIST index number** centered inside each cell.
- Clicking a cell opens the real image URL in your browser.

### [CODE]
Output panel (line wrapping enabled).

Header actions:
- **GENERATE** — produces the HTML table gallery
- **LINKS** — produces one full URL per line

Inside the panel:
- **COPY** — copies the current output to clipboard

## Auto regeneration

TABLE + CODE regenerate automatically when:
- COL changes
- LIST order changes (↑ / ↓)
- you DELETE or UNDO
- you confirm a TITLE (press Enter) or toggle TITLE on/off
- you scan a new GitHub link

Regeneration is **debounced** so rapid clicks don’t cause overlapping re-renders.

## Output details (HTML gallery)

- Layout uses an HTML `<table>`.
- Each thumbnail is **250×150** with `object-fit: cover`.
- Each thumbnail is wrapped with a link to the original image URL (click opens in browser).

## Plugin settings

Obsidian → Settings → Community plugins → GIT Table:

- **GitHub token (optional)**  
  Used for private repos or higher API rate limits.  
  ⚠️ Obsidian stores plugin settings **in plaintext on disk** — treat this token as sensitive.

- **Download directory** (vault-relative)  
  Where DOWN / DOWN ALL saves files.  
  Leave empty to save into the **vault root**.  
  Example: `Attachments/GitTable`

## Security notes

To make the plugin safer for public use:

- The scanned link must be a `https://github.com/...` URL.
- The plugin only opens/downloads `https://` URLs from an **allowlist** of common GitHub hosts:
  - `github.com`, `api.github.com`, `raw.githubusercontent.com`, `user-images.githubusercontent.com`, etc.
  - Anything outside this allowlist is blocked.
- Requests use timeouts (prevents hanging).
- Download directory and filenames are sanitized to prevent path traversal.
- DOWN ALL adds a small delay between downloads to reduce rate-limit pressure.

## Install (manual)

1. Download the release zip and extract.
2. Copy the `git-table` folder into:  
   `YourVault/.obsidian/plugins/git-table/`
3. Reload Obsidian and enable the plugin in Community plugins.

---

Author: Robert Alexander  
Version: 1.0.3
