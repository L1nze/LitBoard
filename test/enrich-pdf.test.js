'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadEnrichModule(responses) {
  const calls = [];
  const context = {
    URL,
    setTimeout,
    Promise,
    localStorage: { getItem: function () { return ''; } },
    window: {
      litboardDesktop: {
        fetchJson: function (url) {
          calls.push(url);
          const data = responses[url];
          return Promise.resolve({ status: data ? 200 : 404, ok: !!data, data: data || null });
        }
      }
    }
  };
  context.window.window = context.window;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'enrich.js'), 'utf8'), context);
  return { enrich: context.window.LitEnrich, calls: calls };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('PDF finder skips OpenAlex landing pages and falls back to Semantic Scholar title PDF', async function () {
  const title = 'Landing Page Paper';
  const doi = '10.1234/landing';
  const responses = {};
  responses['https://api.openalex.org/works/https://doi.org/10.1234%2Flanding'] = {
    title: title,
    best_oa_location: {},
    open_access: {
      oa_url: 'https://repository.example/papers/landing.html'
    },
    locations: []
  };
  responses['https://api.semanticscholar.org/graph/v1/paper/search?query=Landing%20Page%20Paper&limit=5&fields=openAccessPdf,title'] = {
    data: [
      {
        title: title,
        openAccessPdf: { url: 'https://repository.example/papers/landing.pdf' }
      }
    ]
  };

  const loaded = loadEnrichModule(responses);
  const candidates = await loaded.enrich.findPdfUrls({ doi: doi, title: title });

  assert.deepEqual(plain(candidates), [
    { source: 'Semantic Scholar', url: 'https://repository.example/papers/landing.pdf' }
  ]);
  assert.ok(loaded.calls.includes('https://api.semanticscholar.org/graph/v1/paper/search?query=Landing%20Page%20Paper&limit=5&fields=openAccessPdf,title'));
});

test('PDF finder derives direct arXiv PDFs from arXiv DOI values', async function () {
  const loaded = loadEnrichModule({});
  const candidates = await loaded.enrich.findPdfUrls({
    doi: '10.48550/arXiv.1412.6980',
    title: 'Adam: A Method for Stochastic Optimization'
  });

  assert.deepEqual(plain(candidates), [
    { source: 'arXiv', url: 'https://arxiv.org/pdf/1412.6980' }
  ]);
});

test('PDF finder includes Crossref PDF links and ignores non-PDF resources', async function () {
  const doi = '10.5555/crossref-pdf';
  const responses = {};
  responses['https://api.crossref.org/works/10.5555%2Fcrossref-pdf'] = {
    message: {
      title: ['Crossref PDF Paper'],
      link: [
        { URL: 'https://publisher.example/fulltext.xml', 'content-type': 'application/xml' },
        { URL: 'https://publisher.example/download/article.pdf', 'content-type': 'application/pdf' }
      ]
    }
  };

  const loaded = loadEnrichModule(responses);
  const candidates = await loaded.enrich.findPdfUrls({ doi: doi, title: 'Crossref PDF Paper' });

  assert.deepEqual(plain(candidates), [
    { source: 'Crossref', url: 'https://publisher.example/download/article.pdf' }
  ]);
});

test('enrichment drops publisher-only venue names from Semantic Scholar', async function () {
  const responses = {};
  // OpenAlex 无结果 → fallback 到 S2
  responses['https://api.openalex.org/works/https://doi.org/10.9999%2Fpubonly'] = null;
  // S2 venue=Elsevier（出版商名）、journal.name=真期刊名
  responses['https://api.semanticscholar.org/graph/v1/paper/DOI:10.9999%2Fpubonly?fields=title,abstract,year,venue,citationCount,openAccessPdf,externalIds,authors,journal'] = {
    title: 'Publisher Venue Paper',
    venue: 'Elsevier',
    journal: { name: 'Journal of Molecular Biology', volume: '12', pages: '1-10' }
  };
  const loaded = loadEnrichModule(responses);
  const patch = await loaded.enrich.byDoi('10.9999/pubonly');
  assert.equal(patch.source, 'Semantic Scholar');
  assert.equal(patch.venue, 'Journal of Molecular Biology');
  assert.equal(patch.volume, '12');
});

test('enrichment ignores arXiv venue from Semantic Scholar', async function () {
  const responses = {};
  responses['https://api.openalex.org/works/https://doi.org/10.8899%2Farxivx'] = null;
  responses['https://api.semanticscholar.org/graph/v1/paper/DOI:10.8899%2Farxivx?fields=title,abstract,year,venue,citationCount,openAccessPdf,externalIds,authors,journal'] = {
    title: 'Arxiv Preprint Paper',
    venue: 'arXiv',
    journal: { name: 'arXiv' }
  };
  const loaded = loadEnrichModule(responses);
  const patch = await loaded.enrich.byDoi('10.8899/arxivx');
  assert.equal(patch.source, 'Semantic Scholar');
  assert.equal(patch.venue, undefined);
});
