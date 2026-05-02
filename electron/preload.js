const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveNote: (noteData) => ipcRenderer.invoke('save-note', noteData),
  deleteNote: (id) => ipcRenderer.invoke('delete-note', id),
  getAllNotes: () => ipcRenderer.invoke('get-all-notes'),
  closeNote: (id) => ipcRenderer.invoke('close-note', id),
  setPinned: (id, pinned) => ipcRenderer.invoke('set-pinned', id, pinned),
  setReminder: (id, time) => ipcRenderer.invoke('set-reminder', id, time),
  getNoteData: () => ipcRenderer.invoke('get-note-data'),
  onInitNoteData: (callback) => {
    ipcRenderer.on('init-note-data', (_event, data) => callback(data));
  }
});
