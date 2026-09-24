<div align="center">

<img src="build/icon-256.png" width="96" height="96" alt="LitBoard icon">

# LitBoard

**A local literature workspace built around an AI research assistant**

**English** · [简体中文](README.zh-CN.md) · [Feature tour (Chinese)](docs/feature-tour.md) · [Download for Windows](https://github.com/L1nze/LitBoard/releases)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform: Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D6.svg)](#get-started)

</div>

LitBoard brings an AI assistant into the library and reader: open a paper to ask questions, inspect evidence, find related research, and explore its citation network. Folder import, web capture, PDF / EPUB reading, annotations, and search share one Windows app, reducing reliance on a patchwork of plugins and tools. The library stays on your computer by default, with Nutstore WebDAV sync and AI services available when needed; import, reading, and research workflows are also designed to stay responsive as the library grows.

## Screenshots

These six screenshots use a light theme. The AI conversation and citation graph come from an isolated copy of the same session; the other screens use demo data. Click an image to view it at full size. The interface shown is in Chinese.

<table>
  <tr>
    <td width="33.3%" align="center"><a href="docs/assets/screenshots/agent.png"><img src="docs/assets/screenshots/agent.png" alt="AI research assistant finding papers and building a citation graph" width="100%"></a><br><strong>AI research assistant</strong></td>
    <td width="33.3%" align="center"><a href="docs/assets/screenshots/citation-graph.png"><img src="docs/assets/screenshots/citation-graph.png" alt="Citation network from the AI session" width="100%"></a><br><strong>Citation network</strong></td>
    <td width="33.3%" align="center"><a href="docs/assets/screenshots/library.png"><img src="docs/assets/screenshots/library.png" alt="Library statistics and paper details" width="100%"></a><br><strong>Library and details</strong></td>
  </tr>
  <tr>
    <td width="33.3%" align="center"><a href="docs/assets/screenshots/reader.png"><img src="docs/assets/screenshots/reader.png" alt="Built-in PDF reader beside a paper record" width="100%"></a><br><strong>PDF reading</strong></td>
    <td width="33.3%" align="center"><a href="docs/assets/screenshots/search.png"><img src="docs/assets/screenshots/search.png" alt="Visual query builder" width="100%"></a><br><strong>Combined search</strong></td>
    <td width="33.3%" align="center"><a href="docs/assets/screenshots/citation.png"><img src="docs/assets/screenshots/citation.png" alt="APA, GB/T 7714, and MLA citation previews" width="100%"></a><br><strong>Citation previews</strong></td>
  </tr>
</table>

## Highlights

- **An AI assistant at the center of literature research:** Ask questions beside a paper, search for related work, inspect full text, check claims, and explore citation links in an interactive graph. Tool activity and sources remain available for review; you make the final judgment.
- **Common capabilities in one app:** Folder import and duplicate checks, PDF / EPUB reading, OCR, annotations, notes, full-text search, and citation management share one workspace, reducing the need to assemble a workflow from separate plugins.
- **Responsive work with larger libraries:** Incremental saving, indexed search, batch import, and reader rendering are designed to reduce delays as a library grows.
- **Local-first data management:** The main library is stored on your computer by default and supports snapshots. Nutstore WebDAV sync is optional, and AI research data is kept separate from the main library.

## AI assistant: from a paper to the wider literature

Ask about a paper's methods, figures, or related work while reading it. The assistant can inspect indexed PDF and EPUB text by page or chapter. With a vision-capable model, it can also view rendered pages when formulas, figures, or scans call for visual inspection. Its answer states what it actually read so you can check the original.

For a research question or a passage of prose, the assistant can search the main library, its separate research library, OpenAlex, Semantic Scholar, and optionally Scopus with an Elsevier API key. For claim checking, it separates individual claims and shows candidate papers with relevant abstract sentences, distinguishing support from partial relevance or no source found. Citation links can be turned into an interactive graph for exploring nearby work.

Conversations and tool activity can be saved, resumed, or retried. You configure the model endpoint, embedding model, and credentials; model requests and online searches use external services. Collecting a paper or PDF into the main library requires confirmation and a duplicate check. Manual literature search remains available without an AI service.

For related background, see my advisor's open-source project [PAPER-SQL](https://github.com/galois-yan/PAPER-SQL).

## Integrated library and reading tools

- **Continue from existing material:** A wizard imports papers, collections, attachments, notes, and annotations from a local Zotero library. Repeated imports fill gaps without overwriting local edits or changing the original Zotero library.
- **Collect in one place:** Import PDF, BibTeX, RIS, CSL-JSON, or local document folders. A Chrome / Edge extension can save records from supported academic pages. Imports check for duplicate records and keep attachments linked to their papers.
- **Read and find material:** Open PDFs, EPUBs, and web snapshots in tabs. Use outlines, in-document search, OCR for scanned pages, and annotations; notes can link back to the source. Search covers metadata, notes, annotations, and indexed document text with combined filters.
- **Use citations when needed:** Insert and refresh CSL citations and bibliographies in Word, or export BibTeX. The library and reader work independently of these features.

## Responsiveness with larger libraries

- **Import batches without rescanning the library for each paper:** Build fingerprint and DOI matching indexes once, parse PDFs with three concurrent workers, and save an imported folder tree together.
- **Render only the part of a long PDF being read:** The reader prioritizes the visible page and its neighbors. During continuous zooming it previews the existing image immediately, then redraws a sharp page when the gesture stops.
- **Avoid repeated work during AI search:** When another search returns a paper whose title and abstract have not changed, the research library keeps its existing full-text index entry. Result lists are paged without counting every match on each request.
- **Compute citation graphs without occupying the main window:** Official Windows x64 builds run community detection, ranking, and layout in an asynchronous Rust module, leaving the window able to handle interaction.

## Get started

LitBoard provides installer and portable builds for Windows x64 on [GitHub Releases](https://github.com/L1nze/LitBoard/releases). See the [download guide](docs/release.md) for file descriptions and checksum instructions. Packaged builds do not require a separate Node.js installation.

1. **Create a library:** Use **Import files** for PDF, BibTeX, RIS, or CSL-JSON, or drop in a local document folder. For an existing Zotero library, open **Settings → Integrations → Zotero local library** to start the import wizard.
2. **Enable the AI assistant:** Enter a model endpoint, model, and credentials in Settings. Configure an embedding model if you want vector search. Manual literature search does not require an AI service.
3. **Protect and sync data:** Choose a snapshot location under **Settings → Data & backup**. Add your own Nutstore WebDAV account if you want sync across computers.

Folder import supports PDF, EPUB, DjVu, MOBI, AZW3, DOC, DOCX, ODT, and RTF. Drop a folder onto a collection to import there, or elsewhere in the window to use the selected collection. You can stop an import while keeping items already processed. See the [feature tour](docs/feature-tour.md) for demonstrations.

### Browser extension

To collect papers from academic websites, enable Developer mode on the Chrome / Edge extensions page and load the unpacked extension: `resources/extension/` under the installed app directory, or `extension/` in the project root for development. Then open **Extension** in LitBoard, enable its local receiver, and enter the displayed port and token in the extension options.

## Data, sync, and updates

The main library, notes, and managed attachments are stored under `%APPDATA%\LitBoard` by default, or in a data directory you choose. Snapshots can be created and restored under **Data & backup**. Nutstore WebDAV sync is optional.

The app checks GitHub Releases for newer stable builds and shows a download notice; you can also check in Settings. You complete the upgrade yourself after downloading. Make a snapshot first. Current builds are not code-signed, so Windows SmartScreen may show an unrecognized-publisher warning; verify the published SHA-256 checksum before running a downloaded build.

## Run from source

Development requires Node.js 22.13.0 or newer. Project scripts install Electron and build tools under `%LOCALAPPDATA%\LitBoardBuildTools`, keeping the repository free of `node_modules`.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd start
npm.cmd run dist:nobump
```

`npm run dist` increments the patch version before packaging. Use `dist:nobump` when you need a build of the current version.

## License and third-party components

LitBoard's own code is licensed under [MIT](LICENSE). Packaged builds also include MuPDF.js under AGPL-3.0-or-later and other components under their own licenses; the root MIT license does not replace those terms. See the [third-party component inventory](docs/THIRD-PARTY.md) for bundled components, license files, and design influences that are not distributed with the app.
