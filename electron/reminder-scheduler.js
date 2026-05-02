const { Notification } = require('electron');

const timers = new Map();

function schedule(noteId, noteContent, time, onFire) {
  cancel(noteId);

  const targetTime = new Date(time).getTime();
  const now = Date.now();
  const delay = targetTime - now;

  if (delay <= 0) return;

  const timer = setTimeout(() => {
    const notification = new Notification({
      title: '便签提醒',
      body: noteContent.substring(0, 120) || '您有一条便签提醒',
      icon: null,
      silent: false
    });

    notification.on('click', () => {
      if (onFire) onFire(noteId);
    });

    notification.show();
    timers.delete(noteId);

    if (onFire) onFire(noteId);
  }, delay);

  timers.set(noteId, timer);
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
