type BlindUiItem = {
  reviewId: string;
  contextLimitations: string;
  openInteraction: boolean;
  X: string;
  Y: string;
};

const jsonForScript = (value: unknown) => JSON.stringify(value).replace(/</gu, "\\u003c");

export const buildHumanBlindReviewHtml = ({
  keyCommitment,
  criticalFailures,
  items,
}: {
  keyCommitment: string;
  criticalFailures: string[];
  items: BlindUiItem[];
}) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>批次 1.5 人工盲选</title>
  <style>
    :root { color-scheme: light; --bg:#f5f2ec; --card:#fffdf9; --ink:#24211d; --muted:#6c655c; --line:#d9d1c5; --accent:#5b6f5a; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; }
    main { width:min(1060px,calc(100% - 28px)); margin:24px auto 60px; }
    header { margin-bottom:18px; }
    h1 { margin:0 0 6px; font-size:26px; }
    h2,h3 { margin:0 0 10px; }
    .muted { color:var(--muted); }
    .commit { overflow-wrap:anywhere; font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .progress { height:7px; background:#e2ddd4; border-radius:999px; overflow:hidden; margin:14px 0 20px; }
    .progress > div { height:100%; background:var(--accent); transition:width .2s; }
    .context,.card,.score,.finish { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; }
    .context { margin-bottom:14px; }
    .pair { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .card pre { margin:0; white-space:pre-wrap; font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; }
    .score { margin-top:14px; }
    .score-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    fieldset { border:0; padding:0; margin:0 0 14px; }
    legend { font-weight:650; margin-bottom:7px; }
    label.option { display:inline-flex; align-items:center; gap:6px; margin:0 14px 6px 0; cursor:pointer; }
    details { margin:8px 0 14px; }
    textarea { width:100%; min-height:72px; border:1px solid var(--line); border-radius:9px; padding:10px; font:inherit; background:#fff; }
    .actions { display:flex; gap:10px; justify-content:flex-end; margin-top:16px; flex-wrap:wrap; }
    button { border:1px solid var(--line); background:#fff; color:var(--ink); border-radius:9px; padding:9px 15px; font:inherit; cursor:pointer; }
    button.primary { color:white; background:var(--accent); border-color:var(--accent); }
    button:disabled { opacity:.45; cursor:not-allowed; }
    .finish textarea { min-height:320px; font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; }
    @media (max-width:760px) { .pair,.score-grid { grid-template-columns:1fr; } main { width:min(100% - 18px,1060px); } }
  </style>
</head>
<body>
<main>
  <header>
    <h1>批次 1.5 人工盲选</h1>
    <div class="muted">每组 X/Y 独立随机。界面不包含来源、模型、Prompt、版本或密钥。</div>
    <div class="commit">密钥承诺 SHA-256：${keyCommitment}</div>
    <div class="progress"><div id="bar"></div></div>
  </header>
  <section id="app"></section>
</main>
<script>
const ITEMS=${jsonForScript(items)};
const FAILURES=${jsonForScript(criticalFailures)};
const KEY_COMMITMENT=${jsonForScript(keyCommitment)};
const answers={};
let index=0;
const app=document.getElementById('app');
const bar=document.getElementById('bar');
const esc=(value)=>String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const selected=(name,value)=>answers[ITEMS[index].reviewId]?.[name]===value?' checked':'';
const radio=(name,value,label)=>'<label class="option"><input type="radio" name="'+name+'" value="'+value+'"'+selected(name,value)+'>'+label+'</label>';
const failureChecks=(side)=>FAILURES.map((failure)=>'<label class="option"><input type="checkbox" data-critical="'+side+'" value="'+esc(failure)+'">'+esc(failure)+'</label>').join('<br>');
const sideScore=(side)=>'<div><h3>'+side+' 评分</h3>'+
  '<fieldset><legend>这条回复自身是否合格？</legend>'+radio(side+'_absolute','yes','是')+radio(side+'_absolute','no','否')+'</fieldset>'+
  '<fieldset><legend>是否产生了合适的对话结果？</legend>'+radio(side+'_outcome','yes','是')+radio(side+'_outcome','no','否')+'</fieldset>'+
  '<fieldset><legend>如果你是用户，是否愿意继续？</legend>'+radio(side+'_continue','yes','是')+radio(side+'_continue','no','否')+'</fieldset>'+
  '<details><summary>严重失败（默认无）</summary><div style="margin-top:8px">'+failureChecks(side)+'</div></details></div>';
function render(){
  const item=ITEMS[index];
  bar.style.width=((index)/ITEMS.length*100)+'%';
  app.innerHTML='<div class="context"><strong>'+esc(item.reviewId)+'</strong> · 第 '+(index+1)+' / '+ITEMS.length+' 组<br><span class="muted">上下文限制：'+esc(item.contextLimitations)+'</span></div>'+
    '<div class="pair"><article class="card"><h2>X</h2><pre>'+esc(item.X)+'</pre></article><article class="card"><h2>Y</h2><pre>'+esc(item.Y)+'</pre></article></div>'+
    '<section class="score"><div class="score-grid">'+sideScore('X')+sideScore('Y')+'</div>'+
    '<fieldset><legend>整体更偏好哪一侧？</legend>'+radio('preference','X','X')+radio('preference','Y','Y')+radio('preference','tie','差不多')+'</fieldset>'+
    '<fieldset><legend>是否有一侧明显更差？</legend>'+radio('worse','none','没有')+radio('worse','X','X')+radio('worse','Y','Y')+'</fieldset>'+
    '<label><strong>备注（可选）</strong><textarea id="notes">'+esc(answers[item.reviewId]?.notes||'')+'</textarea></label>'+
    '<div class="actions"><button id="prev"'+(index===0?' disabled':'')+'>上一组</button><button class="primary" id="next">'+(index===ITEMS.length-1?'冻结全部答案':'保存并下一组')+'</button></div></section>';
  const saved=answers[item.reviewId];
  if(saved){ for(const side of ['X','Y']) for(const value of saved[side+'_critical']||[]){ const box=[...document.querySelectorAll('[data-critical="'+side+'"]')].find((node)=>node.value===value); if(box) box.checked=true; } }
  document.getElementById('prev').onclick=()=>{ save(false); index-=1; render(); };
  document.getElementById('next').onclick=()=>{ if(!save(true)) return; if(index<ITEMS.length-1){ index+=1; render(); } else finish(); };
}
function value(name){ return document.querySelector('input[name="'+name+'"]:checked')?.value||null; }
function save(validate){
  const item=ITEMS[index];
  const required=['X_absolute','X_outcome','X_continue','Y_absolute','Y_outcome','Y_continue','preference','worse'];
  const values=Object.fromEntries(required.map((name)=>[name,value(name)]));
  if(validate&&required.some((name)=>!values[name])){ alert('请完成本组所有单选项。'); return false; }
  answers[item.reviewId]={...values,
    X_critical:[...document.querySelectorAll('[data-critical="X"]:checked')].map((node)=>node.value),
    Y_critical:[...document.querySelectorAll('[data-critical="Y"]:checked')].map((node)=>node.value),
    notes:document.getElementById('notes').value.trim()};
  return true;
}
function finish(){
  bar.style.width='100%';
  const reviews=ITEMS.map((item)=>{ const a=answers[item.reviewId]; return {reviewId:item.reviewId,
    X:{absolutePass:a.X_absolute==='yes',appropriateConversationOutcome:a.X_outcome==='yes',wouldContinue:a.X_continue==='yes',criticalFailures:a.X_critical},
    Y:{absolutePass:a.Y_absolute==='yes',appropriateConversationOutcome:a.Y_outcome==='yes',wouldContinue:a.Y_continue==='yes',criticalFailures:a.Y_critical},
    pairPreference:a.preference,clearlyWorseSide:a.worse,notes:a.notes}; });
  const result={schemaVersion:1,reviewedBeforeKeyRead:true,reviewer:'user-human-review',keyCommitment:KEY_COMMITMENT,reviews};
  const text=JSON.stringify(result,null,2);
  app.innerHTML='<section class="finish"><h2>答案已冻结</h2><p>身份仍未揭盲。请复制下面 JSON 发回当前对话；在我验证承诺并读取密钥前，不会修改评分。</p><textarea id="result" readonly></textarea><div class="actions"><button id="copy">复制 JSON</button><button class="primary" id="download">下载 JSON</button></div></section>';
  document.getElementById('result').value=text;
  document.getElementById('copy').onclick=async()=>{ await navigator.clipboard.writeText(text); document.getElementById('copy').textContent='已复制'; };
  document.getElementById('download').onclick=()=>{ const blob=new Blob([text+'\\n'],{type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='hill-helping-batch1-5-human-review.json'; link.click(); URL.revokeObjectURL(link.href); };
}
render();
</script>
</body>
</html>`;
