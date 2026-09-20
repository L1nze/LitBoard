'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const LitRis = require('../js/ris.js');
const LitModel = require('../js/model.js');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.ris'), 'utf8');

test('RIS parser reads tagged records with continuation tolerance', function () {
  const entries = LitRis.parse(fixture);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].type, 'JOUR');
  assert.deepEqual(entries[0].fields.AU, ['Turing, Alan M.']);
  assert.deepEqual(entries[0].fields.KW, ['artificial intelligence', 'computation']);
});

test('RIS entryToPaper maps journal fields including issue and page range', function () {
  const papers = LitRis.parsePapers(fixture);
  assert.equal(papers.length, 3);
  const turing = papers[0];
  assert.equal(turing.entryType, 'article');
  assert.equal(turing.title, 'Computing machinery and intelligence');
  assert.deepEqual(turing.authors, ['Alan M. Turing']); // Family, Given → Given Family
  assert.equal(turing.year, 1950);
  assert.equal(turing.venue, 'Mind');
  assert.equal(turing.volume, '59');
  assert.equal(turing.issue, '236');
  assert.equal(turing.pages, '433-460');
  assert.equal(turing.doi, '10.1093/mind/LIX.236.433');
  assert.equal(turing.issn, '0026-4423');
  assert.deepEqual(turing.tags, ['artificial intelligence', 'computation']);
});

test('RIS book chapter keeps publisher, ISBN and edition', function () {
  const chapter = LitRis.parsePapers(fixture)[1];
  assert.equal(chapter.entryType, 'incollection');
  assert.equal(chapter.publisher, 'Oxford University Press');
  assert.equal(chapter.isbn, '978-0-19-853301-2');
  assert.equal(chapter.edition, '2');
  assert.equal(chapter.language, 'en');
  assert.equal(chapter.venue, 'The Computer Journal');
});

test('RIS electronic resource maps to webpage and survives model normalization', function () {
  const elec = LitRis.parsePapers(fixture)[2];
  assert.equal(elec.entryType, 'webpage');
  assert.equal(elec.url, 'https://arxiv.org/abs/2303.08774');
  const normalized = LitModel.normalizePaper(elec);
  assert.equal(normalized.entryType, 'webpage');
  assert.equal(normalized.title, 'GPT-4 Technical Report');
});

test('RIS parser handles missing ER terminator and empty input', function () {
  assert.deepEqual(LitRis.parsePapers(''), []);
  const papers = LitRis.parsePapers('TY  - JOUR\nTI  - Only title no ER\n');
  assert.equal(papers.length, 1);
  assert.equal(papers[0].title, 'Only title no ER');
});

test('RIS export preserves creator roles and date fields', function () {
  const text = LitRis.paperToRis({
    key: 'x1', entryType: 'article', title: 'X', date: '2024-02-29', accessDate: '2025-01-02',
    creators: [{ creatorType: 'author', family: 'Doe', given: 'Jane', name: '' },
      { creatorType: 'editor', family: 'Roe', given: 'John', name: '' }], venue: 'Journal'
  });
  assert.match(text, /DA {2}- 2024-02-29/);
  assert.match(text, /Y2 {2}- 2025-01-02/);
  assert.match(text, /AU {2}- Doe, Jane/);
  assert.match(text, /A2 {2}- Roe, John/);
});
