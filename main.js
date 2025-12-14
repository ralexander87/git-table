/*
GIT Table — Obsidian plugin (no build step required)

Install:
- Copy folder `git-table` into: <vault>/.obsidian/plugins/
- Reload Obsidian and enable “GIT Table”.
*/

const { Plugin, Modal, Notice, openExternal, PluginSettingTab, Setting, addIcon } = require("obsidian");

const IMAGE_EXTS = new Set(["png","jpg","jpeg","gif","webp","svg","bmp","tif","tiff","avif","ico"]);

// Placeholder thumbnail used ONLY in TABLE preview panel
const TABLE_PLACEHOLDER_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAAXNSR0IB2cksfwAAAARnQU1BAACxjwv8YQUAAAAgY0hSTQAAeiYAAICEAAD6AAAAgOgAAHUwAADqYAAAOpgAABdwnLpRPAAAAAZiS0dEAP8A/wD/oL2nkwAAAAlwSFlzAAAuIwAALiMBeKU/dgAAAAd0SU1FB+kMDhEEEyWGN0UAAALASURBVGje7dpNqFVVGMbx39mpEKV9IVk6CcrJKiKTRmIldAfVTqhJkJNFEDQICiSIJEihog8EowYN2kTSoEsOWkUfNOhCDYoEEzdCTcKCxKgsoswb3QaeE4fL2rcrce9ZxX5m53nX2qz/Xu+79oL3DJyF2qbegI24COdaGs3iRxzDFyGmPxczabCIxW9GxJ1YZ3n1C97FfrwZYpo7a5C2qTdiL25Vho5gZ4jpvUWDtE19P55bwvT5N3oJD4SYTi8I0jb1XjyobM1ge4jpp5FRzYN44j8AATfiQNvUK0fGijGIu/DIIgpvBseHv5dCq3ApNuN2XN4xbhuexkN/p1bb1JfgKNZmJszheewOMX2/nK99+Mbvw5NY3bG2rSGmj0Y78nAHxGnsCDFNTyJ/QkyzeKFt6hm8gw2Zw+opbBm0TX3+MFXOyzzr3hDTyyUURdvU1+LjjnVurbC9I/h2KRDD3fkcuzvC91S4pSO4p8DTah9OZvypCpsygeP4tDSKENMpvJ8JXVFlCggOL3SvmbAO58wKazL+dwV/DE90gZyT8f8oGGS2C+R/oR6kB+lBepAepAfpQXqQHqQH6UF6kB6kB+lBygU5lfFXF7zmNV0gP2T89QWDrO8COZrxN7VNfUGhINsy3m8VPskEVmJHaQRtU1+D6zOhgxUOdMzb1Tb1xQVBDPCsfCf6jSrEdBCHMsF1mB5vOE5YezCVSyu8Njp+H18gHz9om3rtBHdiRdvU+/Box5AXQ0wnBmMT3sJtHYNP4hnsDzEdWyaAC3EHduGqjmFf4+oQ08/jIJfhM93t4JG+wrf4dYkYVjnTmL3SWPs8o1lMhZg+NL9whg3HGZR69I40hxhieiV7RRk2HLfgm4Ihfsfd4xDZu1aI6Qiuw3SBEIdwQ4jp9fmBwT8U3M14DDdNGOBLZ/798GqIKdtN+wunrreJ/WDwUAAAAABJRU5ErkJggg==";

function isImagePath(p) {
  const m = /\.([a-z0-9]+)$/i.exec(p || "");
  return !!(m && IMAGE_EXTS.has(m[1].toLowerCase()));
}

function encodePath(path) {
  return (path || "").split("/").map(encodeURIComponent).join("/");
}

function parseGitHubUrl(input) {
  let u;
  try { u = new URL((input || "").trim()); } catch { return null; }
  const host = (u.hostname || "").toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;

  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = (parts[1] || "").replace(/\.git$/i, "");

  let kind = null; // "tree" | "blob" | null
  let ref = null;
  let subpath = "";

  if (parts[2] === "tree" || parts[2] === "blob") {
    kind = parts[2];
    ref = parts[3] || null;
    subpath = parts.slice(4).join("/");
  }

  return { owner, repo, kind, ref, subpath };
}

async function ghFetchJson(url, token, signal) {
  const headers = { "Accept": "application/vnd.github+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const safe = toSafeHttpsUrl(url);
  if (!safe) throw new Error("Blocked request to non-allowed host/protocol.");
  const res = await fetchWithTimeout(safe.href, { headers }, 20000, signal);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub request failed (${res.status}) ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return await res.json();
}

async function resolveDefaultBranch(owner, repo, token, signal) {
  const repoInfo = await ghFetchJson(`https://api.github.com/repos/${owner}/${repo}`, token, signal);
  return repoInfo.default_branch || "main";
}

async function listImagesFromGitHubLink(githubUrl, token, signal) {
  const parsed = parseGitHubUrl(githubUrl);
  if (!parsed) throw new Error("Please paste a valid GitHub URL (github.com/owner/repo[/tree/...]).");

  const { owner, repo, kind, subpath } = parsed;
  let ref = parsed.ref;

  if (!ref) ref = await resolveDefaultBranch(owner, repo, token, signal);

  // Direct blob URL pointing at a file
  if (kind === "blob" && subpath) {
    if (!isImagePath(subpath)) return { urls: [], truncated: false };
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodePath(subpath)}`;
    return { urls: [rawUrl], truncated: false };
  }

  // Git Trees API recursive file list
  const tree = await ghFetchJson(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    token,
    signal
  );

  const prefix = subpath ? subpath.replace(/\/+$/, "") + "/" : "";
  const wantPrefix = (p) => (prefix ? p.startsWith(prefix) : true);

  const urls = [];
  for (const item of (tree.tree || [])) {
    if (item.type !== "blob") continue;
    if (!item.path) continue;
    if (!wantPrefix(item.path)) continue;
    if (!isImagePath(item.path)) continue;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodePath(item.path)}`;
    urls.push(rawUrl);
  }

  // Default sort (user can reorder/sort later)
  urls.sort((a, b) => a.localeCompare(b));
  return { urls, truncated: !!tree.truncated };
}

function filenameFromUrl(u) {
  try {
    const url = new URL(u);
    const parts = url.pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1] || "");
  } catch {
    const parts = (u || "").split("/");
    return parts[parts.length - 1] || u;
  }
}

function clampInt(v, min, max) {
  const n = Number.parseInt(String(v), 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// --- Security / safety helpers ---
function sanitizeVaultFolderPath(folderPath) {
  const cleaned = String(folderPath || "").trim().replace(/\\/g, "/");
  const parts = cleaned.split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.join("/");
}

const GIT_TABLE_ALLOWED_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "user-images.githubusercontent.com",
  "media.githubusercontent.com",
  "objects.githubusercontent.com"
]);

function toSafeHttpsUrl(urlStr) {
  try {
    const u = new URL(String(urlStr || "").trim());
    if (u.protocol !== "https:") return null;
    const host = (u.hostname || "").toLowerCase();
    if (!GIT_TABLE_ALLOWED_HOSTS.has(host)) return null;
    return u;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000, outerSignal) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const opts = { ...options, signal: controller.signal };
    return await fetch(url, opts);
  } finally {
    window.clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((r) => window.setTimeout(r, ms));
}


function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function openUrlExternal(url) {
  const safe = toSafeHttpsUrl(url);
  if (!safe) {
    new Notice("Blocked opening a non-allowed URL.");
    return;
  }
  try {
    if (typeof openExternal === "function") openExternal(safe.href);
    else window.open(safe.href, "_blank");
  } catch {
    window.open(safe.href, "_blank");
  }
}

async function ensureFolderPath(app, folderPath) {
  const p = sanitizeVaultFolderPath(folderPath);
  if (!p) return;

  const parts = p.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(cur);
    if (!existing) {
      try {
        await app.vault.createFolder(cur);
      } catch {
        // ignore (race/exists)
      }
    }
  }
}

function uniqueFilePath(app, folderPath, filename) {
  const baseFolder = sanitizeVaultFolderPath(folderPath);
  const safeName = (String(filename || "image"))
  .replace(/[\x00-\x1F\x7F]/g, "")
  .replace(/[/\\]/g, "_")
  .trim()
  .slice(0, 180) || "image";

  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const ext = dot > 0 ? safeName.slice(dot) : "";

  const mk = (n) => {
    const nm = n === 0 ? `${stem}${ext}` : `${stem} (${n})${ext}`;
    return baseFolder ? `${baseFolder}/${nm}` : nm;
  };

  let i = 0;
  while (app.vault.getAbstractFileByPath(mk(i))) i++;
  return mk(i);
}

function buildPreviewTableHtml(urls, cols, title) {
  const safeCols = clampInt(cols, 1, 5);
  const thumbW = 50;
  const thumbH = 50;

  const out = [];
  out.push('<div align="center">');
  out.push('  <table border="0" cellspacing="0" cellpadding="5">');

  if (title && String(title).trim()) {
    const t = escapeHtml(String(title).trim());
    out.push(`    <tr><td colspan="${safeCols}" align="center" style="padding: 6px 0 12px 0;"><strong>${t}</strong></td></tr>`);
  }

  for (let i = 0; i < urls.length; i += safeCols) {
    out.push("    <tr>");
    for (let c = 0; c < safeCols; c++) {
      const idx = i + c;
      if (idx < urls.length) {
        const href = urls[idx];
        const alt = `Image ${idx + 1}`;
        out.push('      <td align="center">');
        // TABLE preview uses placeholder thumbnail, but keeps link to the real image
        out.push(`        <a href="${href}"><span class="git-table__thumb"><img src="${TABLE_PLACEHOLDER_DATA_URI}" width="${thumbW}" height="${thumbH}" alt="${alt}" style="object-fit: cover;"><span class="git-table__thumbNum">${idx + 1}</span></span></a>`);
        out.push("      </td>");
      } else {
        out.push('      <td align="center"></td>');
      }
    }
    out.push("    </tr>");
  }

  out.push("  </table>");
  out.push("</div>");
  return out.join("\n");
}

function buildGalleryTableHtml(urls, cols, title) {
  const safeCols = clampInt(cols, 1, 5);
  const thumbW = 250;
  const thumbH = 150;

  const out = [];
  out.push('<div align="center">');
  out.push('  <table border="0" cellspacing="0" cellpadding="5">');

  if (title && String(title).trim()) {
    const t = escapeHtml(String(title).trim());
    out.push(`    <tr><td colspan="${safeCols}" align="center" style="padding: 6px 0 12px 0;"><strong>${t}</strong></td></tr>`);
  }

  for (let i = 0; i < urls.length; i += safeCols) {
    out.push("    <tr>");
    for (let c = 0; c < safeCols; c++) {
      const idx = i + c;
      if (idx < urls.length) {
        const u = urls[idx];
        const alt = `Image ${idx + 1}`;
        out.push('      <td align="center">');
        out.push(`        <a href="${u}"><img src="${u}" width="${thumbW}" height="${thumbH}" alt="${alt}" style="object-fit: cover;"></a>`);
        out.push("      </td>");
      } else {
        out.push('      <td align="center"></td>');
      }
    }
    out.push("    </tr>");
  }

  out.push("  </table>");
  out.push("</div>");
  return out.join("\n");
}

class GitTableModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this._abort = null;
  }

  onOpen() {
    const { contentEl, modalEl } = this;

    modalEl.addClass("git-table-modal");
    contentEl.empty();
    contentEl.addClass("git-table");

    const wrap = contentEl.createDiv({ cls: "git-table__wrap" });

    // Header
    const header = wrap.createDiv({ cls: "git-table__header" });
    header.createDiv({ cls: "git-table__label", text: "GIT LINK" });

    const inputWrap = header.createDiv({ cls: "git-table__inputWrap" });
    const input = inputWrap.createEl("input", {
      cls: "git-table__input",
      type: "text",
      placeholder: "Paste GitHub link and press Enter…"
    });

    const foundBadge = header.createDiv({ cls: "git-table__found" });
    foundBadge.setText("FOUNDED: 0");

    // Top row
    const topRow = wrap.createDiv({ cls: "git-table__row git-table__rowTop" });

    // LIST panel
    const listPanel = topRow.createDiv({ cls: "git-table__panel" });
    const listHeader = listPanel.createDiv({ cls: "git-table__panelHeader git-table__panelHeaderRow" });
    listHeader.createSpan({ text: "[LIST]" });

    const listActions = listHeader.createDiv({ cls: "git-table__listActions" });

    const moveUpBtn = listActions.createEl("button", { cls: "git-table__deleteBtn" });
    moveUpBtn.setText("↑");

    const moveDownBtn = listActions.createEl("button", { cls: "git-table__deleteBtn" });
    moveDownBtn.setText("↓");

    const undoBtn = listActions.createEl("button", { cls: "git-table__deleteBtn" });
    undoBtn.setText("UNDO");

    const deleteBtn = listActions.createEl("button", { cls: "git-table__deleteBtn" });
    deleteBtn.setText("DELETE");

    const listBody = listPanel.createDiv({ cls: "git-table__panelBody git-table__listBody" });

    // PREVIEW panel
    const previewPanel = topRow.createDiv({ cls: "git-table__panel" });
    const previewHeader = previewPanel.createDiv({ cls: "git-table__panelHeader git-table__panelHeaderRow" });
    previewHeader.createSpan({ text: "[PREVIEW]" });

    const previewActions = previewHeader.createDiv({ cls: "git-table__headerActions" });

    const downBtn = previewActions.createEl("button", { cls: "git-table__deleteBtn" });
    downBtn.setText("DOWN");

    const downAllBtn = previewActions.createEl("button", { cls: "git-table__deleteBtn" });
    downAllBtn.setText("DOWN ALL");
const previewBody = previewPanel.createDiv({ cls: "git-table__panelBody git-table__previewBody" });
    const previewInner = previewBody.createDiv({ cls: "git-table__previewInner" });

    // SETTINGS panel
    const settingsPanel = topRow.createDiv({ cls: "git-table__panel" });
    settingsPanel.createDiv({ cls: "git-table__panelHeader", text: "[SETTINGS]" });
    const settingsBody = settingsPanel.createDiv({ cls: "git-table__panelBody git-table__settingsBody" });

    // Bottom row
    const bottomRow = wrap.createDiv({ cls: "git-table__row git-table__rowBottom" });

    const tablePanel = bottomRow.createDiv({ cls: "git-table__panel" });
    tablePanel.createDiv({ cls: "git-table__panelHeader", text: "[TABLE]" });
    const tableBody = tablePanel.createDiv({ cls: "git-table__panelBody git-table__tableBody" });

    const codePanel = bottomRow.createDiv({ cls: "git-table__panel" });
const codeHeader = codePanel.createDiv({ cls: "git-table__panelHeader git-table__panelHeaderRow" });
codeHeader.createSpan({ text: "[CODE]" });

    const codeActions = codeHeader.createDiv({ cls: "git-table__headerActions" });

    const genBtn = codeActions.createEl("button", { cls: "git-table__deleteBtn git-table__genHeaderBtn" });
    genBtn.setText("GENERATE");

    const linksBtn = codeActions.createEl("button", { cls: "git-table__deleteBtn git-table__genHeaderBtn" });
    linksBtn.setText("LINKS");

const codeBody = codePanel.createDiv({ cls: "git-table__panelBody git-table__codeBody" });

    // Status
    const status = wrap.createDiv({ cls: "git-table__status" });

    // State
    let colValue = 1; // max 5
    let currentUrls = [];
    let currentPreviewUrl = null;


    let titleEnabled = false;
    let titleText = "";


    let codeMode = "html"; // "html" | "links"

    let selectedIndex = -1;
    let pendingSelectIndex = null;

    let deleteStack = []; // {url, index}

    const updateUndoState = () => {
      undoBtn.disabled = deleteStack.length === 0;
    };
    updateUndoState();

    // Settings UI
    const makeStepper = (labelText, getVal, setVal, maxVal) => {
      const step = settingsBody.createDiv({ cls: "git-table__stepper" });
      step.createDiv({ cls: "git-table__stepperLabel", text: labelText });

      const valEl = step.createDiv({ cls: "git-table__stepperValue" });
      const render = () => valEl.setText(String(getVal()));

      const btnMinus = step.createEl("button", { cls: "git-table__stepperBtn" });
      btnMinus.setText("−");

      const btnPlus = step.createEl("button", { cls: "git-table__stepperBtn" });
      btnPlus.setText("+");

      btnMinus.addEventListener("click", () => { setVal(clampInt(getVal() - 1, 1, maxVal)); render(); queueRegenerateAll(); });
      btnPlus.addEventListener("click", () => { setVal(clampInt(getVal() + 1, 1, maxVal)); render(); queueRegenerateAll(); });

      render();
    };

    makeStepper("COL:", () => colValue, (v) => (colValue = v), 5);


// Title controls (optional)
const titleRow = settingsBody.createDiv({ cls: "git-table__titleRow" });

const titleLabel = titleRow.createEl("label", { cls: "git-table__titleLabel" });
const titleCheck = titleLabel.createEl("input", { type: "checkbox", cls: "git-table__titleCheck" });
titleLabel.appendText("TITLE");

const titleInput = titleRow.createEl("input", {
  cls: "git-table__titleInput",
  type: "text",
  placeholder: "Enter title and press Enter…"
});
titleInput.disabled = true;

titleCheck.addEventListener("change", async () => {
  titleEnabled = !!titleCheck.checked;
  titleInput.disabled = !titleEnabled;

  if (titleEnabled) {
    titleInput.value = titleText || titleInput.value || "";
    titleInput.focus();
    // If a title was already confirmed, show it immediately
    if (titleText && titleText.trim()) await regenerateAll();
  } else {
    await regenerateAll();
  }
});

titleInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    titleText = (titleInput.value || "").trim();
    if (titleEnabled) await regenerateAll();
  }
});

    const setLoading = (on) => {
status.setText(on ? "Scanning GitHub link for images…" : "");
    };

    const setPreview = (url) => {
      previewInner.empty();
      currentPreviewUrl = url || null;

      if (!url) return;

      const img = previewInner.createEl("img", { cls: "git-table__img" });
      img.src = url;
      img.alt = url;

      img.addEventListener("error", () => {
        previewInner.empty();
        previewInner.createDiv({ cls: "git-table__previewMsg", text: "Preview failed to load." });
      });
    };


async function regenerateAll() {
      // Keep TABLE + CODE always in sync with currentUrls/colValue
      renderTablePreview();
      if (codeMode === "links") await renderLinks();
      else await renderCode();
    }


// Debounced regeneration to avoid overlapping renders when user clicks fast
let _regenTimer = null;
let _regenPending = false;

function queueRegenerateAll() {
  _regenPending = true;
  if (_regenTimer) return;

  _regenTimer = window.setTimeout(async () => {
    _regenTimer = null;
    if (!_regenPending) return;

    _regenPending = false;
    try {
      await regenerateAll();
    } catch (e) {
      // ignore render errors
    }

    // If changes happened while we were rendering, run once more
    if (_regenPending) queueRegenerateAll();
  }, 60);
}

    const renderList = (urls) => {
      currentUrls = (urls || []).slice();

      listBody.empty();
      previewInner.empty();
      tableBody.empty();
      codeBody.empty();
      currentPreviewUrl = null;

      selectedIndex = -1;

      if (!currentUrls.length) {
        listBody.createDiv({ cls: "git-table__empty", text: "No images found." });
        return;
      }

      currentUrls.forEach((url, idx) => {
        const name = filenameFromUrl(url);
        const row = listBody.createDiv({ cls: "git-table__item" });

        row.createDiv({ cls: "git-table__num", text: `${idx + 1}.` });
        row.createDiv({ cls: "git-table__file", text: name });

        // Click selection
        row.addEventListener("click", () => {
          const prev = listBody.querySelector(".git-table__item.is-selected");
          if (prev) prev.classList.remove("is-selected");
          row.classList.add("is-selected");
          selectedIndex = idx;
          setPreview(url);
        });
      });

      // select pending or first
      const items = listBody.querySelectorAll(".git-table__item");
      const pick = (pendingSelectIndex !== null && pendingSelectIndex !== undefined) ? pendingSelectIndex : 0;
      pendingSelectIndex = null;

      if (items.length) {
        const ix = Math.max(0, Math.min(items.length - 1, pick));
        items[ix].dispatchEvent(new MouseEvent("click"));
      }
    };

    const renderTablePreview = () => {
      tableBody.empty();

      if (!currentUrls.length) {
        tableBody.createDiv({ cls: "git-table__empty", text: "No images to generate." });
        return;
      }

      const htmlStr = buildPreviewTableHtml(currentUrls, colValue, titleEnabled ? titleText : "");
      const container = tableBody.createDiv({ cls: "git-table__tableRender" });
      container.innerHTML = htmlStr;

      container.querySelectorAll("a[href]").forEach((a) => {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const href = a.getAttribute("href");
          if (href) openUrlExternal(href);
        });
      });
    };

    
const renderCodeOutput = async (text, copiedNotice) => {
  codeBody.empty();

  const top = codeBody.createDiv({ cls: "git-table__codeTop" });
  const copyBtn = top.createEl("button", { cls: "git-table__copyBtn" });
  copyBtn.setText("COPY");

  const pre = codeBody.createEl("pre", { cls: "git-table__codePre" });
  const code = pre.createEl("code", { cls: "git-table__code" });
  code.setText(text);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(copiedNotice);
    } catch {
      new Notice("Copy failed");
    }
  });
};

const renderCode = async () => {
  if (!currentUrls.length) {
    codeBody.empty();
    codeBody.createDiv({ cls: "git-table__empty", text: "No images to generate code." });
    return;
  }

  const htmlStr = buildGalleryTableHtml(currentUrls, colValue, titleEnabled ? titleText : "");
  await renderCodeOutput(htmlStr, "Copied HTML to clipboard");
};


const renderLinks = async () => {
  if (!currentUrls.length) {
    codeBody.empty();
    codeBody.createDiv({ cls: "git-table__empty", text: "No images to list links." });
    return;
  }

  const linksStr = currentUrls.join("\n");
  await renderCodeOutput(linksStr, "Copied links to clipboard");
};
    // LIST controls

    moveUpBtn.addEventListener("click", () => {
      if (selectedIndex < 0 || selectedIndex >= currentUrls.length) {
        new Notice("Select an image in LIST first.");
        return;
      }
      if (selectedIndex === 0) return;

      const tmp = currentUrls[selectedIndex - 1];
      currentUrls[selectedIndex - 1] = currentUrls[selectedIndex];
      currentUrls[selectedIndex] = tmp;

      pendingSelectIndex = selectedIndex - 1;
      foundBadge.setText(`FOUNDED: ${currentUrls.length}`);
      renderList(currentUrls);
      queueRegenerateAll();
    });

    moveDownBtn.addEventListener("click", () => {
      if (selectedIndex < 0 || selectedIndex >= currentUrls.length) {
        new Notice("Select an image in LIST first.");
        return;
      }
      if (selectedIndex === currentUrls.length - 1) return;

      const tmp = currentUrls[selectedIndex + 1];
      currentUrls[selectedIndex + 1] = currentUrls[selectedIndex];
      currentUrls[selectedIndex] = tmp;

      pendingSelectIndex = selectedIndex + 1;
      foundBadge.setText(`FOUNDED: ${currentUrls.length}`);
      renderList(currentUrls);
      queueRegenerateAll();
    });

    deleteBtn.addEventListener("click", () => {
      if (selectedIndex < 0 || selectedIndex >= currentUrls.length) {
        new Notice("Select an image in LIST first.");
        return;
      }

      const removed = currentUrls.splice(selectedIndex, 1)[0];
      deleteStack.push({ url: removed, index: selectedIndex });
      updateUndoState();

      foundBadge.setText(`FOUNDED: ${currentUrls.length}`);
      pendingSelectIndex = Math.min(selectedIndex, currentUrls.length - 1);
      renderList(currentUrls);
      queueRegenerateAll();
    });

    undoBtn.addEventListener("click", () => {
      if (!deleteStack.length) return;

      const last = deleteStack.pop();
      updateUndoState();

      const insertIndex = Math.max(0, Math.min(currentUrls.length, last.index));
      currentUrls.splice(insertIndex, 0, last.url);

      foundBadge.setText(`FOUNDED: ${currentUrls.length}`);
      pendingSelectIndex = insertIndex;
      renderList(currentUrls);
      queueRegenerateAll();
    });

    // PREVIEW download
    downBtn.addEventListener("click", async () => {
      const url = currentPreviewUrl;
      if (!url) {
        new Notice("No image selected to download.");
        return;
      }

      const dir = (this.plugin.settings.downloadDir || "").trim();

      try {
        await ensureFolderPath(this.app, dir);

        const filename = filenameFromUrl(url) || "image";
        const path = uniqueFilePath(this.app, dir, filename);

        const safeUrl = toSafeHttpsUrl(url);
        if (!safeUrl) throw new Error("Blocked download from a non-allowed URL.");

        const res = await fetchWithTimeout(safeUrl.href, {}, 30000);
        if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
        const buf = await res.arrayBuffer();

        await this.app.vault.createBinary(path, buf);
        new Notice(`Saved: ${path}`);
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        new Notice(msg);
      }
    });


// PREVIEW: Download ALL images currently in LIST (in current order)
downAllBtn.addEventListener("click", async () => {
  if (!currentUrls.length) {
    new Notice("No images in LIST to download.");
    return;
  }

  const dir = (this.plugin.settings.downloadDir || "").trim();
  const total = currentUrls.length;

  try {
    await ensureFolderPath(this.app, dir);

    let ok = 0;
    let fail = 0;

    for (let i = 0; i < total; i++) {
      const url = currentUrls[i];
      const filename = filenameFromUrl(url) || `image-${i + 1}`;

      status.setText(`Downloading ${i + 1}/${total}: ${filename}`);

      try {
        const path = uniqueFilePath(this.app, dir, filename);

        const safeUrl = toSafeHttpsUrl(url);
        if (!safeUrl) throw new Error("Blocked download from a non-allowed URL.");

        const res = await fetchWithTimeout(safeUrl.href, {}, 30000);
        if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

        const buf = await res.arrayBuffer();
        await this.app.vault.createBinary(path, buf);
        ok++;
      } catch (e) {
        fail++;
      }

        await sleep(120);
    }

    status.setText("");
    if (fail === 0) new Notice(`Downloaded ${ok}/${total} images to: ${dir}`);
    else new Notice(`Downloaded ${ok}/${total} images (failed: ${fail}) to: ${dir}`);
  } catch (err) {
    status.setText("");
    const msg = (err && err.message) ? err.message : String(err);
    new Notice(msg);
  }
});

    // Settings buttons
    genBtn.addEventListener("click", async () => { codeMode = "html"; await regenerateAll(); });

    linksBtn.addEventListener("click", async () => { codeMode = "links"; await regenerateAll(); });

    // Scan
    const scan = async () => {
      const val = input.value.trim();
      if (!val) return;

      if (this._abort) this._abort.abort();
      this._abort = new AbortController();

      setLoading(true);
      foundBadge.setText("FOUNDED: 0");
      listBody.empty();
      previewInner.empty();
      tableBody.empty();
      codeBody.empty();
      currentPreviewUrl = null;

      try {
        const { urls, truncated } = await listImagesFromGitHubLink(val, this.plugin.settings.githubToken, this._abort.signal);

        // New scan resets delete stack (undo history)
        deleteStack = [];
        updateUndoState();

        foundBadge.setText(`FOUNDED: ${urls.length}`);
        pendingSelectIndex = 0;
        renderList(urls);
        await regenerateAll();

        if (truncated) {
          status.setText("Note: GitHub returned a truncated file tree (repo is very large). Results may be incomplete.");
        } else {
          status.setText("");
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
        const msg = (err && err.message) ? err.message : String(err);
        new Notice(msg);
        status.setText(msg);
      } finally {
        setLoading(false);
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        scan();
      }
    });

    setTimeout(() => input.focus(), 0);
  }

  onClose() {
    if (this._abort) this._abort.abort();
    this.contentEl.empty();
  }
}

class GitTablePlugin extends Plugin {
  async onload() {
    await this.loadSettings();

        // Custom ribbon icon (glyph)
    addIcon("git-table-launch", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <text x="12" y="12" text-anchor="middle" dominant-baseline="central"
        font-size="22" font-weight="700" fill="currentColor">󰦦</text>
</svg>`);

this.addRibbonIcon("git-table-launch", "GIT Table", () => new GitTableModal(this.app, this).open());

    this.addCommand({
      id: "open-git-table",
      name: "Open GIT Table",
      callback: () => new GitTableModal(this.app, this).open()
    });

    this.addSettingTab(new GitTableSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign(
      { githubToken: "", downloadDir: "" },
      await this.loadData()
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class GitTableSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "GIT Table Settings" });


// Description (shown in Obsidian Settings)
const desc = containerEl.createDiv({ cls: "git-table__settingsDesc" });

desc.createEl("p", {
  text: "GIT Table helps you build an HTML table gallery from a GitHub folder/repo of images. Reorder, preview, download, and generate code directly inside Obsidian."
});

const ul = desc.createEl("ul");
ul.createEl("li", { text: "Scan a GitHub link to populate [LIST] with image filenames." });
ul.createEl("li", { text: "Reorder items with ↑ / ↓ to control the final gallery order." });
ul.createEl("li", { text: "Preview images and download one (DOWN) or all (DOWN ALL) into your vault." });
ul.createEl("li", { text: "Generate HTML (GENERATE) or a plain URL list (LINKS)." });

const sec = desc.createEl("p");
sec.createEl("strong", { text: "Security:" });
sec.appendText(" only https GitHub hosts are allowed for opening/downloading. GitHub tokens (if used) are stored by Obsidian in plaintext on disk.");

    new Setting(containerEl)
      .setName("GitHub token (optional)")
      .setDesc("Optional. Used for private repos or higher API rate limits. NOTE: Obsidian stores plugin settings in plaintext on disk — treat this token as sensitive.")
      .addText((text) => {
        text
          .setPlaceholder("ghp_…")
          .setValue(this.plugin.settings.githubToken || "")
          .onChange(async (value) => {
            this.plugin.settings.githubToken = (value || "").trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Download directory")
      .setDesc("Vault-relative folder where DOWN saves images (created automatically). Example: Attachments/GitTable")
      .addText((text) => {
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.downloadDir || "")
          .onChange(async (value) => {
            this.plugin.settings.downloadDir = (value || "").trim();
            await this.plugin.saveSettings();
          });
      });
  }
}

module.exports = GitTablePlugin;
