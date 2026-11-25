// Packaged as utils/wallpaper-client.js. The existing page owns canvas and album work.
const { getDataMode, getDataOwner, captureIdentityAuthority, isCurrentIdentityAuthority } = require('./auth');
const { readNotes, writeNotes } = require('./local-data');
const { request } = require('./request');
const { WALLPAPER_TEMPLATES, parseWallpaperState, selectWallpaperCopy,
  applyWallpaperAction, getWallpaperView, approvedWallpaperCopy } = require('./note-wallpaper-state');

const LIMIT_TEXT = '这条小记的换版式次数已用完';
// Default AI provider budget is 45s; client must outlast auth + AI + commit, not mirror 45s.
const WALLPAPER_REQUEST_TIMEOUT_MS = 60000;
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && id === id.trim() && !/[\u0000-\u001f\u007f]/.test(id);
const requestId = () => `wallpaper-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const assertOwner = owner => {
  if (!owner || owner === 'none' || getDataOwner() !== owner) throw new Error('身份已变化，请重新进入本页');
};
const validateWallpaperView = value => {
  if (!value || value.schemaVersion !== 1 || !Number.isInteger(value.revision) || value.revision < 0 || value.revision > 3 ||
      value.switchesRemaining !== 3 - value.revision || !WALLPAPER_TEMPLATES.some(item => item.id === value.templateId) ||
      !approvedWallpaperCopy(value.copy) ||
      Object.keys(value).sort().join(',') !== 'copy,revision,schemaVersion,switchesRemaining,templateId' ||
      Object.keys(value.copy).sort().join(',') !== 'caption,copyId,quote') throw new Error('壁纸记录暂时无法读取，请重试');
  return { schemaVersion: 1, copy: { ...value.copy }, templateId: value.templateId, revision: value.revision, switchesRemaining: value.switchesRemaining };
};

async function requestWallpaper(noteId, owner, action, authority = captureIdentityAuthority()) {
  const assertCurrent = () => { assertOwner(owner); if (!isCurrentIdentityAuthority(authority)) throw new Error("身份已变化，请重新进入本页"); };
  assertCurrent();
  if (!validId(noteId)) throw new Error('这条小记暂时找不到');
  if (getDataMode() === 'authenticated') {
    // Warm-copy AI may exceed the default 15s API timeout; keep one in-flight initialize.
    const result = await request({
      url: `/api/notes/${encodeURIComponent(noteId)}/wallpaper`,
      method: action ? 'POST' : 'GET',
      data: action,
      timeout: WALLPAPER_REQUEST_TIMEOUT_MS
    });
    assertCurrent();
    if (!result || result.noteId !== noteId) throw new Error('壁纸记录暂时无法读取，请重试');
    return result.wallpaper === null && !action ? null : validateWallpaperView(result.wallpaper);
  }
  if (owner !== 'guest' || getDataMode() !== 'guest') throw new Error('请先登录或使用游客模式');
  const notes = readNotes();
  assertCurrent();
  const index = notes.findIndex(note => note.id === noteId);
  if (index < 0) throw new Error('这条小记暂时找不到');
  const note = notes[index];
  const state = parseWallpaperState(note.wallpaperState === undefined ? null : note.wallpaperState);
  if (!action) return getWallpaperView(state);
  const history = notes.map(item => parseWallpaperState(item.wallpaperState === undefined ? null : item.wallpaperState)).filter(Boolean);
  const result = applyWallpaperAction(state, action, history, selectWallpaperCopy(note.content, Array.isArray(note.images) ? note.images.length : 0));
  if (!result.replayed) {
    assertCurrent();
    const updated = notes.slice();
    updated[index] = { ...note, wallpaperState: result.state };
    if (!writeNotes(updated)) throw new Error('壁纸无法保存在本机，请重试');
    assertCurrent();
    const stored = readNotes().find(item => item.id === noteId);
    assertCurrent();
    if (!stored || JSON.stringify(parseWallpaperState(stored.wallpaperState)) !== JSON.stringify(result.state)) throw new Error('壁纸保存尚未确认，请重试');
  }
  assertCurrent();
  return validateWallpaperView(getWallpaperView(result.state));
}

function attachWallpaper(base) {
  const active = page => !page.unloaded && !page.wallpaperHidden && isCurrentIdentityAuthority(page.wallpaperAuthority) && page.wallpaperOwner && page.wallpaperOwner === getDataOwner() && page.noteOwner === page.wallpaperOwner;
  const busy = page => page.data.wallpaperBusy || page.data.sharePreparing || page.data.isSavingImage;
  const clear = page => {
    page.wallpaperEpoch = (page.wallpaperEpoch || 0) + 1;
    page.wallpaperView = null;
    page.pendingWallpaperAction = null;
    page.wallpaperInitializeInflight = null;
    page.wallpaperNoteId = '';
    page.wallpaperOwner = null;
    page.invalidateSlipShare();
    page.setData({ wallpaperBusy: false, isSavingImage: false });
  };
  const methods = {
    data: { ...base.data, wallpaperOnly: false, wallpaperBusy: false, wallpaperRevision: null, templateId: '' },
    onLoad(options = {}) {
      if (!Object.prototype.hasOwnProperty.call(options, 'wallpaperId')) return base.onLoad.call(this, options);
      this.wallpaperOnly = true;
      this.noteOwner = getDataOwner();
      this.setData({ wallpaperOnly: true, dataMode: getDataMode() });
      this.updateSlipLayout();
      return this.openWallpaper({ id: options.wallpaperId }, this.noteOwner);
    },
    onShow() {
      const wasHidden = this.wallpaperHidden; this.wallpaperHidden = false;
      if (this.wallpaperOwner && !active(this)) {
        clear(this);
        this.setData({ isSlipOpen: false, statusText: '身份已变化，请返回后重新进入。' });
      }
      if (!this.wallpaperOnly) return base.onShow.call(this);
      if (wasHidden && active(this) && this.data.isSlipOpen) return this.commitWallpaper(null);
    },
    onHide() {
      this.wallpaperHidden = true;
      this.wallpaperEpoch = (this.wallpaperEpoch || 0) + 1;
      this.wallpaperInitializeInflight = null;
      this.invalidateSlipShare();
      this.setData({ wallpaperBusy: false, isSavingImage: false });
      if (!this.wallpaperOnly) return base.onHide.call(this);
    },
    onUnload() { clear(this); return base.onUnload.call(this); },
    openWallpaper(note, owner) {
      clear(this);
      this.wallpaperOwner = owner;
      this.wallpaperAuthority = captureIdentityAuthority();
      this.wallpaperNoteId = note && note.id;
      this.setData({ isSlipOpen: true, slip: { copyId: '', quote: '', caption: '', shortCaption: '' }, templateId: '',
        wallpaperRevision: null, slipFeedback: '', regenerateRemaining: 0, regenerateText: '正在读取壁纸' });
      return this.commitWallpaper({ action: 'initialize' });
    },
    commitWallpaper(action) {
      if (!active(this) || !this.data.isSlipOpen) return Promise.resolve();
      if (action?.action === 'initialize' && this.wallpaperInitializeInflight) {
        return this.wallpaperInitializeInflight;
      }
      if (busy(this)) return Promise.resolve();
      const epoch = this.wallpaperEpoch, owner = this.wallpaperOwner, noteId = this.wallpaperNoteId, authority = this.wallpaperAuthority;
      const current = () => active(this) && this.wallpaperEpoch === epoch && this.data.isSlipOpen;
      this.invalidateSlipShare();
      this.setData({ wallpaperBusy: true, shareError: '', slipFeedback: '' });
      const run = (async () => {
        try {
          let view;
          try { view = await requestWallpaper(noteId, owner, action, authority); }
          catch (error) {
            if (!current()) return;
            if (error.statusCode !== 409 && error.reason !== 'REVISION_CONFLICT') throw error;
            // Another session advanced this note. Synchronization does not allocate a version.
            view = await requestWallpaper(noteId, owner, null, authority);
          }
          if (!current()) return;
          if (!view) throw new Error("壁纸尚未初始化，请返回后重新打开");
          this.wallpaperView = view;
          this.pendingWallpaperAction = null;
          this.setData({ wallpaperBusy: false, wallpaperRevision: view.revision, templateId: view.templateId, slipStyle: view.templateId,
            slip: {
              copyId: view.copy.copyId,
              quote: view.copy.quote,
              caption: view.copy.caption,
              shortCaption: view.copy.caption,
            },
            regenerateRemaining: view.switchesRemaining, regenerateText: `换个版式 · 剩余 ${view.switchesRemaining} 次`,
            slipFeedback: view.switchesRemaining ? '' : LIMIT_TEXT });
          return await base.prepareSlipShare.call(this);
        } catch (_) {
          if (current()) this.setData({ shareError: '壁纸读取或保存失败，可点击重试生成图片', wallpaperBusy: false });
        } finally {
          if (current()) this.setData({ wallpaperBusy: false });
        }
      })();
      if (action?.action === 'initialize') {
        const tracked = run.finally(() => {
          if (this.wallpaperInitializeInflight === tracked) this.wallpaperInitializeInflight = null;
        });
        this.wallpaperInitializeInflight = tracked;
        return tracked;
      }
      return run;
    },
    prepareSlipShare() {
      if (!active(this)) return Promise.resolve();
      if (this.wallpaperInitializeInflight) return this.wallpaperInitializeInflight;
      if (busy(this)) return Promise.resolve();
      if (this.pendingWallpaperAction || !this.wallpaperView) return this.commitWallpaper(this.pendingWallpaperAction || null);
      return base.prepareSlipShare.call(this);
    },
    regenerateSlip() {
      if (!active(this) || busy(this) || this.data.isSaving || !this.wallpaperView) return;
      if (!this.pendingWallpaperAction && this.wallpaperView.switchesRemaining <= 0) {
        wx.showToast({ title: LIMIT_TEXT, icon: 'none' }); return;
      }
      this.pendingWallpaperAction = this.pendingWallpaperAction || { action: 'switch', requestId: requestId(), expectedRevision: this.wallpaperView.revision };
      return this.commitWallpaper(this.pendingWallpaperAction);
    },
    saveImage() { if (active(this) && !busy(this) && !this.pendingWallpaperAction) return base.saveImage.call(this); },
    saveNote() { if (!this.wallpaperOnly && !busy(this) && !this.data.isSlipOpen) return base.saveNote.call(this); },
    closeSlip() {
      clear(this);
      if (!this.wallpaperOnly) return base.closeSlip.call(this);
      this.setData({ isSlipOpen: false });
      const fallback = () => wx.redirectTo({ url: '/pages/note-history/note-history' });
      if (getCurrentPages().length > 1) wx.navigateBack({ fail: fallback }); else fallback();
    }
  };
  // A wallpaper-only route must not touch drafts, media or note creation, even via stale events.
  ['loadOwnerDraft', 'persistDraft', 'onInput', 'chooseMedia', 'removeMedia', 'chooseMood', 'clearMood', 'openMoodPicker'].forEach(name => {
    methods[name] = function (...args) { if (!this.wallpaperOnly) return base[name].apply(this, args); };
  });
  return { ...base, ...methods };
}

module.exports = { attachWallpaper, validateWallpaperView, requestWallpaper, WALLPAPER_REQUEST_TIMEOUT_MS };
