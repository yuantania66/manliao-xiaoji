const { getDataOwner, captureIdentityAuthority, isCurrentIdentityAuthority } = require("./auth");
const { getSafeLayout } = require("./layout");
const { getShareableSlip, getWallpaperSize, prepareWallpaperAssets, drawWallpaper, drawShareCover } = require("./note-slip");
const SLIP_IMAGE_NAMESPACE = "MLXJ";
const padTime = (value) => String(value).padStart(2, "0");

const getSlipImageFileName = () => {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    padTime(now.getMonth() + 1),
    padTime(now.getDate())
  ].join("");
  const timePart = [
    padTime(now.getHours()),
    padTime(now.getMinutes()),
    padTime(now.getSeconds())
  ].join("");
  return `${SLIP_IMAGE_NAMESPACE}_${datePart}${timePart}.png`;
};

const copyToNamespacedSlipImage = (tempFilePath) => {
  if (!wx.getFileSystemManager || !wx.env || !wx.env.USER_DATA_PATH) {
    return Promise.resolve(tempFilePath);
  }

  const fileSystem = wx.getFileSystemManager();
  if (!fileSystem.copyFile) {
    return Promise.resolve(tempFilePath);
  }

  const filePath = `${wx.env.USER_DATA_PATH}/${getSlipImageFileName()}`;
  return new Promise((resolve) => {
    fileSystem.copyFile({
      srcPath: tempFilePath,
      destPath: filePath,
      success: () => resolve(filePath),
      fail: () => resolve(tempFilePath)
    });
  });
};


const cardData = { isSlipOpen: false, isSavingImage: false, slip: { copyId: "", quote: "", caption: "", shortCaption: "" }, slipStyle: "", slipFeedback: "", regenerateRemaining: 0, regenerateText: "", shareReady: false, sharePreparing: false, wallpaperUrl: "", shareError: "", slipTitle: "小记已保存" };
const cardMethods = {
  updateSlipLayout() {
    const layout = getSafeLayout();
    const system = wx.getSystemInfoSync();
    const rpx = system.windowWidth / 750;
    const slipTop = layout.closeTop + 2;
    const slipBottom = Math.max(12, system.screenHeight - (system.safeArea?.bottom || system.screenHeight) + 12);
    // Sheet padding 32px + header 36px + preview gaps 24px + footer 140px.
    const availableHeight = system.windowHeight - slipTop - slipBottom - 232;
    const availableWidth = system.windowWidth - 72 * rpx - 32;
    const size = getWallpaperSize(system);
    const slipPreviewHeight = Math.max(1, Math.min(availableHeight, availableWidth * size.height / size.width));
    const slipPreviewWidth = slipPreviewHeight * size.width / size.height;
    this.setData({
      pageTop: layout.pageTop,
      backTop: layout.backTop,
      actionTop: layout.actionTop,
      actionRight: layout.actionRight,
      panelTop: layout.panelTop,
      slipTop, slipBottom, slipPreviewWidth, slipPreviewHeight
    });
  },
  invalidateSlipShare() {
    this.shareRevision = (this.shareRevision || 0) + 1;
    this.slipShare = null;
    this.setData({ shareReady: false, sharePreparing: false, wallpaperUrl: "", shareError: "" });
  },

  disposeSlip() {
    this.shareRevision = (this.shareRevision || 0) + 1;
    this.slipShare = null;
    this.unloaded = true;
  },

  prepareSlipShare() {
    if (this.unloaded || this.data.sharePreparing || !this.data.isSlipOpen) return Promise.resolve();
    this.invalidateSlipShare();
    const revision = this.shareRevision, owner = getDataOwner(), authority = captureIdentityAuthority();
    const sourceSlip = this.data.slip;
    const slip = getShareableSlip(sourceSlip), style = this.data.slipStyle;
    if (!slip) { this.setData({ shareError: "小笺暂时无法分享，请重新生成" }); return Promise.resolve(); }
    this.setData({ sharePreparing: true, shareError: "" });
    const current = () => !this.unloaded && this.shareRevision === revision && this.data.isSlipOpen
      && isCurrentIdentityAuthority(authority) && !this.wallpaperHidden && getDataOwner() === owner && this.data.slipStyle === style
      && this.data.slip?.quote === sourceSlip.quote && this.data.slip?.caption === sourceSlip.caption
      && this.data.slip?.copyId === sourceSlip.copyId;
    // Keep copyId on the draw path: getShareableSlip inside draw* needs generated-v1.
    const data = { slip: sourceSlip, slipStyle: style };
    return Promise.all([this.createSlipImage(true, data), this.createSlipImage(false, data)]).then(([imageUrl, wallpaperUrl]) => {
      if (!imageUrl || !wallpaperUrl) throw new Error("图片为空");
      if (!current()) return;
      this.slipShare = { revision, owner, authority, style, slip, imageUrl, wallpaperUrl };
      this.setData({ shareReady: true, sharePreparing: false, wallpaperUrl, shareError: "" });
    }).catch((error) => {
      if (!current()) return;
      const raw = String((error && (error.errMsg || error.message)) || error || "");
      let shareError = "图片生成失败，可点击重试生成图片";
      if (/素材地址无效|壁纸素材地址/.test(raw)) shareError = "壁纸素材地址不可用，请检查网络后重试生成图片";
      else if (/背景暂不可用|downloadFile|素材加载超时|timeout/i.test(raw)) shareError = "壁纸背景下载较慢或失败，可重试生成图片（小记已保存）";
      else if (/字体|Font|loadFontFace/i.test(raw)) shareError = "字体加载失败，可重试生成图片";
      else if (/离屏|createOffscreenCanvas|离屏图片/.test(raw)) shareError = "当前微信版本无法生成图片，请升级后重试";
      else if (/canvasToTempFilePath|导出|尺寸无效/.test(raw)) shareError = "图片导出失败，可重试生成图片";
      else if (/壁纸内容不可用|分享内容不可用|小笺暂时无法分享/.test(raw)) shareError = "暖心文案无法用于出图，可重试生成图片";
      this.setData({ sharePreparing: false, wallpaperUrl: "", shareError });
    });
  },

  wallpaperError() {
    this.invalidateSlipShare();
    this.setData({ shareError: "图片读取失败，可点击重试" });
  },

  isCurrentSlip(share) {
    return !!share && !this.unloaded && this.data.isSlipOpen && this.data.shareReady
      && !this.wallpaperHidden && isCurrentIdentityAuthority(share.authority) && share.revision === this.shareRevision && share.owner === getDataOwner()
      && share.style === this.data.slipStyle && share.slip.quote === this.data.slip?.quote
      && share.slip.caption === this.data.slip?.caption && share.wallpaperUrl === this.data.wallpaperUrl;
  },

  onShareAppMessage(options = {}) {
    // Explicit public fallback: never let WeChat screenshot the private note page.
    const fallback = { title: "慢聊小记 · 给今天留一点空间", path: "/pages/home/home", imageUrl: "/assets/visit-growth/sunlight.png" };
    const share = this.slipShare, slip = getShareableSlip(this.data.slip);
    if (options.from !== "button" || options.target?.id !== "share-slip" || this.unloaded || !this.data.isSlipOpen
      || !this.data.shareReady || !share || !slip || share.revision !== this.shareRevision
      || this.wallpaperHidden || !isCurrentIdentityAuthority(share.authority) || share.owner !== getDataOwner() || share.style !== this.data.slipStyle
      || share.slip.quote !== slip.quote || share.slip.caption !== slip.caption) return fallback;
    try { wx.getFileSystemManager().accessSync(share.imageUrl); } catch (_) { this.invalidateSlipShare(); return fallback; }
    return { title: slip.quote, path: "/pages/home/home", imageUrl: share.imageUrl };
  },

  createSlipImage(forShare = false, data = this.data) {
    return new Promise((resolve, reject) => {
      if (typeof wx.createOffscreenCanvas !== "function") {
        throw new Error("当前微信版本不支持离屏图片生成");
      }
      // Export at 2x resolution without ever mounting a canvas in the page.
      const size = getWallpaperSize(wx.getSystemInfoSync());
      const width = forShare ? 1000 : size.width, height = forShare ? 800 : size.height;
      const canvas = wx.createOffscreenCanvas({ type: "2d", width, height });
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("离屏图片生成不可用");
      prepareWallpaperAssets(wx, canvas, data.slipStyle, require("../config/api").getApiBaseUrl()).then(assets => {
      data = { ...data, ...assets };
      ctx.scale(2, 2);
      if (forShare) {
        drawShareCover(ctx, data);
      } else {
        drawWallpaper(ctx, data, height / 2);
      }
      wx.canvasToTempFilePath({
        canvas, x: 0, y: 0, width, height,
        destWidth: width, destHeight: height, fileType: "png",
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      });
      }).catch(reject);
    });
  },

  saveImage() {
    if (this.data.isSavingImage) return;
    const share = this.slipShare;
    if (!this.isCurrentSlip(share)) return;
    const current = () => this.isCurrentSlip(share);
    try { wx.getFileSystemManager().accessSync(share.wallpaperUrl); }
    catch (_) { this.wallpaperError(); return; }
    // Content can become invalid while copyFile is pending. The same save still
    // owns its busy flag, but never a newer operation or a different page identity.
    const operation = { authority: captureIdentityAuthority(), epoch: this.wallpaperEpoch };
    this.slipSaveOperation = operation;
    this.setData({ isSavingImage: true, slipFeedback: "正在生成图片..." });
    return Promise.resolve(share.wallpaperUrl)
      .then((filePath) => {
        if (!filePath) {
          throw new Error("图片生成失败");
        }
        if (!current()) throw new Error("壁纸已变化");
        return copyToNamespacedSlipImage(filePath);
      })
      .then((filePath) => {
        return new Promise((resolve, reject) => {
          if (!current()) return reject(new Error("壁纸已变化"));
          wx.saveImageToPhotosAlbum({
            filePath,
            success: resolve,
            fail: reject
          });
        });
      })
      .then(() => {
        if (!current()) return;
        this.setData({ slipFeedback: "已保存到相册。可以用作壁纸，让这份温暖一直陪伴你。" });
        wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch((error) => {
        if (!current()) return;
        const errMsg = (error && error.errMsg) || "";
        const isAuthError = errMsg.includes("auth") || errMsg.includes("authorize") || errMsg.includes("permission");
        this.setData({ slipFeedback: isAuthError ? "需要相册权限后才能保存" : "保存失败，请再试一次" });
        if (isAuthError) {
          wx.showModal({
            title: "需要相册权限",
            content: "请允许慢聊小记保存图片到相册。",
            confirmText: "去设置",
            success: (res) => {
              if (current() && res.confirm && wx.openSetting) wx.openSetting();
            }
          });
          return;
        }
        wx.showToast({ title: "保存失败", icon: "none" });
      })
      .finally(() => {
        if (this.slipSaveOperation === operation && !this.unloaded && !this.wallpaperHidden
          && this.wallpaperEpoch === operation.epoch && isCurrentIdentityAuthority(operation.authority)) {
          this.slipSaveOperation = null;
          this.setData({ isSavingImage: false });
        }
      });
  }
};
module.exports = { cardData, cardMethods };
