/* Sole-owner dashboard. Authentication is external; no alternate admins,
 * password storage, browser credentials, notes, or team workflows. */
;(()=>{
'use strict'
const el=id=>document.getElementById(id)
let token=null,generation=0,request=null,active='overview'
const views={overview:['运营概览','仅展示真实聚合统计，不包含用户私人简记。'],
 system:['系统状态','只有能够实际验证的状态才会展示。']}
function alertStatus(s){el('message').textContent=s;el('message').hidden=!s}
function clearData(){el('metrics').replaceChildren();el('updated-at').textContent=''}
function logout(note=''){
 generation++;request?.abort();request=null;token=null;clearData()
 el('staff-token').value='';el('auth-card').hidden=false;el('logout').hidden=true
 switchView('overview');alertStatus(note)
}
function switchView(name){if(!(name in views))return
 request?.abort();active=name
 for(const b of document.querySelectorAll('[data-view]')){
   const on=b.dataset.view===name;b.classList.toggle('active',on)
   if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')
 }
 for(const key of Object.keys(views))el(key).hidden=!token||key!==name
 const [title,desc]=views[name]
 el('heading').replaceChildren(document.createTextNode(title),(()=>{
   const span=document.createElement('span');span.className='punct';span.textContent='.';return span
 })())
 el('crumb').textContent=title;el('subtitle').textContent=desc
}
function showMetrics(data){
 const specs=[['totalAccounts','未注销账号总数','仅匿名聚合'],
 ['cloudEnabledAccounts','开启云同步的账号','当前已授权同步'],
 ['storedSnapshots','已存储快照的账号','不含私人记录正文'],
 ['snapshotsUpdatedLast7d','近七日更新快照账号','不等于七日活跃用户'],
 ['accountsCreatedLast7d','近七日新账号','仅注册时间统计']]
 const validated=specs.map(([key,label,note])=>{
   if(!Number.isSafeInteger(data?.[key])||data[key]<0)throw Error('invalid_metrics')
   return [label,data[key].toLocaleString('zh-CN'),note]
 })
 const root=el('metrics');root.replaceChildren()
 for(const values of validated){
   const card=document.createElement('div');card.className='card stat-card'
   for(const [i,value] of values.entries()){
     const div=document.createElement('div')
     div.className=['metric-label','metric-value','metric-foot'][i]
     div.textContent=value;card.appendChild(div)
   }
   root.appendChild(card)
 }
 el('updated-at').textContent='查询于 '+new Intl.DateTimeFormat('zh-CN',
   {dateStyle:'medium',timeStyle:'short'}).format(new Date())
}
async function refresh(){
 if(!token)return
 request?.abort();const controller=new AbortController();request=controller
 const version=generation;clearData();alertStatus('正在验证唯一管理员身份…')
 try{
   const response=await fetch('/internal/admin/overview',{
     headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',
     referrerPolicy:'no-referrer',signal:controller.signal})
   if(version!==generation||controller.signal.aborted)return
   if(response.status===401){logout('管理员会话无效或已过期。');return}
   if(response.status===403){alertStatus('当前身份没有管理员权限；没有返回用户数据。');return}
   if(!response.ok)throw Error('service_unavailable')
   const data=await response.json()
   if(version!==generation||controller.signal.aborted||active!=='overview')return
   showMetrics(data);alertStatus('')
 }catch{
   if(version===generation&&!controller.signal.aborted)
     alertStatus('运营汇总暂时不可用，不使用模拟数字代替。')
 }finally{if(request===controller)request=null}
}
el('auth-form').addEventListener('submit',event=>{
 event.preventDefault();const submitted=el('staff-token').value.trim();el('staff-token').value=''
 if(!/^[A-Za-z0-9_.-]{90,1800}$/.test(submitted)){
   alertStatus('请输入经唯一管理员身份验证后签发的短期会话。');return
 }
 logout();token=submitted;el('auth-card').hidden=true;el('logout').hidden=false
 switchView('overview');void refresh()
})
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>{
 if(!token){alertStatus('请先登录管理员账号。');return}
 switchView(b.dataset.view);alertStatus('')
})
el('refresh').addEventListener('click',()=>{void refresh()})
el('logout').addEventListener('click',()=>logout('已退出后台。'))
window.addEventListener('pagehide',()=>logout())
})()
