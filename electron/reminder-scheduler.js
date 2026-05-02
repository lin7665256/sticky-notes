const { Notification } = require('electron');

const timers = new Map();

function schedule(noteId, noteContent, time, onFire) {
  cancel(noteId);

  const targetTime = new Date(time).getTime();
  const now = Date.now();
  const delay = targetTime - now;

  // If reminder time is past or now, trigger immediately
  if (delay <= 0) {
    if (onFire) onFire(noteId);
    showNotification(noteContent);
    return;
  }

  const timer = setTimeout(() => {
    // Call onFire when timer fires — triggers exactly once
    if (onFire) onFire(noteId);
    showNotification(noteContent);
    timers.delete(noteId);
  }, delay);

  timers.set(noteId, timer);
}

function showNotification(noteContent) {
  // Strip HTML tags from contenteditable content
  const text = (noteContent || '').replace(/<[^>]+>/g, '').trim();
  // Title = first line (up to 30 chars), body = first 120 chars
  const firstLine = text.split('\n')[0].substring(0, 30) || '便签提醒';
  const body = text.substring(0, 120) || '您有一条便签提醒';

  const notification = new Notification({
    title: firstLine,
    body: body,
    silent: false
  });

  notification.on('click', () => {
    // Clicking the notification just dismisses it (no double trigger)
    notification.close();
  });

  notification.show();
}

function cancel(noteId) {
  if (timers.has(noteId)) {
    clearTimeout(timers.get(noteId));
    timers.delete(noteId);
  }
}

function cancelAll() {
  for (const [id, timer] of timers) {
    clearTimeout(timer);
  }
  timers.clear();
}

module.exports = { schedule, cancel, cancelAll };
