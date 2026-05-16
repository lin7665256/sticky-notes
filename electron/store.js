const Store = require('electron-store');

const store = new Store({
  name: 'sticky-notes-data',
  defaults: {
    notes: []
  }
});

const WRITE_MAX_RETRIES = 3;
const WRITE_RETRY_DELAY = 80;

function setWithRetry(key, value) {
  for (let attempt = 1; attempt <= WRITE_MAX_RETRIES; attempt++) {
    try {
      store.set(key, value);
      return;
    } catch (err) {
      if (attempt === WRITE_MAX_RETRIES) throw err;
      if (err.code !== 'ENOSPC' && err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
      console.warn(`store.set retry ${attempt}/${WRITE_MAX_RETRIES} after ${err.code}`);
      const start = Date.now();
      while (Date.now() - start < WRITE_RETRY_DELAY) { /* spin */ }
    }
  }
}

function getAllNotes() {
  return store.get('notes', []);
}

function getNote(id) {
  const notes = getAllNotes();
  return notes.find(n => n.id === id) || null;
}

function saveNote(noteData) {
  const notes = getAllNotes();
  const index = notes.findIndex(n => n.id === noteData.id);

  if (index >= 0) {
    notes[index] = { ...notes[index], ...noteData, updatedAt: new Date().toISOString() };
  } else {
    notes.push({
      ...noteData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  setWithRetry('notes', notes);
  return notes[index >= 0 ? index : notes.length - 1];
}

function deleteNote(id) {
  const notes = getAllNotes().filter(n => n.id !== id);
  setWithRetry('notes', notes);
}

module.exports = {
  getAllNotes,
  getNote,
  saveNote,
  deleteNote
};
