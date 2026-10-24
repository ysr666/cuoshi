/** Explicitly synthetic and disconnected; no real database, JWT or staff identity. */
const sampleOnly=true
const overview={
  sampleOnly,metrics:{accounts:1286,active7d:418,syncRate:99.4,cancelled:3},
  chart:[32,37,31,45,49,53,44,58,62,61,69,73,70,82].map((n,i)=>({
    day:String(i+1).padStart(2,'0'),active:n,backup:Math.round(n*.76)
  })),
  daily:{title:'仅展示聚合数字',description:'不会汇总、搜索或展示用户写过的具体内容。'}
}
const accounts={sampleOnly,items:[
  {displayId:'模拟用户 · A013',joined:'2026-10-18',lastSynced:'2026-10-24 09:42',sync:'正常',state:'正常'},
  {displayId:'模拟用户 · A028',joined:'2026-10-20',lastSynced:'2026-10-24 08:11',sync:'待同步',state:'正常'},
  {displayId:'模拟用户 · A041',joined:'2026-10-21',lastSynced:'2026-10-23 22:16',sync:'正常',state:'正常'},
  {displayId:'模拟用户 · A056',joined:'2026-10-22',lastSynced:'—',sync:'未开启',state:'已注销'},
  {displayId:'模拟用户 · A073',joined:'2026-10-22',lastSynced:'2026-10-24 09:35',sync:'正常',state:'正常'}
]}
const system={sampleOnly,services:[
  {name:'API 网关',status:'演示正常',description:'生产证书、域名及告警未连接'},
  {name:'PostgreSQL',status:'演示正常',description:'本页未连接真实数据库'},
  {name:'云端自动同步',status:'演示正常',description:'真实成功率需要部署后统计'},
  {name:'备份与恢复',status:'未接入',description:'需要真实云资源及加密备份策略'},
  {name:'唯一管理员登录',status:'未接入',description:'仅管理员一人，生产身份验证和域名尚未配置'}
]}
export const DEMO_DATA=Object.freeze({overview,accounts,system})
