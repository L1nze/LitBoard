'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitBib = require('../js/bibtex.js');

test('BibTeX book fields survive import and export', function () {
  const entry = LitBib.parse(`@book{knuth1984,
    title = {The TeXbook},
    author = {Donald E. Knuth},
    year = {1984},
    publisher = {Addison-Wesley},
    isbn = {978-0-201-13448-3},
    edition = {1},
    language = {en}
  }`)[0];
  const paper = LitBib.entryToPaper(entry);
  assert.equal(paper.publisher, 'Addison-Wesley');
  assert.equal(paper.isbn, '978-0-201-13448-3');
  assert.equal(paper.edition, '1');
  assert.equal(paper.language, 'en');
  assert.equal(paper.venue, '');
  const output = LitBib.paperToBibtex(paper);
  assert.match(output, /publisher = \{Addison-Wesley\}/);
  assert.doesNotMatch(output, /journal\s*=/);
});

test('BibTeX container fields follow the entry type', function () {
  const chapter = LitBib.entryToPaper({
    type: 'incollection', key: 'chapter', fields: { title: 'Chapter', booktitle: 'Collected Work', number: '2' }
  });
  assert.equal(chapter.venue, 'Collected Work');
  assert.equal(chapter.issue, '2');
  assert.match(LitBib.paperToBibtex(chapter), /booktitle = \{Collected Work\}/);
  assert.match(LitBib.paperToBibtex({ entryType: 'article', key: 'a', title: 'A', venue: 'Journal' }), /journal = \{Journal\}/);
});

test('BibTeX parser handles strings, concatenation, escaped quotes and comments', function () {
  const entries = LitBib.parse(`
    @string{jacm = "Journal of the ACM"}
    % a comment before the entry
    @article{smith2024,
      title = "A " # {Composed \\"Title\\"},
      journal = jacm,
      author = {Smith, Jane and {OpenAI Research}},
      year = 2024
    }
  `);
  assert.equal(entries.length, 1);
  const paper = LitBib.entryToPaper(entries[0]);
  assert.equal(paper.title, 'A Composed "Title"');
  assert.equal(paper.venue, 'Journal of the ACM');
  assert.deepEqual(paper.authors, ['Jane Smith', 'OpenAI Research']);
});

test('BibTeX import preserves unmapped extras and local PDF file attachments', function () {
  const entry = LitBib.parse(`@article{x,
    title = {With File},
    author = {Doe, Jane},
    file = {accepted:C:/docs/accepted.pdf:PDF;note:relative.pdf:PDF},
    keywords = {dedupe, import},
    eprint = {1234.5678}
  }`)[0];
  const paper = LitBib.entryToPaper(entry);
  assert.deepEqual(paper.bibtexExtra, { eprint: '1234.5678', keywords: 'dedupe, import' });
  assert.equal(paper.attachments.length, 1);
  assert.equal(paper.attachments[0].kind, 'pdf');
  assert.equal(paper.attachments[0].path, 'C:/docs/accepted.pdf');
  const output = LitBib.paperToBibtex(paper);
  assert.match(output, /eprint = \{1234\.5678\}/);
  assert.match(output, /keywords = \{dedupe, import\}/);
});
