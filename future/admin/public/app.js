/* Cuoshi admin: no cookies, tokens, credential storage, telemetry or third parties. */
;(function(){
'use strict'
const names={overview:['运营概览','OVERVIEW','只看必要的信息。这里不会出现任何人的私人简记。'],
 accounts:['账号状态','ACCOUNTS','仅展示账号及同步状态。私人简记不在这个列表里。'],
 system:['系统状态','SYSTEM HEALTH','从同步到备份，重要的是知道系统是否真的可靠。']}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const root=document.getElementById('view-content')
let active='overview',list=[],search=''
const state={overview:null,accounts:null,system:null}
const statusPill=(v)=>'<span class="pill'+(/待|未|阻断/.test(v)?' warn':'')+'">'+escape(v)+'</span>'
const title=(s)=>'<div class="panel-head"><h2>'+escape(s)+'</h2><span class="panel-sub">仅供界面验收 · 示例数据</span></div>'
const dateStamp=()=>new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date())
function metrics(m){return Object.entries({accounts:['累计模拟账号',m.accounts.toLocaleString(),'其中不含任何真实用户'],active7d:['近七天活跃',m.active7d.toLocaleString(),'样例统计 · 不追踪简记'],syncRate:['自动同步成功率',m.syncRate.toFixed(1)+'%','样例计算 · 未接入服务'],cancelled:['模拟注销数',String(m.cancelled).padStart(2,'0'),'仅汇总不显示私人内容']}).map(([k,[label,value,sub]])=>'<div class="card stat-card"><div class="metric-label">'+escape(label)+'</div><div class="metric-value" data-metric="'+escape(k)+'">'+escape(value)+'</div><div class="metric-foot">'+escape(sub)+'</div></div>').join('')}
function chart(data){const max=Math.max(...data.map(d=>d.active),1);return '<div class="chart-wrap" role="img" aria-label="虚构的十四日活跃与同步趋势柱形图">'+data.map(d=>'<div class="bar-pair"><div class="bar" data-height="'+Math.max(4,Math.round(d.active/max*190))+'"></div><div class="bar alt" data-height="'+Math.max(4,Math.round(d.backup/max*190))+'"></div></div>').join('')+'</div><div class="chart-axis"><span>14 天前</span><span>7 天前</span><span>今天</span></div><div class="legend"><span><i class="pale"></i>活跃（示例）</span><span><i></i>已同步（示例）</span></div>'}
function overview(d){return '<div class="stat-grid">'+metrics(d.metrics)+'</div><div class="two-col"><section class="panel">'+title('使用趋势')+chart(d.chart)+'</section><section class="panel">'+title('隐私原则')+'<div class="health-list"><div class="health-row"><span class="health-name">默认查看私人简记</span>'+statusPill('禁止')+'</div><div class="health-row"><span class="health-name">客服查阅</span><span class="mini-tag">默认禁止 · 安全审计</span></div><div class="health-row"><span class="health-name">管理员全库导出</span>'+statusPill('禁止')+'</div><div class="health-row"><span class="health-name">已注销用户正文保留</span>'+statusPill('不保留')+'</div></div><div class="callout">数字只用于了解产品是否稳定运行，不用于判断任何人的生活。<br/>正式运营数字需要受限的只读聚合接口和隐私评估。</div></section></div>'}
function accounts(d){list=d.items;return '<section class="panel">'+title('账号同步状态')+'<div class="panel-head"><p class="section-desc">下表是演示账号，仅按状态定位问题，不能打开私人正文。</p><input class="filter" id="account-filter" type="search" placeholder="搜索模拟账号或状态" aria-label="搜索账号" value="'+escape(search)+'" autocomplete="off"/></div><div class="table-wrap"><table><thead><tr><th>账号</th><th>注册日期</th><th>最近同步</th><th>同步状态</th><th>账号状态</th></tr></thead><tbody id="account-rows"></tbody></table></div><div class="callout">生产环境不应提供任意用户正文浏览、全量检索或一键导出。管理员账号不等于正文读取权限。</div></section>'}
function renderAccountRows(){const el=document.getElementById('account-rows');if(!el)return;const filtered=list.filter(a=>[a.displayId,a.sync,a.state].some(x=>x.includes(search.trim())));el.innerHTML=filtered.length?filtered.map(a=>'<tr><td class="mono">'+escape(a.displayId)+'</td><td>'+escape(a.joined)+'</td><td>'+escape(a.lastSynced)+'</td><td>'+statusPill(a.sync)+'</td><td>'+statusPill(a.state)+'</td></tr>').join(''):'<tr><td colspan="5" class="empty">没有符合条件的模拟账号</td></tr>'}
function system(d){return '<div class="two-col"><section class="panel">'+title('组件健康')+'<div class="health-list">'+d.services.map(s=>'<div class="health-row"><div><strong class="thin">'+escape(s.name)+'</strong><div class="panel-sub">'+escape(s.description)+'</div></div>'+statusPill(s.status)+'</div>').join('')+'</div></section><section class="panel">'+title('发布前检查')+'<div class="health-list">'+[['代码测试','CI 已通过'],['个人主体及小程序备案','未完成'],['大陆云服务器及 HTTPS','未部署'],['唯一管理员登录','未接入'],['双真机验收','未执行']].map(([a,b])=>'<div class="health-row"><span class="health-name">'+escape(a)+'</span>'+statusPill(b)+'</div>').join('')+'</div><div class="callout">健康页面不得用模拟的绿色状态冒充生产可用性。正式接入前，不提供实时在线率及真实告警数字。</div><div class="actions cta"><button class="btn" id="refresh-demo">刷新示例状态</button><span class="clock" id="refreshed">未请求</span></div></section></div>'}
function bind(){
  // CSP blocks inline style attributes; CSSOM style assignments are allowed.
  // Keep the strict no-inline-style policy instead of weakening the dashboard.
  for(const bar of document.querySelectorAll('.bar[data-height]')){
    const height=Number(bar.dataset.height)
    if(Number.isInteger(height)&&height>=4&&height<=190)bar.style.height=height+'px'
  }
  const f=document.getElementById('account-filter');if(f){f.addEventListener('input',e=>{search=e.target.value;renderAccountRows()});renderAccountRows()}
  document.getElementById('refresh-demo')?.addEventListener('click',()=>{document.getElementById('refreshed').textContent='示例刷新 · '+dateStamp()})
}
async function switchTo(next){if(!(next in names))return;active=next;for(const b of document.querySelectorAll('[data-view]')){const on=b.dataset.view===next;b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}
const [label,eyebrow,description]=names[next];document.querySelector('.intro h1').innerHTML=escape(label)+'<span class="punct">.</span>';document.querySelector('.eyebrow').textContent=eyebrow;document.querySelector('.intro p').textContent=description;document.getElementById('crumb').textContent=label
root.innerHTML='<div class="empty">读取本地模拟数据中…</div>'
try{if(!state[next]){const response=await fetch('/api/preview/'+next,{cache:'no-store'});if(!response.ok)throw Error('preview_unavailable');const data=await response.json();if(data.sampleOnly!==true)throw Error('synthetic_guard_failed');state[next]=data}
 if(active!==next)return
 root.innerHTML=({overview,accounts,system})[next](state[next]);bind()
}catch{if(active===next)root.innerHTML='<div class="empty"><strong>预览未就绪</strong>无法读取模拟数据；不会自动连接生产数据库。</div>'}}
for(const el of document.querySelectorAll('[data-view]'))el.addEventListener('click',()=>switchTo(el.dataset.view))
void switchTo('overview')
})()
