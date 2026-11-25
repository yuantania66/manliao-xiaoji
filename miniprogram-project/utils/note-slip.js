// Only the shared approved copy contract can enter canvas output or a share title.
const { approvedWallpaperCopy } = require('./note-wallpaper-state');
const { STAGING_ORIGIN, isOwnerPreview } = require('./owner-preview');
const getShareableSlip = value => {
  const copy = value && { copyId: value.copyId, quote: value.quote, caption: value.caption };
  return approvedWallpaperCopy(copy) ? { quote: copy.quote, caption: copy.caption } : null;
};
const getWallpaperSize = (system = {}) => {
  const w=Number(system.screenWidth || system.windowWidth), h=Number(system.screenHeight);
  const ratio=w>0 && h>0 && Number.isFinite(w+h) ? Math.max(w,h)/Math.min(w,h) : 19.5/9;
  return {width:1080,height:Math.round(1080*Math.max(16/9,Math.min(20/9,ratio)))};
};

// Prefer authored phrase boundaries; on narrower lines keep closing punctuation
// with the preceding character. No truncation or hidden ellipsis.
const wrapText = (ctx,text,maxWidth) => {
  const lines=[];
  const noStart=/^[，。！？；：、,.!?;:）】》」』”’…]/;
  for(const paragraph of String(text).split('\n')) {
    let line='';
    for(const char of Array.from(paragraph)) {
      if(line && ctx.measureText(line+char).width>maxWidth) {
        let carry='';
        if(noStart.test(char)) {
          const parts=Array.from(line);
          while(parts.length && noStart.test(parts[parts.length-1])) carry=parts.pop()+carry;
          if(parts.length) carry=parts.pop()+carry;
          line=parts.join('');
        }
        if(line) lines.push(line);
        line=carry+char;
      } else line+=char;
    }
    if(line) lines.push(line);
  }
  return lines;
};
const drawCopy = (ctx,text,x,y,width,size,lineHeight,maxLines,color,weight='normal',family='sans-serif',align='left') => {
  ctx.fillStyle=color; ctx.textBaseline='top'; ctx.textAlign=align;
  let lines;
  for(;;) {
    ctx.font=weight+' '+size+'px '+family;
    lines=wrapText(ctx,text,width);
    if(lines.length<=maxLines && lines.every(line=>ctx.measureText(line).width<=width)) break;
    if(size<=12) throw new Error('文案过长，无法完整排版');
    size-=1;
  }
  lines.forEach((line,i)=>ctx.fillText(line,x,y+i*lineHeight));
  return lines.length*lineHeight;
};
const layouts={
  'garden-light-v1':{family:'WallpaperHand',ink:'#364b37',align:'center',x:270,y:.32,width:340},
  'garden-meadow-v1':{family:'WallpaperHand',ink:'#384d38',align:'center',x:270,y:.34,width:352},
  'hills-path-v1':{family:'serif',ink:'#39483d',align:'left',x:68,y:.26,width:404},
  'hills-lake-v1':{family:'serif',ink:'#36474a',align:'center',x:270,y:.28,width:398},
  'collage-flower-v1':{family:'WallpaperHand',ink:'#494e3b',align:'left',x:98,y:.34,width:350},
  'collage-leaf-v1':{family:'WallpaperHand',ink:'#464b3c',align:'left',x:76,y:.36,width:366}
};
const assetCaches = new WeakMap();
const bounded = (run, timeoutMs = 20000) => new Promise((resolve,reject) => {
  const timer=setTimeout(()=>reject(new Error('壁纸素材加载超时')),timeoutMs);
  const done=value=>{clearTimeout(timer);resolve(value);};
  const fail=error=>{clearTimeout(timer);reject(error || new Error('壁纸素材加载失败'));};
  try { run(done,fail); } catch(error) { fail(error); }
});
const isAllowedWallpaperBase = (baseUrl) => {
  // Mini Program runtimes may omit URL; accept only an ASCII origin and optional root slash.
  if (typeof baseUrl !== 'string') return false;
  const match = /^(https?):\/\/([a-z0-9.-]+)(?::([0-9]+))?\/?$/i.exec(baseUrl);
  if (!match || match[0] !== baseUrl) return false;
  const port = match[3] === undefined ? null : Number(match[3]);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return false;
  const url = { protocol: match[1].toLowerCase() + ':', hostname: match[2].toLowerCase() };
  const defaultPort = url.protocol === 'https:' ? 443 : 80;
  url.origin = url.protocol + '//' + url.hostname + (port !== null && port !== defaultPort ? ':' + port : '');
  if (url.protocol === 'https:') {
    // Staging is trusted only for the existing pinned develop preview contract.
    return url.origin === 'https://manliaoxiaoji.com' || url.origin === 'https://test.manliaoxiaoji.com'
      || (url.origin === STAGING_ORIGIN && isOwnerPreview());
  }
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
};
const prepareWallpaperAssets = async (wx,canvas,templateId,baseUrl) => {
  if(!Object.prototype.hasOwnProperty.call(layouts,templateId) || !isAllowedWallpaperBase(baseUrl)) throw new Error('壁纸素材地址无效');
  let cache=assetCaches.get(wx);
  if(!cache) { cache={files:new Map(),font:null,fontReady:false}; assetCaches.set(wx,cache); }
  let entry=cache.files.get(templateId);
  if(entry?.path) {
    try { wx.getFileSystemManager().accessSync(entry.path); }
    catch(_) { cache.files.delete(templateId); entry=null; }
  }
  const downloadBackground = () => bounded((resolve,reject)=>wx.downloadFile({
    url:baseUrl+'/wallpapers/v1/'+templateId+'.jpg',timeout:45000,
    success:res=>res.statusCode===200 && res.tempFilePath ? resolve(res.tempFilePath) : reject(new Error('壁纸背景暂不可用')),
    fail:reject
  }), 48000);
  if(!entry) {
    entry={path:null,promise:null}; cache.files.set(templateId,entry);
    const current=entry;
    entry.promise=downloadBackground().then(file=>{current.path=file;return file;}).catch(async (firstError)=>{
      // One bounded retry for transient network stalls (test CDN often exceeds 15s).
      try {
        const file = await downloadBackground();
        current.path=file; return file;
      } catch (_) {
        if(cache.files.get(templateId)===current) cache.files.delete(templateId);
        throw firstError;
      }
    });
  }
  // Font is best-effort: handwriting face must not block wallpaper export.
  if(!cache.font && !cache.fontReady) {
    cache.font=bounded((resolve,reject)=>wx.loadFontFace({
      family:'WallpaperHand',source:'url("'+baseUrl+'/wallpapers/v1/wallpaper-hand-v1.ttf")',
      global:true,scopes:['native'],success:()=>{cache.fontReady=true;resolve();},fail:reject
    }), 20000).catch(()=>{cache.font=null;cache.fontReady=false;});
  }
  const file = await entry.promise;
  if (cache.font) await Promise.resolve(cache.font).catch(() => undefined);
  const backgroundImage=await bounded((resolve,reject)=>{
    const image=canvas.createImage();
    image.onload=()=>Number.isFinite(image.width+image.height) && image.width>0 && image.height>0
      ? resolve(image) : reject(new Error('壁纸图片尺寸无效'));
    image.onerror=reject; image.src=file;
  }).catch(error=>{cache.files.delete(templateId);throw error;});
  return {backgroundImage};
};
const drawBackground = (ctx,image,width,height) => {
  if(!image || !(image.width>0 && image.height>0)) throw new Error('壁纸背景未准备好');
  const scale=Math.max(width/image.width,height/image.height);
  const sw=width/scale,sh=height/scale;
  ctx.drawImage(image,(image.width-sw)/2,(image.height-sh)/2,sw,sh,0,0,width,height);
};
const drawWallpaper = (ctx,data,height) => {
  const slip=getShareableSlip(data.slip),layout=layouts[data.slipStyle];
  if(!slip || !layout) throw new Error('壁纸内容不可用');
  drawBackground(ctx,data.backgroundImage,540,height);
  const {x,width,align,ink,family}=layout,y=height*layout.y;
  const titleHeight=drawCopy(ctx,slip.quote.replace('，','，\n'),x,y,width,36,49,3,ink,'normal',family,align);
  const captionX=data.slipStyle.startsWith('collage') ? x+12 : x;
  drawCopy(ctx,slip.caption.replace('，','，\n'),captionX,y+titleHeight+26,width-12,18,29,3,ink,'normal','sans-serif',align);
  // Light feathered footer keeps the centered mark legible over photographic detail.
  const veil=ctx.createLinearGradient(0,height*.88,0,height);
  veil.addColorStop(0,'rgba(250,248,240,0)'); veil.addColorStop(1,'rgba(250,248,240,.72)');
  ctx.fillStyle=veil;ctx.fillRect(0,height*.88,540,height*.12);
  drawCopy(ctx,'慢聊小记',270,height*.945,200,14,20,1,ink,'normal','sans-serif','center');
};
const drawShareCover = (ctx,data) => {
  const slip=getShareableSlip(data.slip),layout=layouts[data.slipStyle];
  if(!slip || !layout) throw new Error('分享内容不可用');
  drawBackground(ctx,data.backgroundImage,500,400);
  ctx.fillStyle='rgba(250,248,240,.80)';ctx.fillRect(0,0,500,400);
  const h=drawCopy(ctx,slip.quote.replace('，','，\n'),250,60,410,34,47,2,layout.ink,'normal',layout.family,'center');
  drawCopy(ctx,slip.caption,250,60+h+26,404,20,29,3,layout.ink,'normal','sans-serif','center');
  drawCopy(ctx,'慢聊小记',250,354,220,14,20,1,layout.ink,'normal','sans-serif','center');
};
module.exports = {getShareableSlip,getWallpaperSize,wrapText,prepareWallpaperAssets,drawWallpaper,drawShareCover};
