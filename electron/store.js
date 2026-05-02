const Store = require('electron-store');

const store = new Store({
  name: 'sticky-notes-data',
  defaults: {
    notes: []
  }
});

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

  store.set('notes', notes);
  return notes[index >= 0 ? index : notes.length - 1];
}

function deleteNote(id) {
  const notes = getAllNotes().filter(n => n.id !== id);
  store.set('notes', notes);
}

module.exports = {
  getAllNotes,
  getNote,
  saveNote,
  deleteNote
};
