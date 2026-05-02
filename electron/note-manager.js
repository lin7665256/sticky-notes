const { BrowserWindow, screen } = require('electron');
const path = require('path');
const store = require('./store');
const reminderScheduler = require('./reminder-scheduler');

const windows = new Map();
const NOTE_DEFAULTS = {
  width: 400,
  height: 160,
  color: '#FEF08A',
  pinned: false
};

// Track snapped windows for edge-auto-hide
const snapStates = new Map(); // noteId → { originalBounds, snapped }
const SNAP_THRESHOLD = 15;   // px from edge to trigger snap
const SNAP_VISIBLE = 28;     // px left visible when snapped

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

  // Save window bounds on move/resize + edge snap detection
  let moveTimer;
  let snapTimer;
  let resizeTimer;

  win.on('move', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const snap = snapStates.get(data.id);
      if (snap && snap.snapped) return;
      const [nx, ny] = win.getPosition();
      const [nw, nh] = win.getSize();
      store.saveNote({ id: data.id, x: nx, y: ny, width: nw, height: nh });
    }, 300);

    // Edge snap check — shorter debounce for faster response
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      const snap = snapStates.get(data.id);
      if (snap && snap.snapped) return;
      const [nx, ny] = win.getPosition();
      const [nw, nh] = win.getSize();
      checkEdgeSnap(win, data.id, nx, ny, nw);
    }, 80);
  });

  win.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const snap = snapStates.get(data.id);
      if (snap && snap.snapped) return;
      const [nx, ny] = win.getPosition();
      const [nw, nh] = win.getSize();
      store.saveNote({ id: data.id, x: nx, y: ny, width: nw, height: nh });
    }, 300);
  });

  // Prevent Windows Aero Snap from hijacking our frameless window
  win.on('will-resize', (event, newBounds) => {
    const current = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: current.x, y: current.y });
    const { width: sw, height: sh } = display.workArea;
    // Detect Windows snap: width becomes exactly 1/2 or 1/4 of screen
    if (newBounds.width === Math.round(sw / 2) ||
        newBounds.width === Math.round(sw / 4)) {
      event.preventDefault();
      return;
    }
    // Detect sudden height snap to full workArea
    if (newBounds.height === sh && current.height !== sh) {
      event.preventDefault();
      return;
    }
  });

  win.on('closed', () => {
    windows.delete(data.id);
    snapStates.delete(data.id);
  });

  windows.set(data.id, win);

  // Schedule reminder if exists
  if (data.reminderAt) {
    const note = store.getNote(data.id);
    const reminderTime = new Date(data.reminderAt).getTime();
    const now = Date.now();

    if (reminderTime <= now) {
      // Past reminder — fire immediately to clear reminder and focus window
      store.saveNote({ id: data.id, reminderAt: null });
      focusNote(data.id);
    } else {
      // Future reminder — schedule
      reminderScheduler.schedule(data.id, note ? note.content : '', data.reminderAt, (noteId) => {
        store.saveNote({ id: noteId, reminderAt: null });
        focusNote(noteId);
      });
    }
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

function minimizeNoteWindow(id) {
  const win = windows.get(id);
  if (win) {
    try {
      win.minimize();
    } catch (_) {
      win.hide();
    }
  }
}

function hideNoteWindow(id) {
  const win = windows.get(id);
  if (win) {
    win.hide();
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

// ── Edge Snap ────────────────────────────────────────
function checkEdgeSnap(win, id, x, y, width) {
  const display = screen.getDisplayNearestPoint({ x, y });
  const workArea = display.workArea;

  // Check left edge
  if (x <= workArea.x + SNAP_THRESHOLD && x >= workArea.x - width + SNAP_VISIBLE) {
    doSnap(win, id, 'left', y, workArea);
    return;
  }
  // Check right edge
  if (x + width >= workArea.x + workArea.width - SNAP_THRESHOLD) {
    doSnap(win, id, 'right', y, workArea);
    return;
  }
}

function doSnap(win, id, edge, y, workArea) {
  const bounds = win.getBounds();
  snapStates.set(id, { snapped: true, originalBounds: { ...bounds }, edge });

  const newX = edge === 'left'
    ? workArea.x - bounds.width + SNAP_VISIBLE
    : workArea.x + workArea.width - SNAP_VISIBLE;

  animateBounds(win, { x: newX, y, width: bounds.width, height: bounds.height });
  win.webContents.send('note-snapped', { snapped: true, edge });
}

function unsnapNote(id) {
  const state = snapStates.get(id);
  const win = windows.get(id);
  if (!state || !state.snapped || !win) return;

  const { originalBounds, edge } = state;
  const display = screen.getDisplayNearestPoint({ x: originalBounds.x, y: originalBounds.y });
  const workArea = display.workArea;
  const safeMargin = SNAP_THRESHOLD + 40;

  // Calculate safe position away from edge to prevent immediate re-snap
  let safeX = originalBounds.x;
  if (edge === 'left') {
    safeX = workArea.x + safeMargin;
  } else if (edge === 'right') {
    safeX = workArea.x + workArea.width - originalBounds.width - safeMargin;
  }

  animateBounds(win, { x: safeX, y: originalBounds.y, width: originalBounds.width, height: originalBounds.height });
  state.snapped = false;
  win.webContents.send('note-snapped', { snapped: false });
}

// Smooth sliding animation for snap/unsnap (Windows compatible)
function animateBounds(win, target, duration = 60) {
  const start = win.getBounds();
  const dx = target.x - start.x;
  const dy = target.y - start.y;

  if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
    win.setBounds(target);
    return;
  }

  const steps = 10;
  const interval = Math.floor(duration / steps);
  let step = 0;
  const stepX = dx / steps;
  const stepY = dy / steps;

  const timer = setInterval(() => {
    step++;
    if (step >= steps) {
      win.setBounds(target);
      clearInterval(timer);
      return;
    }
    win.setBounds({
      x: Math.round(start.x + stepX * step),
      y: Math.round(start.y + stepY * step),
      width: target.width,
      height: target.height
    });
  }, interval);
}

module.exports = {
  createNoteWindow,
  closeNoteWindow,
  minimizeNoteWindow,
  hideNoteWindow,
  unsnapNote,
  setPinned,
  restoreWindows,
  focusNote,
  showAllWindows,
  getNoteIdForWindow
};
