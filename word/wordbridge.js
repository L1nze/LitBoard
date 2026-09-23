// LitBoard Word COM helper, kept alive by cscript //Nologo wordbridge.js.
// Node drives stdin/stdout. String values use base64(UTF-8); lists use ';'.
// Protocol v3 (base64 fields only - NEVER JSON: the cscript/WSH host does not
// guarantee a native JSON object, and //B mode dies silently on the error):
//   request : REQ|b64(requestId)|b64(sessionId)|b64(documentId)|b64(line)
//             (the Node side composes "line" in the legacy command format)
//   response: RES|1|b64(requestId)|b64(sessionId)|b64(result)
//             RES|0|b64(requestId)|b64(sessionId)|b64(errorMessage)
//   PING / INFO also answer as legacy lines (OK/ERR) when sent bare.
var stdin = WScript.StdIn, stdout = WScript.StdOut;
var word = null;

function b64decode(b64) {
  var clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  var bytes = [];
  for (var i = 0; i < clean.length; i += 4) {
    var c0 = clean.charAt(i), c1 = clean.charAt(i + 1), c2 = clean.charAt(i + 2), c3 = clean.charAt(i + 3);
    var e0 = B64_TABLE.indexOf(c0), e1 = B64_TABLE.indexOf(c1);
    var e2 = c2 === '=' ? -2 : B64_TABLE.indexOf(c2), e3 = c3 === '=' ? -2 : B64_TABLE.indexOf(c3);
    if (e0 < 0 || e1 < 0) break;
    bytes.push((e0 << 2) | (e1 >> 4));
    if (e2 >= 0) bytes.push(((e1 & 15) << 4) | (e2 >> 2));
    if (e3 >= 0 && e2 >= 0) bytes.push(((e2 & 3) << 6) | e3);
  }
  var out = '', c, c2, c3, cp;
  for (i = 0; i < bytes.length; i++) {
    c = bytes[i];
    if (c < 128) { out += String.fromCharCode(c); continue; }
    if (c > 191 && c < 224) { out += String.fromCharCode(((c & 31) << 6) | (bytes[i + 1] & 63)); i++; continue; }
    if (c > 239) {
      cp = ((c & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
      cp -= 0x10000;
      out += String.fromCharCode(0xD800 | (cp >> 10), 0xDC00 | (cp & 1023));
      i += 3;
      continue;
    }
    c2 = bytes[i + 1]; c3 = bytes[i + 2];
    out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
    i += 2;
  }
  return out;
}
function utf8bytes(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i), next;
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      next = s.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        c = 0x10000 + ((c - 0xD800) << 10) + (next - 0xDC00);
        i++;
      }
    }
    if (c < 128) { out.push(c); continue; }
    if (c < 2048) { out.push(192 | (c >> 6), 128 | (c & 63)); continue; }
    if (c < 65536) { out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); continue; }
    out.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  return out;
}
var B64_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64encode(s) {
  var bytes = utf8bytes(s);
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : -1, b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
    out += B64_TABLE.charAt(b0 >> 2);
    out += B64_TABLE.charAt(((b0 & 3) << 4) | (b1 < 0 ? 0 : (b1 >> 4)));
    out += b1 < 0 ? '=' : B64_TABLE.charAt(((b1 & 15) << 2) | (b2 < 0 ? 0 : (b2 >> 6)));
    out += b2 < 0 ? '=' : B64_TABLE.charAt(b2 & 63);
  }
  return out;
}

function wordState() {
  // -1 dead/stale reference, 0 usable, 1 hidden instance with zero documents.
  // A hidden empty instance is an automation leftover: it squats on the ROT
  // "Word.Application" registration and GetObject only ever reaches the oldest
  // entry, so without cleanup every later attach would hit the ghost instead of
  // the user's real instance.
  try { return (!word.Visible && word.Documents.Count === 0) ? 1 : 0; }
  catch (e) { return -1; }
}
function quitGhost() {
  try { word.DisplayAlerts = 0; } catch (e0) {}
  try { word.Quit(0); } catch (e1) {}
}
function connect() {
  for (var tries = 0; tries < 8; tries++) {
    if (word) {
      // Revalidate the cached instance on every command: the user may have
      // closed Word since (dead reference) or it degraded into a ghost.
      var cached = wordState();
      if (cached === 0) return true;
      if (cached === 1) quitGhost();
      word = null;
    }
    try { word = GetObject('', 'Word.Application'); } catch (e1) { word = null; return false; }
    var fresh = wordState();
    if (fresh !== 1) return true;
    quitGhost();
    word = null;
    // Let the revoked ROT entry disappear before attaching to the next one.
    try { WScript.Sleep(250); } catch (e2) {}
  }
  return false;
}
function findDoc(path) {
  for (var i = 1; i <= word.Documents.Count; i++) {
    var d = word.Documents.Item(i);
    if (d.FullName.toLowerCase() === path.toLowerCase() || d.Name.toLowerCase() === path.toLowerCase()) return d;
  }
  return null;
}
/* Zotero-style field insertion (zotero-word-for-windows-integration insertFieldRaw):
 * create a benign placeholder field, then rewrite the code in full. Creating an
 * ADDIN field directly is broken on Word 2016 COM: wdFieldEmpty (-2) throws
 * "Value out of range", and a bare type (-1) appends \* MERGEFORMAT whose result
 * assignment silently drops - leaving the raw JSON code visible in the document. */
function addLitField(range, code) {
  var field = range.Fields.Add(range, 35 /* wdFieldQuote */, 'PLACEHOLDER', true);
  field.Code.Text = code;
  return field;
}
function showResultView(doc) {
  // Zotero does the same on document init: Word remembers the per-window
  // "show field codes" toggle and would otherwise display raw field JSON.
  try {
    var win = doc.Application.ActiveWindow;
    if (win && win.View && win.View.ShowFieldCodes) win.View.ShowFieldCodes = false;
  } catch (e) {}
}
/* ---------------- rich text into a field result ----------------
 * Word's Range.Text takes PLAIN TEXT only: HTML or RTF assigned to it shows up as
 * literal characters (that is how "<sup>[1-3]</sup>" ended up printed in documents).
 * Zotero solves this the same way - it writes the RTF to a temporary file and lets
 * Word import that file into the field result range. citeproc's rtf output is pure
 * ASCII (every non-ASCII char is a \uNNNN escape), so writing it as ASCII is safe.
 * Do NOT empty the result first: an empty result loses the field binding and the
 * imported text lands OUTSIDE the field (measured on Word 2016). */
function tempRtfPath() {
  var dir = '';
  try { dir = fso().GetSpecialFolder(2).Path; } catch (e) { dir = ''; }
  if (!dir) dir = '.';
  return dir + '\\litboard-' + new Date().getTime() + '-' + Math.floor(Math.random() * 100000) + '.rtf';
}
/* An RTF stream that ends right after a {\super ...} group closes the group on paper,
 * but Word still leaves the "current typing format" at the end of the imported stream
 * in the last state it saw (measured on Word 2016: after inserting a citation the
 * user's next characters continue as superscript). Close the stream with \nosupersub
 * so the trailing state is pinned to "neither super nor sub". */
function withTrailingNosupersub(rtfText) {
  var t = String(rtfText || '');
  if (t.slice(0, 5) !== '{\\rtf') return t;
  return t.replace(/\}\s*$/, '\\nosupersub}');
}
function insertRtfFile(range, rtfText) {
  var path = tempRtfPath();
  var stream = null;
  try {
    stream = fso().CreateTextFile(path, true, false);
  } catch (eC) {
    throw new Error('RTF temp file could not be created (' + path + '): ' + eC.message);
  }
  try {
    stream.Write(withTrailingNosupersub(rtfText));
    stream.Close();
  } catch (eW) {
    throw new Error('RTF temp file could not be written (' + path + '): ' + eW.message);
  }
  try {
    range.InsertFile(path);
  } catch (eI) {
    throw new Error('Failed to import RTF into the field result: ' + eI.message);
  } finally {
    try { fso().DeleteFile(path); } catch (eD) {}
  }
}
function isRtfDocument(value) {
  return String(value || '').indexOf('{\\rtf') === 0;
}
/* InsertFile appends a paragraph mark INSIDE the field result (Zotero's field.cpp deletes the
 * same return: "the return that gets added at the end"). For a single-line citation that phantom
 * paragraph is the whole swallowed-typing bug: the field spans an empty line, its shading covers
 * it, a click right after the citation lands INSIDE the field (end of its first paragraph), and
 * everything the user types or Enters there joins the result. Delete the trailing return - but
 * only when the content has no paragraph breaks of its own (bibliography entries keep theirs). */
function deleteTrailingReturn(field) {
  var result = null;
  try { result = field.Result; } catch (e1) { result = null; }
  if (!result) return;
  try {
    var tail = result.Duplicate;
    tail.Collapse(0 /* wdCollapseEnd */);
    tail.MoveStart(1 /* wdCharacter */, -1);
    if (tail.Text === '\r') tail.Text = '';
  } catch (e2) {}
}
/* The citation must look like the sentence it sits in. The font is read from the character just
 * BEFORE the field, not from the field's own result: a result that already carries the RTF's
 * default font (every citation written before this fix) would otherwise be "preserved" forever -
 * measured: refreshing a Times New Roman citation left it Times New Roman. Falls back to the
 * result's current font only when there is no character in front of the field. */
function fontBeforeField(doc, field) {
  var out = { name: '', size: 0 };
  var start = -1;
  try { start = field.Code.Start; } catch (e1) { start = -1; }
  if (start > 0) {
    try {
      var probe = doc.Range(start - 1, start);
      out.name = probe.Font.Name;
      out.size = probe.Font.Size;
    } catch (e2) { out.name = ''; }
  }
  return out;
}
/* InsertFile carries the RTF's own default font. Measured on Word 16.0: writing a citation RTF
 * into the result switched it from the document font (SimSun) to Times New Roman, and the next
 * sentence the user typed came out in that font as well (their complaint: "why is my text in the
 * same font as the inserted superscript instead of Word's font"). Zotero keeps the font across
 * the insert the same way (field.cpp setText reads Font.Name/Size before InsertFile and writes
 * them back after); name/size only, so the superscript look of the citation survives.
 * The write-back MUST re-read field.Result: the range object captured before InsertFile no
 * longer covers the inserted text (measured - reusing it silently did nothing). */
function writeFieldText(field, value, doc) {
  if (!field) return;
  var result = null;
  try { result = field.Result; } catch (e1) { result = null; }
  if (!result) return;
  if (!isRtfDocument(value)) { result.Text = value; return; }
  var name = '', size = 0;
  var ctx = doc ? fontBeforeField(doc, field) : null;
  if (ctx && ctx.name) { name = ctx.name; size = ctx.size; }
  else {
    try { name = result.Font.Name; size = result.Font.Size; } catch (e2) { name = ''; }
  }
  insertRtfFile(result, value);
  if (value.indexOf('\\par') === -1) deleteTrailingReturn(field);
  if (!name) return;
  var after = null;
  try { after = field.Result; } catch (e3) { after = null; }
  if (!after) return;
  try { after.Font.Name = name; } catch (e4) {}
  try { if (size) after.Font.Size = size; } catch (e5) {}
}
/* Park the insertion point AFTER the field so the user's next words do not join the citation.
 * Word counts the spot at the end of a field's result as inside the field; get_Result().End is
 * exactly that spot, so collapse there and then step over the end-of-field mark with MoveRight -
 * the same thing a single Right arrow does in Word. Measured on Word 16.0 (app's own INSERT and
 * APPLY field codes, RTF written the same way): without the step the caret sits at the result
 * end, with it the caret is past the field and typed text stays out of the result.
 * NOTE: Field.Range returns null on this Word, so the field's own range cannot be used here.
 * Super/subscript is cleared as well: the result ends with a superscript "]", and Word carries
 * that character format into the typing point (measured: the next sentence came out superscript).
 * Font.Superscript/Subscript are tri-state Longs; 0 is False, not "toggle". */
function placeCursorAfterField(field, app) {
  if (!field || !app) return;
  var result = null, resultEnd = 0;
  try { result = field.Result; } catch (e1) { result = null; }
  if (!result) return;
  try { resultEnd = result.End; } catch (e2) { resultEnd = 0; }
  try {
    var rng = result.Duplicate;
    rng.Collapse(0 /* wdCollapseEnd */);
    rng.Select();
    var sel = app.Selection;
    // Step out of the field (bounded: only while the caret is still inside, never past the need).
    var tries = 0;
    while (tries < 2 && resultEnd && sel.Range.Start <= resultEnd) {
      sel.MoveRight(1 /*wdCharacter*/, 1, 0 /*wdMove*/);
      tries++;
    }
    sel.Font.Superscript = 0;
    sel.Font.Subscript = 0;
  } catch (e3) {}
}
/* Bibliography entries (RTF fragments, ALREADY decoded by the caller) are joined into one
 * RTF document; the wrapper is added here. Entries end with a literal \r\n, which RTF treats
 * as layout whitespace only - paragraphs have to come from an explicit \par, otherwise every
 * entry collapses into a single paragraph (verified: join("") -> one paragraph in Word). */
function assembleBibliographyRtf(entries) {
  return '{\\rtf ' + entries.join('\\par ') + '}';
}
/* Paragraph format of the bibliography, derived from the CSL style by the caller
 * (Zotero.Cite.getBibliographyFormatParameters rules, values in twips):
 *   "mode,indent,firstLineIndent,entrySpacing,lineSpacing,tabStops"
 * Word wants points (twips / 20); tabStops may hold several stops separated by '+'.
 * lineSpacing is a multiple factor and is only applied when the style asks for more
 * than single spacing (setting it unconditionally forces "exactly 12pt" on everyone). */
function applyBibliographyFormat(range, spec) {
  var values = String(spec || '').split(',');
  if (values.length < 5) return;
  var indent = parseFloat(values[1]) || 0;
  var firstLine = parseFloat(values[2]) || 0;
  var entrySpacing = parseFloat(values[3]) || 0;
  var lineSpacing = parseFloat(values[4]) || 0;
  var tabSpec = String(values[5] || '').split('+');
  try {
    var pf = range.ParagraphFormat;
    if (indent) pf.LeftIndent = indent / 20;
    if (firstLine) pf.FirstLineIndent = firstLine / 20;
    if (entrySpacing) pf.SpaceAfter = entrySpacing / 20;
    if (lineSpacing > 1) { pf.LineSpacingRule = 5 /* wdLineSpaceMultiple */; pf.LineSpacing = 12 * lineSpacing; }
    if (tabSpec.length && tabSpec[0] !== '') {
      pf.TabStops.ClearAll();
      for (var i = 0; i < tabSpec.length; i++) {
        var stop = parseFloat(tabSpec[i]);
        if (!isNaN(stop) && stop >= 0) pf.TabStops.Add(stop / 20);
      }
    }
  } catch (eF) {}
}
/* Safety net for the caret, applied at the end of every command that rewrites fields: whatever a
 * preceding step did (insert, code rewrite, refresh), the next sentence the user types must not
 * end up inside a citation. If the caret sits inside one of our fields' results, put it after
 * that field. Only acts when the caret really is inside one, so a caret parked elsewhere in the
 * document is never moved. */
function ejectCaretFromLitFields(doc, app) {
  if (!doc || !app) return;
  var sel = null;
  try { sel = app.Selection; } catch (e0) { return; }
  var fields = documentFields(doc);
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (!isLitField(f)) continue;
    var rs = 0, re = 0, caret = 0;
    try { rs = f.Result.Start; re = f.Result.End; } catch (e1) { continue; }
    try { caret = sel.Range.Start; } catch (e2) { return; }
    if (caret >= rs && caret <= re) { placeCursorAfterField(f, app); return; }
  }
}
function isLitField(f) {
  try { return f.Code.Text.indexOf('LitBoard.Citation') !== -1; } catch (e) { return false; }
}
function isManagedField(f) {
  try { return /LitBoard\.(Citation|Bibliography)\.1/.test(f.Code.Text); } catch (e) { return false; }
}
function bibliographyFields(doc) {
  // ES3 only: cscript's JScript lacks Array.prototype.filter (verified on this box).
  var out = [], fields = documentFields(doc);
  for (var i = 0; i < fields.length; i++) {
    try { if (fields[i].Code.Text.indexOf('LitBoard.Bibliography.1') !== -1) out.push(fields[i]); } catch (e) {}
  }
  return out;
}
/* ES3-safe serializer for the bibliography field payload {version:1, entries:[b64...]}.
 * Native JSON is not guaranteed in the cscript host; entries are base64 (JSON-safe). */
function bibPayloadJson(entries) {
  var out = '{"version":1,"entries":[';
  for (var i = 0; i < entries.length; i++) {
    if (i) out += ',';
    out += '"' + entries[i] + '"';
  }
  return out + ']}';
}
/* Fields saved by builds before the own-paragraph fix sit jammed right after the
 * citation ("[1][1]Tian J..." on one line). The paragraph text before the result
 * then holds foreign visible content. Word's field begin/separator/end markers can
 * surface in .Text, but the (much longer) field CODE does not; comparing against
 * code length therefore lets a short citation such as [1-3] slip through forever. */
function bibFieldIsJammed(field, doc) {
  var fr = null;
  try { fr = field.Result; } catch (e1) { return false; }
  if (!fr) return false;
  var head = -1;
  try { head = fr.Paragraphs.Item(1).Range.Start; } catch (e2) { return false; }
  if (head < 0) return false;
  var before = '';
  try { before = doc.Range(head, fr.Start).Text; } catch (e3) { return false; }
  before = String(before || '').replace(/[\x13\x14\x15\r]/g, '');
  return before.length > 0;
}
function updateBibliography(doc, encodedEntries, formatSpec) {
  var entries = [], i;
  for (i = 0; i < encodedEntries.length; i++) if (encodedEntries[i]) entries.push(b64decode(encodedEntries[i]));
  var isRtf = String(formatSpec || '').split(',')[0] === 'rtf';
  // plain-text fallback: one paragraph mark between entries (\r\n used to insert an
  // extra empty paragraph between every pair, which is what made the huge gaps)
  var body = entries.length ? entries.join(isRtf ? '' : '\r') : '';
  var managed = bibliographyFields(doc);
  var payload = b64encode(bibPayloadJson(entries));
  var field = managed.length ? managed[0] : null;
  if (field && bibFieldIsJammed(field, doc)) {
    // delete (not cut - no clipboard stealing); recreation below lands it at the
    // document end on a paragraph of its own, leaving the citation paragraph intact.
    // Only clear the reference when the delete actually worked, otherwise the
    // recreation branch would leave a duplicate bibliography field behind.
    var deletedOk = false;
    try { field.Delete(); deletedOk = true; } catch (eDel) {}
    if (deletedOk) field = null;
  }
  if (!field) {
    /* The default insertion point is the tail of the last paragraph. Right after an
     * INSERT + refresh that paragraph is the one holding the fresh citation, so the
     * bibliography joined it in line ("[1][1]Tian J..." with no break - measured).
     * Make sure the field starts a paragraph of its own before creating it: the char
     * before the final paragraph mark is inspected - empty (bare final mark) or "\r"
     * means we already sit at a paragraph start, anything else gets a break inserted. */
    var prevChar = '';
    try { prevChar = doc.Range(doc.Content.End - 2, doc.Content.End - 1).Text; } catch (eTail) { prevChar = ''; }
    if (prevChar && prevChar !== '\r') {
      try { doc.Range(doc.Content.End - 1, doc.Content.End - 1).InsertParagraphBefore(); } catch (ePar) {}
    }
    var range = doc.Range(doc.Content.End - 1, doc.Content.End - 1);
    field = addLitField(range, ' ADDIN LitBoard.Bibliography.1 "' + payload + '"');
  } else {
    // rewriting the code strips the result formatting, so the content goes in afterwards
    field.Code.Text = ' ADDIN LitBoard.Bibliography.1 "' + payload + '"';
  }
  if (field.Result) {
    try {
      if (isRtf) writeFieldText(field, assembleBibliographyRtf(entries), doc);
      else field.Result.Text = body;
      applyBibliographyFormat(field.Result, formatSpec);
    } catch (eB) {
      throw new Error('Bibliography write failed (rtf=' + isRtf + ', entries=' + entries.length + '): ' + eB.message);
    }
  }
  for (i = managed.length - 1; i > 0; i--) { try { managed[i].Delete(); } catch (e2) {} }
}
function documentFields(doc) {
  var out = [], seen = [];
  try {
    for (var s = 1; s <= doc.StoryRanges.Count; s++) {
      var range = doc.StoryRanges.Item(s);
      var storyType = 0;
      try { storyType = range.StoryType; } catch (e0) {}
      if (storyType && storyType !== 1 && storyType !== 2 && storyType !== 3) continue;
      while (range) {
        for (var i = 1; i <= range.Fields.Count; i++) {
          var field = range.Fields.Item(i), duplicate = false;
          for (var j = 0; j < seen.length; j++) if (seen[j] === field) duplicate = true;
          if (!duplicate) { seen.push(field); out.push(field); }
        }
        try { range = range.NextStoryRange; } catch (e1) { range = null; }
      }
    }
  } catch (e2) {}
  if (!out.length) {
    for (var k = 1; k <= doc.Fields.Count; k++) out.push(doc.Fields.Item(k));
  }
  return out;
}
function docLitFields(doc) {
  var out = [];
  var fields = documentFields(doc);
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (!isLitField(f)) continue;
    var code = '', result = '';
    try { code = f.Code.Text; } catch (e1) {}
    try { result = f.Result ? f.Result.Text : ''; } catch (e2) {}
    out.push(b64encode(code) + '~' + b64encode(result));
  }
  return out;
}
function writeResult(result) {
  if (activeRequest) {
    // Protocol v3: RES|1|b64(requestId)|b64(sessionId)|b64(result)|  (5 fields, trailing empty error)
    // base64 fields only - NEVER JSON: the cscript/WSH host does not guarantee
    // a native JSON object, and //B mode dies silently on the error.
    stdout.WriteLine('RES|1|' + b64encode(activeRequest.requestId) + '|' +
      b64encode(activeRequest.sessionId || '') + '|' + b64encode(result) + '|');
  } else stdout.WriteLine('OK' + (result ? '|' + result : ''));
}
function ok() { writeResult(''); }
function okParts(parts) { writeResult(parts.join('|')); }
function err(e) {
  var msg = e && e.message ? e.message : String(e);
  if (activeRequest) {
    stdout.WriteLine('RES|0|' + b64encode(activeRequest.requestId) + '|' +
      b64encode(activeRequest.sessionId || '') + '||' + b64encode(msg));
  } else stdout.WriteLine('ERR|' + b64encode(msg));
}
var activeRequest = null;
function beginUndo(label) {
  try { if (word.UndoRecord) { word.UndoRecord.StartCustomRecord(label); return true; } } catch (e) {}
  return false;
}
function endUndo() {
  try { word.UndoRecord.EndCustomRecord(); } catch (e) {}
}
function fso() { return new ActiveXObject('Scripting.FileSystemObject'); }
function samePath(left, right) { return String(left || '').toLowerCase() === String(right || '').toLowerCase(); }
function unlinkDocument(doc) {
  var fields = documentFields(doc);
  for (var i = fields.length - 1; i >= 0; i--) {
    if (!isManagedField(fields[i])) continue;
    fields[i].Unlink();
  }
}
/* Save the document's current content to a DIFFERENT path without detaching the user's
 * session from the original file.
 *
 * Document.SaveCopyAs would be the obvious call, but it fails on Word 2016 (16.0) with
 * 0x800A1704 "unknown runtime error" for every argument shape we tried - new/existing
 * target, same/other directory, visible or not, opened from file or created in place
 * (measured on this box; SaveAs2 works fine on the very same document). So:
 * - document has no unsaved changes -> a byte copy of the file on disk is exactly it;
 * - it does have unsaved changes   -> SaveAs2 to the target and straight back, which keeps
 *   the in-memory document (fields, styles, headers) and restores the original path.
 * Never silently drop unsaved edits: that would produce a "copy" missing the citations the
 * user just inserted.
 */
function saveDocumentAs(doc, targetPath, format) {
  // Do NOT feature-detect with `if (doc.SaveAs2)`: JScript raises
  // "'SaveAs2' is not a property" the moment you touch a method that way (hit on this box).
  try {
    doc.SaveAs2(targetPath, format);
  } catch (eModern) {
    doc.SaveAs(targetPath, format);   // Word 2007 and older have no SaveAs2
  }
}
function copyDocumentTo(source, sourcePath, targetPath) {
  var fileSystem = fso();
  if (source && source.Saved) {
    fileSystem.CopyFile(sourcePath, targetPath, true);
    return;
  }
  var format = 12; /* wdFormatXMLDocument */
  try {
    saveDocumentAs(source, targetPath, format);
  } catch (eA) {
    throw new Error('Could not write the document copy: ' + eA.message);
  }
  try {
    saveDocumentAs(source, sourcePath, format);
  } catch (eB) {
    throw new Error('The copy was written but the original document could not be reattached (' +
      sourcePath + '): ' + eB.message);
  }
}
function unlinkCopy(sourcePath, targetPath) {
  if (!sourcePath || !targetPath || samePath(sourcePath, targetPath)) throw new Error('Source and target must be different');
  var fileSystem = fso();
  if (fileSystem.FileExists(targetPath)) throw new Error('Target already exists');
  var tempPath = targetPath + '.litboard-tmp-' + new Date().getTime();
  var source = findDoc(sourcePath);
  if (!source) throw new Error('Document not found');
  copyDocumentTo(source, sourcePath, tempPath);
  var copy = null;
  try {
    copy = word.Documents.Open(tempPath, false, false, false);
    if (copy.ReadOnly) throw new Error('Copy is read-only');
    beginUndo('LitBoard unlink citations');
    try { unlinkDocument(copy); } finally { endUndo(); }
    copy.Save();
    copy.Close(false);
    copy = null;
    fileSystem.MoveFile(tempPath, targetPath);
  } finally {
    if (copy) { try { copy.Close(false); } catch (e0) {} }
    if (fileSystem.FileExists(tempPath)) { try { fileSystem.DeleteFile(tempPath, true); } catch (e1) {} }
  }
}

while (!stdin.AtEndOfStream) {
  var line = stdin.ReadLine();
  if (!line) continue;
  activeRequest = null;
  if (line.indexOf('REQ|') === 0) {
    // Protocol v3: REQ|b64(requestId)|b64(sessionId)|b64(documentId)|b64(line)
    // The Node side composes the command line; this host never parses JSON
    // (native JSON is not guaranteed in cscript/WSH - it silently broke v2).
    var reqFields = line.slice(4).split('|');
    if (reqFields.length < 4) {
      stdout.WriteLine('RES|0||||' + b64encode('Invalid request'));
      continue;
    }
    activeRequest = { requestId: b64decode(reqFields[0]), sessionId: b64decode(reqFields[1]),
      documentId: b64decode(reqFields[2]) };
    line = b64decode(reqFields[3]);
    if (!line) {
      stdout.WriteLine('RES|0|' + b64encode(activeRequest.requestId) + '|' +
        b64encode(activeRequest.sessionId) + '||' + b64encode('Empty command'));
      continue;
    }
  }
  var parts = line.split('|');
  try {
    if (!connect() && parts[0] !== 'PING' && parts[0] !== 'INFO') throw new Error('Microsoft Word is not running');
    switch (parts[0]) {
      case 'PING':
        okParts([b64encode(word ? word.Version : '')]);
        break;
      case 'INFO': {
        if (!word) { okParts([b64encode(''), '0', '']); break; }
        var names = [];
        for (var i = 1; i <= word.Documents.Count; i++) {
          var d0 = word.Documents.Item(i);
          names.push(b64encode(d0.FullName));
        }
        okParts([b64encode(word.Version), String(word.Documents.Count), names.join(';')]);
        break;
      }
      case 'FIELDS': {
        var doc = findDoc(b64decode(parts[1]));
        if (!doc) throw new Error('Document not found: ' + b64decode(parts[1]));
        var fields = docLitFields(doc);
        okParts([String(fields.length), fields.join(';')]);
        break;
      }
      case 'APPLY': {
        var docA = findDoc(b64decode(parts[1]));
        if (!docA) throw new Error('Document not found');
        if (docA.ReadOnly) throw new Error('Document is read-only');
        var texts = parts[2] ? parts[2].split(';') : [];
        var codes = parts[4] ? parts[4].split(';') : [];   // refreshed field payloads (aligned with texts)
        var bibSpec = parts[5] || '';
        beginUndo('LitBoard update citations');
        try {
          var idx = 0;
          var fieldsA = documentFields(docA);
          for (var j = 0; j < fieldsA.length; j++) {
            var fA = fieldsA[j];
            if (!isLitField(fA)) continue;
            // code first: writing the field code strips the result, so text goes in after it
            if (idx < codes.length && codes[idx]) {
              try { fA.Code.Text = ' ADDIN LitBoard.Citation.1 "' + b64decode(codes[idx]) + '"'; } catch (eC) {}
            }
            if (idx < texts.length && texts[idx]) {
              try { writeFieldText(fA, b64decode(texts[idx]), docA); } catch (eR) {}
            }
            idx++;
          }
          if (parts[3]) {
            updateBibliography(docA, parts[3].split(';'), bibSpec);
          }
        } finally {
          endUndo();
        }
        showResultView(docA);
        ejectCaretFromLitFields(docA, docA.Application);
        ok();
        break;
      }
      case 'INSERT': {
        var docI = activeRequest && activeRequest.documentId ? findDoc(activeRequest.documentId) : word.ActiveDocument;
        if (!docI) throw new Error('Document not found');
        docI.Activate();
        var sel = docI.Application.Selection;
        var payload = b64decode(parts[1]);
        var fI = addLitField(sel.Range, ' ADDIN LitBoard.Citation.1 "' + payload + '"');
        try { writeFieldText(fI, b64decode(parts[2]), docI); } catch (eI) {}
        placeCursorAfterField(fI, docI.Application);
        showResultView(docI);
        ok();
        break;
      }
      case 'BIB': {
        var docB = activeRequest && activeRequest.documentId ? findDoc(activeRequest.documentId) : word.ActiveDocument;
        if (!docB) throw new Error('Document not found');
        if (docB.ReadOnly) throw new Error('Document is read-only');
        var entriesB = parts[1] ? parts[1].split(';') : [];
        beginUndo('LitBoard bibliography update');
        try { updateBibliography(docB, entriesB, parts[2] || ''); } finally { endUndo(); }
        showResultView(docB);
        ejectCaretFromLitFields(docB, docB.Application);
        ok();
        break;
      }
      case 'UNLINK': {
        var docU = findDoc(b64decode(parts[1]));
        if (!docU) throw new Error('Document not found');
        if (docU.ReadOnly) throw new Error('Document is read-only');
        beginUndo('LitBoard unlink citations');
        try { unlinkDocument(docU); } finally { endUndo(); }
        ok();
        break;
      }
      case 'UNLINKCOPY': {
        unlinkCopy(b64decode(parts[1]), b64decode(parts[2]));
        ok();
        break;
      }
      case 'SAVECOPY': {
        var sourcePathS = b64decode(parts[1]);
        var docS = findDoc(sourcePathS);
        if (!docS) throw new Error('Document not found');
        var copyTarget = b64decode(parts[2]);
        if (samePath(sourcePathS, copyTarget) || fso().FileExists(copyTarget)) throw new Error('Target already exists or is the source');
        copyDocumentTo(docS, sourcePathS, copyTarget);
        ok();
        break;
      }
      default:
        throw new Error('Unknown command: ' + parts[0]);
    }
  } catch (e) {
    err(e);
  }
  activeRequest = null;
}
word = null;
