'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const LitModel = require('../js/model.js');

function createLibraryStorage(baseDir) {
  const file = path.join(baseDir, 'library.v1.json');
  const temp = file + '.tmp';
  const backup = file + '.bak';
  let writeQueue = Promise.resolve();

  async function load() {
    const state = await loadState();
    return state.papers;
  }

  async function readStateCandidate(candidate) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      return LitModel.normalizeWorkspace(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  async function loadState() {
    await fs.mkdir(baseDir, { recursive: true });
    return await readStateCandidate(file) || await readStateCandidate(temp) ||
      await readStateCandidate(backup) || { papers: [], folders: [] };
  }

  function save(value) {
    // Backward-compat: wrap bare papers array into workspace so folders are never silently dropped
    const workspace = Array.isArray(value) ? { papers: value, folders: [] } : value;
    return saveState(workspace);
  }

  function saveState(value) {
    const state = LitModel.normalizeWorkspace(value);
    const payload = JSON.stringify(LitModel.envelope(state.papers, state.folders), null, 2);
    writeQueue = writeQueue.then(async function () {
      await fs.mkdir(baseDir, { recursive: true });
      await fs.writeFile(temp, payload, 'utf8');
      try { await fs.copyFile(file, backup); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fs.rm(file, { force: true });
      await fs.rename(temp, file);
    });
    return writeQueue;
  }

  return { load, save, loadState, saveState, paths: { file, temp, backup } };
}

module.exports = { createLibraryStorage };
