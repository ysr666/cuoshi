/* Private staff UI. Only receives externally MFA-issued short-lived tokens.
 * No browser storage, cookies, URL credentials, external assets, or telemetry.
 */
;(()=>{
'use strict'
const el=id=>document.getElementById(id)
let session=null,epoch=0,controller=null,view='overview'
const titles={overview:['运营概览','只展示实际计数，不会显示私人简记。'],
  cases:['工单核验','只有服务端明确批准的单日记录才能展示。'],
  system:['系统状态','这里说明能验证什么，不能把未知状态当作健康。']}
function message(text){el('message').textContent=text;el('message').hidden=!text}
function clearPrivate(){el('private-day').textContent='';el('private-events').textContent='';el('case-result').hidden=true}
function clearMetrics(){el('metrics').replaceChildren();el('updated-at').textContent=''}
function endSession(notice=''){session=null;epoch++;controller?.abort();controller=null
  el('staff-token').value='';el('case-id').value='';el('owner-id').value='';el('day-key').value=''
  clearPrivate();clearMetrics();el('logout').hidden=true;el('auth-card').hidden=false
  for(const name of Object.keys(titles))el(name).hidden=true
  message(notice);switchView('overview')
}
function switchView(next){if(!(next in titles))return
  view=next;clearPrivate();for(const name of Object.keys(titles))el(name).hidden=!session||name!==next
  for(const item of document.querySelectorAll('[data-view]')){
    const on=item.dataset.view===next;item.classList.toggle('active',on)
    if(on)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current')
  }
  const [heading,subtitle]=titles[next]
  el('heading').replaceChildren(document.createTextNode(heading),(()=>{const span=document.createElement('span');span.className='punct';span.textContent='.';return span})())
  el('crumb').textContent=heading;el('subtitle').textContent=subtitle
}
function metrics(data){
  const definitions=[
    ['totalAccounts','未注销账号总数','未包含任何私人简记'],
    ['cloudEnabledAccounts','开启云同步的账号','云同步授权状态'],
    ['storedSnapshots','已存储快照账号','与同步成功率不同'],
    ['snapshotsUpdatedLast7d','近七日更新快照账号','不是七日活跃用户'],
    ['accountsCreatedLast7d','近七日新账号','按注册时间统计']
  ]
  const root=el('metrics');root.replaceChildren()
  for(const [key,label,detail] of definitions){
    if(!Number.isSafeInteger(data?.[key])||data[key]<0)throw Error('invalid_metrics')
    const item=document.createElement('div');item.className='card stat-card'
    for(const [className,value] of [['metric-label',label],['metric-value',data[key].toLocaleString('zh-CN')],['metric-foot',detail]]){
      const span=document.createElement('div');span.className=className;span.textContent=value;item.appendChild(span)
    }
    root.appendChild(item)
  }
  el('updated-at').textContent='本次查询：'+new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date())
}
async function call(path,method='GET',body=null){
  if(!session)throw Error('not_authenticated')
  // Supersede any older request. No response from a previous staff session can
  // paint private content after logout or a new session is entered.
  controller?.abort();const local=new AbortController();controller=local
  const generation=epoch
  const init={method,headers:{Authorization:'Bearer '+session},credentials:'omit',cache:'no-store',
    referrerPolicy:'no-referrer',signal:local.signal}
  if(body){init.headers['Content-Type']='application/json';init.body=JSON.stringify(body)}
  try{
    const response=await fetch(path,init)
    if(local.signal.aborted||epoch!==generation)throw Error('stale_session')
    if(response.status===401){endSession('员工会话无效、已失效或被撤销。请重新完成 MFA。');throw Error('stale_session')}
    if(response.status===403)throw Error('access_denied')
    if(!response.ok)throw Error('service_unavailable')
    const data=await response.json()
    if(epoch!==generation||local.signal.aborted)throw Error('stale_session')
    return data
  }catch(error){
    if(local.signal.aborted||epoch!==generation)throw Error('stale_session')
    throw error
  }finally{if(controller===local)controller=null}
}
async function refresh(){if(!session)return
  clearMetrics();message('正在核验权限并读取运营汇总…')
  try{const data=await call('/internal/admin/overview');metrics(data);message('')}
  catch(error){if(error.message==='stale_session')return
    message(error.message==='access_denied'?'当前员工角色无权读取运营汇总；没有返回任何账号数据。':'无法读取汇总数据；不会使用模拟数字代替。')}
}
el('auth-form').addEventListener('submit',async event=>{
  event.preventDefault();const token=el('staff-token').value.trim()
  el('staff-token').value=''
  if(!/^[A-Za-z0-9_.-]{90,1800}$/.test(token)){message('这不是符合格式的员工会话令牌；请先通过独立身份提供方完成 MFA。');return}
  endSession();session=token;el('logout').hidden=false;el('auth-card').hidden=true
  switchView('overview');await refresh()
})
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
  if(!session){message('先完成员工身份核验才能使用此页面。');return}
  switchView(button.dataset.view);message('')
})
el('refresh').addEventListener('click',()=>{void refresh()})
el('logout').addEventListener('click',()=>endSession('本次员工会话已从页面清除。'))
el('clear-case').addEventListener('click',()=>{controller?.abort();clearPrivate();message('已清除本页查看过的私人内容。')})
el('case-form').addEventListener('submit',async event=>{
  event.preventDefault();clearPrivate()
  const caseId=el('case-id').value.trim(),ownerId=el('owner-id').value.trim(),dayKey=el('day-key').value
  if(!/^[A-Za-z0-9_-]{8,128}$/.test(caseId)||!/^[A-Za-z0-9_-]{8,128}$/.test(ownerId)||
    !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)){
    message('请按工单号、账号标识及日期填写完整的指定范围。');return
  }
  message('正在验证已批准的工单范围，并记录此次访问…')
  try{
    const outcome=await call('/internal/admin/read-day','POST',{caseId,ownerId,dayKey})
    if(!Array.isArray(outcome?.events)||!(outcome.day===null||typeof outcome.day==='object'))throw Error('invalid_response')
    el('private-day').textContent=JSON.stringify(outcome.day,null,2).slice(0,30000)
    el('private-events').textContent='授权记录事件数：'+outcome.events.length+'。内容仅在页面会话中临时显示，不写入本地存储。'
    el('case-result').hidden=false;message('仅显示本次获准的单日结果；离开或结束会话时将清除。')
  }catch(error){clearPrivate();if(error.message==='stale_session')return
    message(error.message==='access_denied'?'服务端未批准该工单与日期的读取，未返回任何私人内容。':'工单读取失败；不保留或猜测任何记录。')}
})
window.addEventListener('pagehide',()=>{controller?.abort();clearPrivate();clearMetrics();session=null})
})()
