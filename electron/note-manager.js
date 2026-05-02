const { BrowserWindow, screen } = require('electron');
const path = require('path');
const store = require('./store');
const reminderScheduler = require('./reminder-scheduler');

const windows = new Map();
const NOTE_DEFAULTS = {
  width: 300,
  height: 300,
  color: '#FEF08A',
  pinned: false
};

function createNoteWindow(noteData) {
  const data = { ...NOTE_DEFAULTS, ...noteData };

  // Ensure window position is within screen bounds
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const bounds = primaryDisplay.workArea;

  let x = data.x != null ? data.x : Math.floor(bounds.x + bounds.width / 2 - data.width / 2);
  let y = data.y != null ? data.y : Math.floor(bounds.y + bounds.height / 2 - data.height / 2);

  // Clamp to visible area
  x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - 100));
  y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - 100));

  const win = new BrowserWindow({
    width: data.width,
    height: data.height,
    x,
    y,
    frame: false,
    transparent: false,
    alwaysOnTop: data.pinned,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'note.html'));

  // Pass note data to renderer
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('init-note-data', data);
  });

  // Save window bounds on move/resize
  let moveTimeout;
  win.on('move', () => {
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      const [nx, ny] = win.getPosition();
      const [nw, nh] = win.getSize();
      store.saveNote({ id: data.id, x: nx, y: ny, width: nw, height: nh });
    }, 300);
  });

  let resizeTimeout;
  win.on('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const [nx, ny] = win.getPosition();
      const [nw, nh] = win.getSize();
      store.saveNote({ id: data.id, x: nx, y: ny, width: nw, height: nh });
    }, 300);
  });

  win.on('closed', () => {
    windows.delete(data.id);
  });

  windows.set(data.id, win);

  // Schedule reminder if exists
  if (data.reminderAt) {
    const note = store.getNote(data.id);
    reminderScheduler.schedule(data.id, note ? note.content : '', data.reminderAt, (noteId) => {
      store.saveNote({ id: noteId, reminderAt: null });
    });
  }

  return win;
}

function closeNoteWindow(id) {
  const win = windows.get(id);
  if (win) {
    reminderScheduler.cancel(id);
    win.close();
  }
}

function setPinned(id, pinned) {
  const win = windows.get(id);
  if (win) {
    win.setAlwaysOnTop(pinned);
    store.saveNote({ id, pinned });
  }
}

function restoreWindows() {
  const notes = store.getAllNotes();
  for (const note of notes) {
    createNoteWindow(note);
  }
}

function focusNote(id) {
  const win = windows.get(id);
  if (win) {
    win.show();
    win.focus();
  }
}

function showAllWindows() {
  for (const [id, win] of windows) {
    win.show();
    win.focus();
  }
}

function getNoteIdForWindow(win) {
  for (const [id, w] of windows) {
    if (w === win) return id;
  }
  return null;
}

module.exports = {
  createNoteWindow,
  closeNoteWindow,
  setPinned,
  restoreWindows,
  focusNote,
  showAllWindows,
  getNoteIdForWindow
};
