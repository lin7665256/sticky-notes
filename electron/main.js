const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const store = require('./store');
const noteManager = require('./note-manager');
const reminderScheduler = require('./reminder-scheduler');
const { v4: uuidv4 } = require('uuid');

let tray = null;

// ── IPC Handlers ──────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('save-note', (_event, noteData) => {
    return store.saveNote(noteData);
  });

  ipcMain.handle('delete-note', (_event, id) => {
    store.deleteNote(id);
    noteManager.closeNoteWindow(id);
  });

  ipcMain.handle('get-all-notes', () => {
    return store.getAllNotes();
  });

  ipcMain.handle('close-note', (_event, id) => {
    noteManager.closeNoteWindow(id);
  });

  ipcMain.handle('set-pinned', (_event, id, pinned) => {
    noteManager.setPinned(id, pinned);
    store.saveNote({ id, pinned });
  });

  ipcMain.handle('set-reminder', (_event, id, time) => {
    store.saveNote({ id, reminderAt: time });
    const note = store.getNote(id);
    if (time) {
      reminderScheduler.schedule(id, note.content, time, (noteId) => {
        store.saveNote({ id: noteId, reminderAt: null });
        noteManager.focusNote(noteId);
      });
    } else {
      reminderScheduler.cancel(id);
    }
  });

  ipcMain.handle('minimize-note', (_event, id) => {
    noteManager.minimizeNoteWindow(id);
  });

  ipcMain.handle('hide-note', (_event, id) => {
    noteManager.hideNoteWindow(id);
  });

  ipcMain.handle('create-note', () => {
    const noteData = { id: uuidv4() };
    store.saveNote(noteData);
    noteManager.createNoteWindow(noteData);
  });

  ipcMain.handle('unsnap-note', (_event, id) => {
    noteManager.unsnapNote(id);
  });

  ipcMain.handle('get-note-data', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const noteId = noteManager.getNoteIdForWindow(win);
    return noteId ? store.getNote(noteId) : null;
  });
}

// ── Tray Setup ────────────────────────────────────────────
function createTray() {
  // Generate a 16x16 yellow sticky note icon programmatically
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (x < 1 || x >= size - 1 || y < 1 || y >= size - 1) {
        // Border
        buffer[i] = 202;     // R
        buffer[i + 1] = 138; // G
        buffer[i + 2] = 4;   // B
        buffer[i + 3] = 255; // A
      } else if (y < 4) {
        // Top strip (darker yellow)
        buffer[i] = 253;
        buffer[i + 1] = 224;
        buffer[i + 2] = 71;
        buffer[i + 3] = 255;
      } else {
        // Body
        buffer[i] = 254;
        buffer[i + 1] = 240;
        buffer[i + 2] = 138;
        buffer[i + 3] = 255;
      }
    }
  }
  const trayIcon = nativeImage.createFromBuffer(buffer, { width: size, height: size });

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '新建便签',
      click: () => {
        const noteData = { id: uuidv4() };
        store.saveNote(noteData);
        noteManager.createNoteWindow(noteData);
      }
    },
    {
      label: '显示全部便签',
      click: () => noteManager.showAllWindows()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        reminderScheduler.cancelAll();
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Sticky Notes');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    const noteData = { id: uuidv4() };
    store.saveNote(noteData);
    noteManager.createNoteWindow(noteData);
  });
}

// ── Windows Notification Support ─────────────────────────
if (process.platform === 'win32') {
  app.setAppUserModelId('com.stickynotes.app');
}

// ── App Lifecycle ─────────────────────────────────────────
app.whenReady().then(() => {
  setupIPC();
  createTray();
  noteManager.restoreWindows();

  // If no notes exist, create one by default
  const notes = store.getAllNotes();
  if (notes.length === 0) {
    const noteData = { id: uuidv4() };
    store.saveNote(noteData);
    noteManager.createNoteWindow(noteData);
  }
});

app.on('window-all-closed', () => {
  // Don't quit on Windows — keep running in tray
  if (process.platform !== 'darwin') {
    // Just keep running
  }
});

app.on('before-quit', () => {
  reminderScheduler.cancelAll();
});

app.on('activate', () => {
  noteManager.showAllWindows();
});
