<div align="center">

<img src="build/icon-256.png" width="96" height="96" alt="LitBoard icon">

# LitBoard

**A local research workspace for collecting, reading, and citing papers**

**English** · [简体中文](README.zh-CN.md) · [Feature tour (Chinese)](docs/feature-tour.md) · [Release and downloads](docs/release.md)

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)
[![Platform: Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D6.svg)](#install)

</div>

LitBoard keeps a literature library, PDF and EPUB reading, annotations, notes, search, and Word citations in one Windows app. Your library lives on your computer. WebDAV sync and the AI research assistant are optional.

## From paper to draft

| Step | What LitBoard does |
| --- | --- |
| Collect | Import PDFs, BibTeX, RIS, CSL-JSON, folders of PDFs, or a local Zotero library. The Chrome/Edge extension saves records from supported academic sites. |
| Read | Open PDFs, EPUBs, and web snapshots in tabs. Search within a PDF, navigate its outline, and use OCR for scanned pages. |
| Annotate | Highlight, underline, and comment in PDFs. Send annotations to notes that link back to their source. PDF annotations can be written back to the file. |
| Find | Search metadata, notes, annotations, and indexed document text. Combine filters and save a query as a smart folder. |
| Write | Insert and refresh citations and bibliographies in Microsoft Word using CSL styles, or export BibTeX for LaTeX and Typst. |

## AI research assistant

Give the assistant a paragraph from a draft, and it can split it into claims, find candidate papers for each one, inspect evidence in their abstracts, and distinguish supported claims from partial matches or claims with no source found. You can then ask about a paper's methods, a figure, or its place in the surrounding literature.

- **Discover papers:** Search the main and separate research libraries, then look for new work through OpenAlex and Semantic Scholar. Scopus search is available when you configure an Elsevier key. Keyword and paragraph-level semantic search cover different kinds of questions.
- **Check claims:** Find candidates for each claim and show the relevant abstract sentences and sources. A similar title alone is not treated as supporting evidence.
- **Read further:** Read indexed PDF or EPUB text by page or chapter, and temporarily extract the text of an open-access paper. With a vision-capable model, render pages containing formulas, figures, or scans, while stating which pages were actually examined.
- **Follow connections:** Expand citation links into an interactive graph to explore related work.
- **Keep useful results:** Conversations and tool activity can be resumed or retried. Collecting discovered papers or downloaded PDFs into the main library requires confirmation and uses the library's duplicate checks.

Research activity is stored separately from the main library. You configure the model endpoint, embedding model, and credentials; manual literature search remains available without an AI service. Model requests and online searches use external services, while the local library remains usable offline.

## Install

LitBoard targets Windows x64 installer and portable builds. See the [release and download instructions](docs/release.md); actual downloads depend on the assets listed on the repository's Releases page.

1. Run the installer, or launch the portable build.
2. Drop in a PDF, BibTeX, RIS, or CSL-JSON file. You can also drag a folder of PDFs into the folder sidebar.
3. For an existing Zotero library, open **Settings → Integrations → Zotero local library**.
4. Open **Settings → Data & backup** and choose a snapshot location before accumulating important work.

The packaged app needs no Node.js installation. Microsoft Word is needed only for direct Word citation insertion.

### Browser extension

The Chrome/Edge extension connects to a receiver inside LitBoard. Open **Extension** in the app, enable the receiver, and copy its token. In the browser's extension page, enable Developer mode and load the unpacked extension directory: use `resources/extension/` under the installed app directory, or `extension/` in the project root for development. Enter the port and token in the extension options.

## Data, sync, and updates

- The main library, notes, and managed attachments are stored locally, under `%APPDATA%\LitBoard` by default or in a directory you choose.
- Optional multi-computer sync uses your own Nutstore WebDAV account. Snapshots and restore are available under **Data & backup**.
- There is no automatic updater. Download a new build and install it over the old one; take a snapshot first when your library matters to you.
- Builds are not code-signed. Windows SmartScreen may show an unrecognized-app warning; verify the download against its published SHA-256 checksum before running it.

## Run from source

Development requires Node.js 22.13.0 or newer. Project scripts install Electron and build tools outside the repository; do not create `node_modules` here.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd start
npm.cmd run dist:nobump
```

`npm run dist` increments the patch version before packaging. Use `dist:nobump` when you need a build of the current version.

## License and third-party components

LitBoard's own code is licensed under [AGPL-3.0-only](LICENSE). Vendored components retain their respective licenses; see the [third-party component inventory](docs/THIRD-PARTY.md) for details.
