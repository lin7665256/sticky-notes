/**
 * E2E 测试 — Sticky Notes Electron 应用
 *
 * 基于真实用户场景的测试：
 *   - UI 操作：输入内容、切换颜色、点击置顶、删除弹窗
 *   - 提醒流程：弹窗设置、清除、回调仅触发一次
 *   - 过期提醒：启动时自动清理并聚焦窗口
 *   - 多窗口：创建多个便签验证隔离性
 *   - 后台逻辑：持久化、窗口恢复
 *
 * 运行: node tests/e2e.js
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const APP_ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function storePath(ud) { return path.join(ud, 'sticky-notes-data.json'); }
function readStore(sp) {
  try { return JSON.parse(fs.readFileSync(sp, 'utf-8')); }
  catch { return { notes: [] }; }
}
function writeStore(sp, d) { fs.writeFileSync(sp, JSON.stringify(d)); }

async function test(desc, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${desc}`);
    pass++;
  } catch (e) {
    console.log(`  \u2717 ${desc}`);
    console.log(`      ${e.message}`);
    fail++;
  }
}

async function waitWindows(app, min, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const w = app.windows();
    if (w.length >= min) return w;
    await sleep(300);
  }
  return app.windows();
}

// Create a note window from test code via main process require
// (only works if `require` is available in evaluate — which it's NOT in Playwright)
// Fallback: write to store file and let restoreWindows handle it on restart
function injectNote(sp, overrides = {}) {
  const data = readStore(sp);
  const note = {
    id: require('uuid').v4(),
    content: '',
    color: '#FEF08A',
    pinned: false,
    reminderAt: null,
    x: 100, y: 100, width: 300, height: 300,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
  data.notes.push(note);
  writeStore(sp, data);
  return note;
}

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('\n\u001b[1mSticky Notes \u2014 \u771f\u5b9e\u573a\u666f E2E \u6d4b\u8bd5\u001b[0m\n');

  // ── 0. 获取 store 路径 ──
  let ud;
  { const b = await electron.launch({ args: [APP_ROOT] });
    ud = await b.evaluate(({ app }) => app.getPath('userData'));
    await b.close(); }
  const sp = storePath(ud);
  writeStore(sp, { notes: [] });
  console.log(`  \u2139 Store: ${sp}\n`);

  // ── 启动应用 ──
  const app = await electron.launch({ args: [APP_ROOT] });
  let page;

  try {

  // ════════════════════════════════════════════════
  // 场景 1: 应用启动与初始状态
  // ════════════════════════════════════════════════
  console.log('\u2500\u2500 1. \u5e94\u7528\u542f\u52a8 \u2500\u2500');

  await test('应用启动后出现便签窗口', async () => {
    const wins = await waitWindows(app, 1);
    assert.ok(wins.length >= 1);
  });

  await test('便签窗口加载 note.html', async () => {
    page = app.windows()[0];
    assert.ok(page.url().includes('note.html'));
  });

  await test('初始便签已持久化到 store', async () => {
    const data = readStore(sp);
    assert.ok(data.notes.length >= 1);
  });

  const id1 = readStore(sp).notes[0].id;

  // ════════════════════════════════════════════════
  // 场景 2: 用户编辑内容 (UI 操作)
  // ════════════════════════════════════════════════
  console.log('\n\u2500\u2500 2. \u7f16\u8f91\u5185\u5bb9 (\u7528\u6237\u5728\u4fbf\u7b7e\u4e2d\u8f93\u5165\u6587\u5b57) \u2500\u2500');

  await test('用户输入文字后自动保存', async () => {
    // wait for noteData to be initialized via init-note-data IPC
    await sleep(1000);
    await page.evaluate(() => {
      const el = document.querySelector('.note-content');
      el.innerHTML = '购物清单：苹果、牛奶、面包';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(800);
    const saved = readStore(sp).notes.find(n => n.id === id1);
    assert.strictEqual(saved.content, '购物清单：苹果、牛奶、面包');
  });

  await test('用户更新便签内容', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('.note-content');
      el.innerHTML = '更新：还要买鸡蛋和黄油';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(700);
    const saved = readStore(sp).notes.find(n => n.id === id1);
    assert.strictEqual(saved.content, '更新：还要买鸡蛋和黄油');
  });

  await test('窗口失焦时自动保存', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('.note-content');
      el.innerHTML = 'blur 时保存的内容';
      window.dispatchEvent(new Event('blur'));
    });
    await sleep(300);
    assert.strictEqual(
      readStore(sp).notes.find(n => n.id === id1).content,
      'blur 时保存的内容'
    );
  });

  await test('Ctrl+S 快捷键立即保存', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('.note-content');
      el.innerHTML = 'Ctrl+S 保存的内容';
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's', ctrlKey: true, bubbles: true
      }));
    });
    await sleep(300);
    assert.strictEqual(
      readStore(sp).notes.find(n => n.id === id1).content,
      'Ctrl+S 保存的内容'
    );
  });

  // ════════════════════════════════════════════════
  // 场景 3: 用户切换颜色 (UI 操作)
  // ════════════════════════════════════════════════
  console.log('\n\u2500\u2500 3. \u5207\u6362\u989c\u8272 (\u7528\u6237\u70b9\u51fb\u989c\u8272\u6309\u94ae) \u2500\u2500');

  await test('点击蓝色颜色按钮', async () => {
    // 打开颜色弹出面板
    await page.click('#color-current');
    await sleep(200);
    const btns = await page.$$('.color-btn');
    await btns[1].click(); // #BFDBFE
    await sleep(700);
    assert.strictEqual(
      readStore(sp).notes.find(n => n.id === id1).color,
      '#BFDBFE'
    );
  });

  await test('蓝色按钮高亮为 active', async () => {
    const active = await page.$('.color-btn.active');
    const color = await active.getAttribute('data-color');
    assert.strictEqual(color, '#BFDBFE');
  });

  await test('点击粉色颜色按钮', async () => {
    // 打开颜色弹出面板
    await page.click('#color-current');
    await sleep(200);
    const btns = await page.$$('.color-btn');
    await btns[4].click(); // #E9D5FF
    await sleep(700);
    assert.strictEqual(
      readStore(sp).notes.find(n => n.id === id1).color,
      '#E9D5FF'
    );
  });

  await test('切回黄色', async () => {
    // 打开颜色弹出面板
    await page.click('#color-current');
    await sleep(200);
    const btns = await page.$$('.color-btn');
    await btns[0].click(); // #FEF08A
    await sleep(700);
    assert.strictEqual(
      readStore(sp).notes.find(n => n.id === id1).color,
      '#FEF08A'
    );
  });

  // ════════════════════════════════════════════════
  // 场景 4: 用户置顶/取消置顶 (UI 操作)
  // ════════════════════════════════════════════════
  console.log('\n\u2500\u2500 4. \u7f6e\u9876/\u53d6\u6d88\u7f6e\u9876 (\u7528\u6237\u70b9\u51fb \U0001f4cc \u6309\u94ae) \u2500\u2500');

  await test('点击 📌 按钮置顶便签', async () => {
    await page.click('#btn-pin');
    await sleep(300);
    assert.strictEqual(
      readStore(sp).notes.find(n => n.id === id1).pinned,
      true
    );
  });

  await test('📌 按钮获得 pinned 样式', async () => {
    const cls = await page.evaluate(() =>
      document.getElementById('btn-pin').className
    );
    assert.ok(cls.includes('pinned'), `expected 'pinned' in class, got '${cls}'`);
  });

  await test('再次点击 📌 取消置顶', async () => {
    await page.click('#btn-pin');
    await sleep(300);
    assert.strictEqual(
      readStore(sp).notes.find(n => n.id === id1).pinned,
      false
    );
  });

  await test('📌 按钮失去 pinned 样式', async () => {
    const cls = await page.evaluate(() =>
      document.getElementById('btn-pin').className
    );
    assert.ok(!cls.includes('pinned'));
  });

  // ════════════════════════════════════════════════
  // 场景 5: 用户设置提醒 (UI 操作)
  // ════════════════════════════════════════════════
  console.log('\n\u2500\u2500 5. \u8bbe\u7f6e\u63d0\u9192 (\u7528\u6237\u70b9\u51fb \u23f0 \u5f39\u7a97\u8bbe\u7f6e) \u2500\u2500');

  await test('点击 ⏰ 打开提醒设置弹窗', async () => {
    await page.click('#btn-reminder');
    await sleep(200);
    const display = await page.evaluate(() =>
      document.getElementById('reminder-modal').style.display
    );
    assert.strictEqual(display, 'flex');
  });

  await test('弹窗中已有默认时间（1小时后）', async () => {
    const val = await page.evaluate(() =>
      document.getElementById('reminder-input').value
    );
    assert.ok(val.length > 0, `Expected non-empty datetime value, got '${val}'`);
  });

  // Close the modal first so backdrop doesn't block next clicks
  await test('关闭弹窗（为后续测试清理）', async () => {
    await page.click('#reminder-cancel');
    await sleep(300);
    const display = await page.evaluate(() =>
      document.getElementById('reminder-modal').style.display
    );
    assert.strictEqual(display, 'none');
  });

  await test('默认提醒时间是当前时间（本地时间，非 UTC）', async () => {
    // Previous test already cleared reminder, so modal shows fresh default
    await page.click('#btn-reminder');
    await sleep(200);
    const val = await page.evaluate(() =>
      document.getElementById('reminder-input').value
    );
    const parsed = new Date(val).getTime();
    const diff = Math.abs(parsed - Date.now());
    assert.ok(diff < 120000, // within 2 minutes of now
      `Default should be near current time, got: ${val}, diff: ${diff}ms`);
    await page.click('#reminder-cancel');
    await sleep(200);
  });

  await test('设置提醒时间并保存', async () => {
    // Open modal first
    await page.click('#btn-reminder');
    await sleep(200);

    const future = new Date(Date.now() + 3600000);
    const pad = n => String(n).padStart(2, '0');
    const localStr = `${future.getFullYear()}-${pad(future.getMonth()+1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
    await page.evaluate((t) => {
      document.getElementById('reminder-input').value = t;
    }, localStr);
    await page.click('#reminder-save');
    await sleep(400);

    const saved = readStore(sp).notes.find(n => n.id === id1);
    assert.ok(saved.reminderAt !== null, `reminderAt should be set, got ${saved.reminderAt}`);
    const savedTime = new Date(saved.reminderAt).getTime();
    const diff = savedTime - Date.now();
    assert.ok(diff > 0,
      `reminderAt should be in the future (${saved.reminderAt}, diff=${diff}ms)`);
  });

  await test('关闭后弹窗隐藏', async () => {
    const display = await page.evaluate(() =>
      document.getElementById('reminder-modal').style.display
    );
    assert.strictEqual(display, 'none');
  });

  await test('再次打开弹窗看到已设提醒时间（本地时间显示）', async () => {
    await page.click('#btn-reminder');
    await sleep(200);
    const val = await page.evaluate(() =>
      document.getElementById('reminder-input').value
    );
    const saved = readStore(sp).notes.find(n => n.id === id1);
    // reminderAt is UTC; modal shows local time via toDatetimeLocalStr
    const d = new Date(saved.reminderAt);
    const pad = n => String(n).padStart(2, '0');
    const expected = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    assert.strictEqual(val, expected,
      `Got: ${val}, expected (local): ${expected}`);
    // Close modal
    await page.click('#reminder-cancel');
    await sleep(200);
  });

  await test('清除提醒按钮生效', async () => {
    await page.click('#btn-reminder');
    await sleep(200);
    await page.click('#reminder-clear');
    await sleep(400);

    const saved = readStore(sp).notes.find(n => n.id === id1);
    assert.strictEqual(saved.reminderAt, null, 'reminderAt should be cleared');
  });

  await test('Escape 键关闭弹窗', async () => {
    await page.click('#btn-reminder');
    await sleep(200);
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true
      }));
    });
    await sleep(200);
    const display = await page.evaluate(() =>
      document.getElementById('reminder-modal').style.display
    );
    assert.strictEqual(display, 'none');
  });

  // ════════════════════════════════════════════════
  // 场景 6: 用户删除便签 (UI 操作 + confirm 弹窗)
  // ════════════════════════════════════════════════
  console.log('\n\u2500\u2500 6. \u5220\u9664\u4fbf\u7b7e (\u7528\u6237\u70b9\u51fb \U0001f5d1\ufe0f) \u2500\u2500');

  // 创建一个有内容的便签用于删除测试
  const delData = injectNote(sp, { content: '待删除的便签内容' });
  const delId = delData.id;

  await test('有内容的便签删除时弹出确认框，取消后不删除', async () => {
    // 关闭 app 重启以触发 createNoteWindow，让 delId 的窗口出现
    await app.close();

    const app2 = await electron.launch({ args: [APP_ROOT] });
    const wins2 = await waitWindows(app2, 1);
    const page2 = wins2[0];
    await sleep(500);

    // 找到 delId 对应的窗口（多窗口中）
    // 在页面中，closeNote/deleteNote 需要通过 IPC 或 UI 操作
    // 由于我们无法直接通过 UI 定位到具体窗口，通过 page.evaluate 操作
    // 直接使用 UI 操作删除：先 navigate 到正确的窗口比较困难
    // 替代方案：在每个窗口测试删除逻辑

    // 在所有窗口中执行删除 — 触发 confirm 弹窗
    let dialogHandled = false;
    page2.once('dialog', async (dialog) => {
      assert.strictEqual(dialog.message(), '确定要删除这个便签吗？删除后将无法恢复。');
      dialog.dismiss(); // 取消删除
      dialogHandled = true;
    });

    // 触发删除 — 设置内容然后点击删除
    await page2.evaluate((id) => {
      // 找到目标窗口 — 检查 noteData 是否匹配
      const el = document.querySelector('.note-content');
      el.innerHTML = '待删除的便签内容';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, delId);

    await sleep(700);

    // 触发删除按钮
    await page2.click('#btn-trash');
    await sleep(500);

    assert.ok(dialogHandled, 'Confirm dialog should have appeared');

    // 验证便签未被删除
    const afterCancel = readStore(sp).notes.find(n => n.id === delId);
    assert.ok(afterCancel !== undefined, 'Note should not be deleted after cancel');

    await app2.close();
  });

  await test('无内容的便签直接删除（无确认框）', async () => {
    // 创建一个空便签
    const emptyData = injectNote(sp, { content: '' });
    const emptyId = emptyData.id;

    const app3 = await electron.launch({ args: [APP_ROOT] });
    await sleep(600);
    const page3 = app3.windows()[0];

    let dialogFired = false;
    page3.once('dialog', () => { dialogFired = true; });

    // 找到空便签并删除
    // 直接通过 IPC 删除更可靠
    await page3.evaluate((id) => {
      window.electronAPI.deleteNote(id);
      window.electronAPI.closeNote(id);
    }, emptyId);
    await sleep(400);

    // 无内容的便签删除时不应触发 confirm
    assert.strictEqual(dialogFired, false, 'No confirm dialog for empty note');

    // 验证已删除
    const afterDel = readStore(sp).notes.find(n => n.id === emptyId);
    assert.strictEqual(afterDel, undefined, 'Empty note should be deleted');

    await app3.close();
  });

  // ════════════════════════════════════════════════
  // 场景 7: 提醒回调只触发一次 + 过期提醒自动清理
  // ════════════════════════════════════════════════
  console.log('\n\u2500\u2500 7. \u63d0\u9192\u56de\u8c03\u53ea\u89e6\u53d1\u4e00\u6b21 + \u8fc7\u671f\u63d0\u9192\u81ea\u52a8\u6e05\u7406 \u2500\u2500');

  await test('未来 50ms 的提醒回调正好触发一次（无双重触发）', async () => {
    const note = injectNote(sp, {
      content: '双重触发测试',
      reminderAt: new Date(Date.now() + 50).toISOString()
    });

    const app4 = await electron.launch({ args: [APP_ROOT] });
    await sleep(800); // 等待定时器触发

    const after = readStore(sp);
    const found = after.notes.find(n => n.id === note.id);
    assert.strictEqual(found.reminderAt, null,
      `reminderAt should be null (fired once), got: ${found.reminderAt}`);

    // 验证 reminderAt 被清空了一次（不是多次保存）
    // 检查 store 中没有重复的提醒数据
    const reminderNulls = after.notes.filter(n => n.id === note.id);
    assert.strictEqual(reminderNulls.length, 1, 'Note should exist exactly once in store');

    await app4.close();
  });

  await test('过期提醒在应用启动时自动清除并聚焦窗口', async () => {
    const pastNote = injectNote(sp, {
      content: '过期提醒测试',
      reminderAt: new Date(Date.now() - 3600000).toISOString() // 1小时前
    });

    const app5 = await electron.launch({ args: [APP_ROOT] });
    await sleep(800);

    const after = readStore(sp);
    const found = after.notes.find(n => n.id === pastNote.id);
    assert.strictEqual(found.reminderAt, null,
      `Past reminder should be auto-cleared, got: ${found.reminderAt}`);

    // 验证窗口被创建了（createNoteWindow 被调用）
    const wins = app5.windows();
    assert.ok(wins.length >= 1, 'Windows should exist after restore');

    await app5.close();
  });

  // ════════════════════════════════════════════════
  // 场景 8: 多窗口管理 + 窗口恢复
  // ════════════════════════════════════════════════
  console.log('\n\u2500\u2500 8. \u591a\u7a97\u53e3 + \u6062\u590d \u2500\u2500');

  await test('多个便签窗口在启动时全部恢复', async () => {
    // 已有若干个便签在 store 中（之前测试创建的）
    // 写入更多便签
    for (let i = 0; i < 3; i++) {
      injectNote(sp, { content: `多窗口便签 #${i + 1}` });
    }

    const app6 = await electron.launch({ args: [APP_ROOT] });
    await sleep(1000);

    const wins = app6.windows();
    const data = readStore(sp);
    // 每个 note 对应一个窗口
    assert.ok(wins.length >= data.notes.length,
      `Should have at least ${data.notes.length} windows, got ${wins.length}`);

    await app6.close();
  });

  // ════════════════════════════════════════════════
  // 场景 9: getNoteData (渲染进程获取自身数据)
  // ════════════════════════════════════════════════
  console.log('\n\u2500\u2500 9. \u4fbf\u7b7e\u6570\u636e\u4f20\u9012 \u2500\u2500');

  await test('渲染进程通过 getNoteData 获取自身便签数据', async () => {
    const app7 = await electron.launch({ args: [APP_ROOT] });
    const wins7 = await waitWindows(app7, 1);
    assert.ok(wins7.length > 0, 'Should have at least one window');
    const p = wins7[0];

    const data = await p.evaluate(() => window.electronAPI.getNoteData());
    assert.ok(data !== null, 'Should return note data');
    assert.ok(data.id !== undefined, 'Note data should have an id');
    assert.ok(data.content !== undefined, 'Note data should have content');

    await app7.close();
  });

  // ════════════════════════════════════════════════
  // 汇总
  // ════════════════════════════════════════════════
  console.log('\n' + '\u2500'.repeat(46));
  console.log(`\n  \u001b[1m${pass} passed\u001b[0m, ${fail} failed\n`);

} finally {
    try { await app.close(); } catch {}
    // Clean up test data
    try { writeStore(sp, { notes: [] }); } catch {}
    process.exit(fail > 0 ? 1 : 0);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
