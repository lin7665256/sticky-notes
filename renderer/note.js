// ── State ──────────────────────────────────────────────
let noteData = null;
let saveTimer = null;

// ── DOM Elements ───────────────────────────────────────
const noteContent = document.querySelector('.note-content');
const btnPin = document.getElementById('btn-pin');
const btnReminder = document.getElementById('btn-reminder');
const btnTrash = document.getElementById('btn-trash');
const colorBtns = document.querySelectorAll('.color-btn');
const reminderModal = document.getElementById('reminder-modal');
const reminderInput = document.getElementById('reminder-input');
const container = document.querySelector('.note-container');

// ── Initialize ─────────────────────────────────────────
electronAPI.onInitNoteData((data) => {
  noteData = data;

  // Set content
  noteContent.innerHTML = data.content || '';
  noteContent.focus();

  // Set color
  applyColor(data.color || '#FEF08A');

  // Set pinned state
  if (data.pinned) {
    btnPin.classList.add('pinned');
  }

  // Position cursor at end
  const range = document.createRange();
  range.selectNodeContents(noteContent);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});

// ── Color Picker ───────────────────────────────────────
colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    applyColor(color);
    noteData.color = color;
    autoSave();
  });
});

function applyColor(color) {
  container.style.background = color;
  colorBtns.forEach(b => b.classList.remove('active'));
  const active = document.querySelector(`.color-btn[data-color="${color}"]`);
  if (active) active.classList.add('active');
}

// ── Auto Save ──────────────────────────────────────────
noteContent.addEventListener('input', () => {
  autoSave();
});

function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    noteData.content = noteContent.innerHTML;
    electronAPI.saveNote(noteData);
  }, 500);
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
    if (!confirm('确定要删除这个便签吗？')) return;
  }
  electronAPI.deleteNote(noteData.id);
  electronAPI.closeNote(noteData.id);
});

// ── Reminder ───────────────────────────────────────────
btnReminder.addEventListener('click', () => {
  if (noteData.reminderAt) {
    reminderInput.value = noteData.reminderAt.slice(0, 16);
  } else {
    // Default to 1 hour from now
    const future = new Date(Date.now() + 3600000);
    reminderInput.value = future.toISOString().slice(0, 16);
  }
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
  // Ctrl+S or Ctrl+N to trigger explicit save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    clearTimeout(saveTimer);
    noteData.content = noteContent.innerHTML;
    electronAPI.saveNote(noteData);
  }
  // Escape to close reminder modal
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
