const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveNote: (noteData) => ipcRenderer.invoke('save-note', noteData),
  deleteNote: (id) => ipcRenderer.invoke('delete-note', id),
  getAllNotes: () => ipcRenderer.invoke('get-all-notes'),
  closeNote: (id) => ipcRenderer.invoke('close-note', id),
  setPinned: (id, pinned) => ipcRenderer.invoke('set-pinned', id, pinned),
  setReminder: (id, time) => ipcRenderer.invoke('set-reminder', id, time),
  getNoteData: () => ipcRenderer.invoke('get-note-data'),
  minimizeNote: (id) => ipcRenderer.invoke('minimize-note', id),
  hideNote: (id) => ipcRenderer.invoke('hide-note', id),
  createNote: () => ipcRenderer.invoke('create-note'),
  unsnapNote: (id) => ipcRenderer.invoke('unsnap-note', id),
  unsnapInPlace: (id) => ipcRenderer.invoke('unsnap-in-place', id),
  expandNote: (id) => ipcRenderer.invoke('expand-note', id),
  collapseNote: (id) => ipcRenderer.invoke('collapse-note', id),
  focusNote: (id) => ipcRenderer.invoke('focus-note', id),
  startResizeNote: (id) => ipcRenderer.invoke('start-resize-note', id),
  stopResizeNote: (id) => ipcRenderer.invoke('stop-resize-note', id),
  onInitNoteData: (callback) => {
    ipcRenderer.on('init-note-data', (_event, data) => callback(data));
  },
  onNoteSnapped: (callback) => {
    ipcRenderer.on('note-snapped', (_event, data) => callback(data));
  }
});
