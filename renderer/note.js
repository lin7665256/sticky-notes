// ── State ──────────────────────────────────────────────
let noteData = null;
let saveTimer = null;
let saveStatusTimer = null;
let isSnapped = false;
let isExpanded = false;
let collapseTimer = null;
let expandGraceActive = false;
let autoExpandCooldownUntil = 0;

// ── DOM Elements ───────────────────────────────────────
const noteContent = document.querySelector('.note-content');
const btnPin = document.getElementById('btn-pin');
const btnReminder = document.getElementById('btn-reminder');
const btnTrash = document.getElementById('btn-trash');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const colorBtnEls = document.querySelectorAll('.color-btn');
const colorCurrent = document.getElementById('color-current');
const colorPopover = document.getElementById('color-popover');
const reminderModal = document.getElementById('reminder-modal');
const reminderInput = document.getElementById('reminder-input');
const container = document.querySelector('.note-container');
const saveStatus = document.getElementById('save-status');
const formatToolbar = document.getElementById('format-toolbar');
const contextMenu = document.getElementById('context-menu');

// ── Initialize ─────────────────────────────────────────
electronAPI.onInitNoteData((data) => {
  noteData = data;

  // Set content
  noteContent.innerHTML = data.content || '';

  // Set color
  applyColor(data.color || '#FEF08A');

  // Set pinned state
  if (data.pinned) {
    btnPin.classList.add('pinned');
  }

  // Set compact mode observer
  setupCompactMode();
});

// Listen for edge snap state
electronAPI.onNoteSnapped(({ snapped, expanded, edge }) => {
  const prevExpanded = isExpanded;
  isSnapped = snapped;
  isExpanded = expanded || false;

  if (snapped && !isExpanded) {
    container.classList.add('snapped');
    container.classList.remove('snapped-expanded', 'is-collapsing');

    // If collapsing from expanded state and mouse is still over the tab
    // (window resize may leave cursor inside new bounds), re-expand
    if (prevExpanded && Date.now() > autoExpandCooldownUntil) {
      requestAnimationFrame(() => {
        if (container.matches(':hover') && isSnapped && !isExpanded && noteData && noteData.id) {
          autoExpandCooldownUntil = Date.now() + 500;
          // expandGraceActive and collapseTimer are set by the note-snapped
          // handler when it receives expanded:true — no need to set here
          electronAPI.expandNote(noteData.id);
        }
      });
    }
  } else if (snapped && isExpanded) {
    container.classList.add('snapped', 'snapped-expanded');
    container.classList.remove('is-collapsing');
    // Grace period: ignore mouseleave briefly after expand
    // (window resize during animation can falsely trigger mouseleave)
    expandGraceActive = true;
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      expandGraceActive = false;
    }, 80);
  } else {
    container.classList.remove('snapped', 'snapped-expanded', 'is-collapsing');
  }
});

// ── Color Picker ───────────────────────────────────────
// Color popover toggle
colorCurrent.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpening = !colorPopover.classList.contains('visible');
  colorPopover.classList.toggle('visible');

  if (isOpening) {
    // Position popover and clamp within container bounds
    requestAnimationFrame(() => {
      const popRect = colorPopover.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const currentRect = colorCurrent.getBoundingClientRect();

      // Center relative to color current, then clamp
      let left = currentRect.left - containerRect.left + currentRect.width / 2 - popRect.width / 2;
      left = Math.max(4, Math.min(left, containerRect.width - popRect.width - 4));
      colorPopover.style.left = left + 'px';
    });
  }
});

// Color button clicks inside popover
colorBtnEls.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const color = btn.dataset.color;
    applyColor(color);
    noteData.color = color;
    colorPopover.classList.remove('visible');
    autoSave();
  });
});

// Click outside closes popover
document.addEventListener('click', (e) => {
  if (colorPopover.classList.contains('visible') &&
      !colorPopover.contains(e.target) &&
      e.target !== colorCurrent) {
    colorPopover.classList.remove('visible');
  }
});

function applyColor(color) {
  container.style.background = color;
  colorBtnEls.forEach(b => b.classList.remove('active'));
  const active = document.querySelector(`.color-btn[data-color="${color}"]`);
  if (active) active.classList.add('active');
  colorCurrent.style.background = color;
}

// ── Window Controls ────────────────────────────────────
btnMinimize.addEventListener('click', () => {
  if (noteData && noteData.id) {
    electronAPI.minimizeNote(noteData.id);
  }
});

btnClose.addEventListener('click', () => {
  if (noteData && noteData.id) {
    clearTimeout(saveTimer);
    const hasContent = noteContent.textContent.trim().length > 0;
    const hasReminder = noteData.reminderAt != null;

    if (!hasContent && !hasReminder) {
      electronAPI.deleteNote(noteData.id);
    } else {
      electronAPI.hideNote(noteData.id);
    }
  }
});

// ── Auto Save + Status Indicator ───────────────────────
noteContent.addEventListener('input', () => {
  autoSave();
  showSaveStatus('saving');
});

function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    noteData.content = noteContent.innerHTML;
    electronAPI.saveNote(noteData);
    showSaveStatus('saved');
  }, 500);
}

function showSaveStatus(state) {
  clearTimeout(saveStatusTimer);
  saveStatus.classList.add('visible');
  saveStatus.classList.remove('saving');

  if (state === 'saving') {
    saveStatus.classList.add('saving');
    saveStatus.textContent = '保存中...';
  } else if (state === 'saved') {
    saveStatus.classList.remove('saving');
    saveStatus.textContent = '已保存';
    saveStatusTimer = setTimeout(() => {
      saveStatus.classList.remove('visible');
    }, 2000);
  }
}

// ── Pin / Unpin ────────────────────────────────────────
btnPin.addEventListener('click', () => {
  noteData.pinned = !noteData.pinned;
  if (noteData.pinned) {
    btnPin.classList.add('pinned');
  } else {
    btnPin.classList.remove('pinned');
  }
  electronAPI.setPinned(noteData.id, noteData.pinned);
  autoSave();
});

// ── Delete ─────────────────────────────────────────────
btnTrash.addEventListener('click', () => {
  if (noteContent.textContent.trim().length > 0) {
    // If has content, confirm before delete
    if (!confirm('确定要删除这个便签吗？删除后将无法恢复。')) return;
  }
  electronAPI.deleteNote(noteData.id);
  electronAPI.closeNote(noteData.id);
});

// ── Format Toolbar (Selection-based) ───────────────────
let formatVisible = false;

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) {
    hideFormatToolbar();
    return;
  }

  // Check if selection is inside our note-content
  const range = sel.getRangeAt(0);
  if (!noteContent.contains(range.commonAncestorContainer)) {
    hideFormatToolbar();
    return;
  }

  // Position toolbar above the selection
  const rect = range.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const toolbarW = 110; // approximate width

  let left = rect.left - containerRect.left + rect.width / 2 - toolbarW / 2;
  let top = rect.top - containerRect.top - 36;

  // Clamp to container bounds
  left = Math.max(6, Math.min(left, containerRect.width - toolbarW - 6));
  top = Math.max(36, top);

  formatToolbar.style.left = left + 'px';
  formatToolbar.style.top = top + 'px';
  formatToolbar.classList.add('visible');
  formatVisible = true;
});

function hideFormatToolbar() {
  formatToolbar.classList.remove('visible');
  formatVisible = false;
}

// Delayed hide to allow button clicks
formatToolbar.addEventListener('mouseenter', () => {
  // Keep toolbar visible while hovering
});

formatToolbar.addEventListener('mouseleave', () => {
  // Small delay before hiding when mouse leaves toolbar
  setTimeout(() => {
    if (!formatVisible) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      hideFormatToolbar();
    }
  }, 100);
});

// Format button clicks
formatToolbar.querySelectorAll('.fmt-btn').forEach(btn => {
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault(); // prevent focus loss
    const cmd = btn.dataset.cmd;
    document.execCommand(cmd, false, null);
    noteContent.focus();
    autoSave();
  });
});

// ── Right-Click Context Menu ───────────────────────────
noteContent.addEventListener('contextmenu', (e) => {
  e.preventDefault();

  // Position menu at cursor
  const containerRect = container.getBoundingClientRect();
  let x = e.clientX - containerRect.left;
  let y = e.clientY - containerRect.top;

  // Clamp to container bounds
  const menuW = 150;
  const menuH = 150;
  x = Math.min(x, containerRect.width - menuW - 4);
  y = Math.min(y, containerRect.height - menuH - 4);
  x = Math.max(x, 4);
  y = Math.max(y, 4);

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('visible');
});

// Context menu item clicks
contextMenu.querySelectorAll('.ctx-item').forEach(item => {
  item.addEventListener('click', () => {
    const action = item.dataset.action;
    switch (action) {
      case 'copy':
        document.execCommand('copy');
        break;
      case 'paste':
        noteContent.focus();
        document.execCommand('paste');
        break;
      case 'selectAll':
        const range = document.createRange();
        range.selectNodeContents(noteContent);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        break;
      case 'newNote':
        electronAPI.createNote();
        break;
    }
    contextMenu.classList.remove('visible');
  });
});

// Dismiss context menu on click outside / Escape
document.addEventListener('click', (e) => {
  if (contextMenu.classList.contains('visible') &&
      !contextMenu.contains(e.target)) {
    contextMenu.classList.remove('visible');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (contextMenu.classList.contains('visible')) {
      contextMenu.classList.remove('visible');
    }
    if (colorPopover.classList.contains('visible')) {
      colorPopover.classList.remove('visible');
    }
  }
});

// ── Reminder ───────────────────────────────────────────
// Helper: format a Date as YYYY-MM-DDTHH:mm (local time, for datetime-local input)
function toDatetimeLocalStr(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function highlightPreset(targetMinutes) {
  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach(b => b.classList.remove('active'));
  if (targetMinutes !== null) {
    const matched = document.querySelector(`.preset-btn[data-minutes="${targetMinutes}"]`);
    if (matched) matched.classList.add('active');
  }
}

// Preset button clicks
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const minutes = btn.dataset.minutes;
    let targetDate;

    if (minutes === 'tomorrow') {
      targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 1);
      targetDate.setHours(9, 0, 0, 0);
    } else {
      targetDate = new Date(Date.now() + parseInt(minutes) * 60 * 1000);
    }

    reminderInput.value = toDatetimeLocalStr(targetDate);
    highlightPreset(minutes);
  });
});

btnReminder.addEventListener('click', () => {
  if (noteData.reminderAt) {
    reminderInput.value = toDatetimeLocalStr(new Date(noteData.reminderAt));
  } else {
    reminderInput.value = toDatetimeLocalStr(new Date());
  }
  // Clear preset highlight
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  reminderModal.style.display = 'flex';
});

document.getElementById('reminder-save').addEventListener('click', () => {
  const timeStr = reminderInput.value;
  if (timeStr) {
    const isoTime = new Date(timeStr).toISOString();
    noteData.reminderAt = isoTime;
    electronAPI.setReminder(noteData.id, isoTime);
    autoSave();
  }
  reminderModal.style.display = 'none';
});

document.getElementById('reminder-cancel').addEventListener('click', () => {
  reminderModal.style.display = 'none';
});

document.getElementById('reminder-clear').addEventListener('click', () => {
  noteData.reminderAt = null;
  electronAPI.setReminder(noteData.id, null);
  autoSave();
  reminderModal.style.display = 'none';
});

// Close modal on backdrop click
document.querySelector('.reminder-backdrop').addEventListener('click', () => {
  reminderModal.style.display = 'none';
});

// ── Keyboard Shortcuts ─────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Ctrl+S to trigger explicit save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    clearTimeout(saveTimer);
    noteData.content = noteContent.innerHTML;
    electronAPI.saveNote(noteData);
    showSaveStatus('saved');
  }

  // Ctrl+B for bold
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    document.execCommand('bold', false, null);
    autoSave();
  }

  // Ctrl+I for italic
  if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
    e.preventDefault();
    document.execCommand('italic', false, null);
    autoSave();
  }

  // Escape to close modals
  if (e.key === 'Escape' && reminderModal.style.display === 'flex') {
    reminderModal.style.display = 'none';
  }
});

// ── Save on window blur ────────────────────────────────
window.addEventListener('blur', () => {
  clearTimeout(saveTimer);
  noteData.content = noteContent.innerHTML;
  electronAPI.saveNote(noteData);
});

// ── Compact Mode (for narrow windows) ──────────────────
function setupCompactMode() {
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.contentRect.width < 280) {
        container.classList.add('compact');
      } else {
        container.classList.remove('compact');
      }
    }
  });
  ro.observe(container);
}

// ── Snap Hover Expand / Collapse ──────────────────────
// Hover-to-expand is handled by main process cursor polling
// (renderer mouseenter blocked by -webkit-app-region: drag on container).
// Collapse is driven by renderer mouseleave (container is no-drag in expanded state).
// mouseenter cancels any pending collapse when cursor re-enters the expanded note
// (handles toolbar drag region causing spurious mouseleave).
container.addEventListener('mouseenter', () => {
  if (isSnapped && isExpanded && noteData && noteData.id) {
    clearTimeout(collapseTimer);
    container.classList.remove('is-collapsing');
  }
});

container.addEventListener('mouseleave', () => {
  if (isSnapped && isExpanded && noteData && noteData.id) {
    if (expandGraceActive) return; // ignore during post-expand grace period
    container.classList.add('is-collapsing'); // trigger CSS fade-out immediately
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      electronAPI.collapseNote(noteData.id);
    }, 100); // 150→100, .is-collapsing already fading out
  }
});

// ── Snap Mousedown to Unsnap in Place (TAB state) ──────
// Mousedown on TAB: unsnap to full size at the edge position.
// After unsnap the toolbar (with -webkit-app-region: drag) is visible
// for subsequent dragging of the full-size window.
container.addEventListener('mousedown', (e) => {
  // Bring note to front on any click
  if (noteData && noteData.id) {
    electronAPI.focusNote(noteData.id);
  }

  // Ignore mousedown on interactive elements
  if (e.target.closest('button') || e.target.closest('.color-btn') ||
      e.target.closest('#color-current') || e.target.closest('.ctx-item') ||
      e.target.closest('.reminder-panel') || e.target.closest('.color-popover')) {
    return;
  }
  // Only unsnap from collapsed tab state (not expanded preview)
  if (isSnapped && !isExpanded && noteData && noteData.id) {
    electronAPI.unsnapInPlace(noteData.id);
  }
});

// ── Custom Resize (resizable:false → Aero Snap fully disarmed) ──
const resizeHandle = document.querySelector('.resize-handle');
let isResizing = false;
let resizePointerId = null;

resizeHandle.addEventListener('mousedown', (e) => {
  // Don't resize when snapped to edge
  if (isSnapped || !noteData || !noteData.id) return;

  e.preventDefault();
  resizePointerId = e.pointerId;
  resizeHandle.setPointerCapture(e.pointerId);
  isResizing = true;
  electronAPI.startResizeNote(noteData.id);
});

document.addEventListener('mouseup', () => {
  if (!isResizing) return;
  isResizing = false;
  if (resizePointerId != null) {
    try { resizeHandle.releasePointerCapture(resizePointerId); } catch (_) { /* ignore */ }
    resizePointerId = null;
  }
  if (noteData && noteData.id) {
    electronAPI.stopResizeNote(noteData.id);
  }
});
