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

// ── Edge Snap ────────────────────────────────────────
const snapStates = new Map(); // noteId → { snapped, originalBounds, edge, expanded, tabBounds, expandedBounds, displayId }
const SNAP_THRESHOLD = 15;
const SNAP_VISIBLE = 28;

// ── Drawer Group (抽梯式标签组) ──────────────────────
const drawerGroups = new Map(); // groupKey → { ids, hoveredId, workArea }
// groupKey = `${edge}-${displayId}`
const TAB_HEIGHT = 36;
const TAB_GAP = 2;

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
      if (!snap || !snap.snapped) {
        // Not snapped — check if should snap to edge
        const [nx, ny] = win.getPosition();
        const [nw, nh] = win.getSize();
        checkEdgeSnap(win, data.id, nx, ny, nw);
        return;
      }

      // Already snapped — check if dragged away from edge
      const [nx, ny] = win.getPosition();
      const [nw] = win.getSize();
      const display = screen.getDisplayNearestPoint({ x: nx, y: ny });
      const wa = display.workArea;
      const detachedThreshold = SNAP_THRESHOLD + 30;

      if (snap.edge === 'left' && nx > wa.x + detachedThreshold) {
        snap.dragUnsnapUntil = Date.now() + 1500;
        unsnapInPlace(data.id);
      } else if (snap.edge === 'right' && nx + nw < wa.x + wa.width - detachedThreshold) {
        snap.dragUnsnapUntil = Date.now() + 1500;
        unsnapInPlace(data.id);
      }
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

  // Prevent Windows Aero Snap and block resize when snapped
  win.on('will-resize', (event, newBounds) => {
    const snap = snapStates.get(data.id);
    if (snap && snap.snapped) {
      event.preventDefault();
      return;
    }
    const current = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: current.x, y: current.y });
    const { width: sw, height: sh } = display.workArea;
    if (newBounds.width === Math.round(sw / 2) ||
        newBounds.width === Math.round(sw / 4)) {
      event.preventDefault();
      return;
    }
    if (newBounds.height === sh && current.height !== sh) {
      event.preventDefault();
      return;
    }
  });

  win.on('closed', () => {
    const state = snapStates.get(data.id);
    if (state && state.snapped) {
      const groupKey = `${state.edge}-${state.displayId}`;
      const group = drawerGroups.get(groupKey);
      if (group) {
        group.ids = group.ids.filter(i => i !== data.id);
        if (group.hoveredId === data.id) group.hoveredId = null;
        if (group.ids.length === 0) {
          drawerGroups.delete(groupKey);
        } else {
          recalculateDrawer(groupKey);
        }
      }
    }
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
      store.saveNote({ id: data.id, reminderAt: null });
      focusNote(data.id);
    } else {
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
  const state = snapStates.get(id);
  // Cooldown: skip check after user drags away from edge (prevents flicker)
  if (state && state.dragUnsnapUntil > Date.now()) return;

  const display = screen.getDisplayNearestPoint({ x, y });
  const workArea = display.workArea;

  // Check left edge
  if (x <= workArea.x + SNAP_THRESHOLD && x >= workArea.x - width + SNAP_VISIBLE) {
    doSnap(win, id, 'left', y, workArea, display.id);
    return;
  }
  // Check right edge
  if (x + width >= workArea.x + workArea.width - SNAP_THRESHOLD) {
    doSnap(win, id, 'right', y, workArea, display.id);
    return;
  }
}

function doSnap(win, id, edge, y, workArea, displayId) {
  const bounds = win.getBounds();
  const state = {
    snapped: true,
    originalBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    edge,
    expanded: false,
    tabBounds: null,
    expandedBounds: null,
    displayId
  };
  snapStates.set(id, state);

  const groupKey = `${edge}-${displayId}`;
  let group = drawerGroups.get(groupKey);
  if (!group) {
    group = { ids: [], hoveredId: null, workArea };
    drawerGroups.set(groupKey, group);
  }

  // Insert sorted by Y position
  const insertIdx = group.ids.findIndex(eid => {
    const es = snapStates.get(eid);
    return es && es.originalBounds.y > y;
  });
  if (insertIdx === -1) {
    group.ids.push(id);
  } else {
    group.ids.splice(insertIdx, 0, id);
  }

  recalculateDrawer(groupKey);

  // Animate to tab position
  animateBounds(win, state.tabBounds, 60);
  win.webContents.send('note-snapped', { snapped: true, expanded: false, edge });
}

function unsnapNote(id) {
  const state = snapStates.get(id);
  const win = windows.get(id);
  if (!state || !state.snapped || !win) return;

  // Remove from drawer group
  const groupKey = `${state.edge}-${state.displayId}`;
  const group = drawerGroups.get(groupKey);
  if (group) {
    group.ids = group.ids.filter(i => i !== id);
    if (group.hoveredId === id) group.hoveredId = null;
    if (group.ids.length === 0) {
      drawerGroups.delete(groupKey);
    } else {
      recalculateDrawer(groupKey);
    }
  }

  state.snapped = false;
  state.expanded = false;

  const { originalBounds, edge } = state;
  const display = screen.getDisplayNearestPoint({ x: originalBounds.x, y: originalBounds.y });
  const workArea = display.workArea;
  const safeMargin = SNAP_THRESHOLD + 40;

  let safeX = originalBounds.x;
  if (edge === 'left') {
    safeX = workArea.x + safeMargin;
  } else if (edge === 'right') {
    safeX = workArea.x + workArea.width - originalBounds.width - safeMargin;
  }

  animateBounds(win, {
    x: safeX,
    y: originalBounds.y,
    width: originalBounds.width,
    height: originalBounds.height
  });
  win.webContents.send('note-snapped', { snapped: false });
}

// Unsnap and restore to full size.
// When reposition=true (mousedown on TAB): animate to visible expandedBounds at edge.
// When reposition=false/default (drag away from edge): keep current position, just restore size.
function unsnapInPlace(id, { reposition = false } = {}) {
  const state = snapStates.get(id);
  const win = windows.get(id);
  if (!state || !state.snapped || !win) return;

  const groupKey = `${state.edge}-${state.displayId}`;
  const group = drawerGroups.get(groupKey);
  if (group) {
    group.ids = group.ids.filter(i => i !== id);
    if (group.hoveredId === id) group.hoveredId = null;
    if (group.ids.length === 0) {
      drawerGroups.delete(groupKey);
    } else {
      recalculateDrawer(groupKey);
    }
  }

  state.snapped = false;
  state.expanded = false;

  if (reposition && state.expandedBounds) {
    // Mousedown on TAB: instantly restore to full size at visible edge position
    win.setBounds(state.expandedBounds);
  }
  win.webContents.send('note-snapped', { snapped: false });
}

// ── Drawer Expand / Collapse ─────────────────────────
function expandSnappedNote(id) {
  const state = snapStates.get(id);
  const win = windows.get(id);
  if (!state || !state.snapped || state.expanded || !win) return;

  // Skip expansion if window is being dragged away from tab position
  const [cx, cy] = win.getPosition();
  const tb = state.tabBounds;
  if (tb && (Math.abs(cx - tb.x) > 8 || Math.abs(cy - tb.y) > 8)) return;

  const groupKey = `${state.edge}-${state.displayId}`;
  const group = drawerGroups.get(groupKey);
  if (!group) return;

  // Collapse currently expanded note in same group
  if (group.hoveredId && group.hoveredId !== id) {
    collapseSnappedNote(group.hoveredId, true);
  }

  group.hoveredId = id;
  state.expanded = true;
  animateBounds(win, state.expandedBounds, 80);
  win.webContents.send('note-snapped', { snapped: true, expanded: true, edge: state.edge });
  win.focus();
}

function collapseSnappedNote(id, skipAnimate = false) {
  const state = snapStates.get(id);
  const win = windows.get(id);
  if (!state || !state.snapped || !state.expanded || !win || win.isDestroyed()) return;

  // Skip collapse if window is being actively dragged away from tab position
  const [cx, cy] = win.getPosition();
  const tb = state.tabBounds;
  if (tb && (Math.abs(cx - tb.x) > 8 || Math.abs(cy - tb.y) > 8)) return;

  const groupKey = `${state.edge}-${state.displayId}`;
  const group = drawerGroups.get(groupKey);
  if (group && group.hoveredId === id) {
    group.hoveredId = null;
  }

  state.expanded = false;
  if (skipAnimate) {
    if (!win.isDestroyed()) win.setBounds(state.tabBounds);
  } else {
    animateBounds(win, state.tabBounds, 80);
  }
  if (!win.isDestroyed()) {
    win.webContents.send('note-snapped', { snapped: true, expanded: false, edge: state.edge });
  }
}

// ── Drawer Layout Engine ─────────────────────────────
function recalculateDrawer(groupKey) {
  const group = drawerGroups.get(groupKey);
  if (!group || group.ids.length === 0) return;

  const edge = groupKey.startsWith('left-') ? 'left' : 'right';
  const wa = group.workArea;

  // Calculate total drawer height and vertical centering
  const totalH = group.ids.length * TAB_HEIGHT + (group.ids.length - 1) * TAB_GAP;
  const startY = wa.y + Math.max(0, Math.floor((wa.height - totalH) / 2));

  for (let i = 0; i < group.ids.length; i++) {
    const id = group.ids[i];
    const state = snapStates.get(id);
    const win = windows.get(id);
    if (!state || !win || win.isDestroyed()) continue;

    const y = startY + i * (TAB_HEIGHT + TAB_GAP);
    const origW = state.originalBounds.width;

    // Tab position
    if (edge === 'left') {
      state.tabBounds = {
        x: wa.x - origW + SNAP_VISIBLE,
        y,
        width: origW,
        height: TAB_HEIGHT
      };
    } else {
      state.tabBounds = {
        x: wa.x + wa.width - SNAP_VISIBLE,
        y,
        width: origW,
        height: TAB_HEIGHT
      };
    }

    // Expanded position (near tab, vertically centered, clamped to work area)
    let expandY = y - Math.floor((state.originalBounds.height - TAB_HEIGHT) / 2);
    expandY = Math.max(wa.y, Math.min(expandY, wa.y + wa.height - state.originalBounds.height));

    if (edge === 'left') {
      state.expandedBounds = {
        x: wa.x,
        y: expandY,
        width: origW,
        height: state.originalBounds.height
      };
    } else {
      state.expandedBounds = {
        x: wa.x + wa.width - origW,
        y: expandY,
        width: origW,
        height: state.originalBounds.height
      };
    }

    // Animate non-expanded windows to tab position
    if (group.hoveredId !== id) {
      animateBounds(win, state.tabBounds, 60);
    }
  }
}

// ── Smooth sliding animation (Windows compatible) ────
function animateBounds(win, target, duration = 60) {
  if (win.isDestroyed()) return;

  const start = win.getBounds();
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const dw = target.width - start.width;
  const dh = target.height - start.height;

  if (Math.abs(dx) < 3 && Math.abs(dy) < 3 && Math.abs(dw) < 3 && Math.abs(dh) < 3) {
    win.setBounds(target);
    return;
  }

  const steps = 10;
  const interval = Math.floor(duration / steps);
  let step = 0;

  const timer = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    step++;
    if (step >= steps) {
      win.setBounds(target);
      clearInterval(timer);
      return;
    }
    win.setBounds({
      x: Math.round(start.x + dx * step / steps),
      y: Math.round(start.y + dy * step / steps),
      width: Math.round(start.width + dw * step / steps),
      height: Math.round(start.height + dh * step / steps)
    });
  }, interval);
}

module.exports = {
  createNoteWindow,
  closeNoteWindow,
  minimizeNoteWindow,
  hideNoteWindow,
  unsnapNote,
  unsnapInPlace,
  expandSnappedNote,
  collapseSnappedNote,
  setPinned,
  restoreWindows,
  focusNote,
  showAllWindows,
  getNoteIdForWindow
};
