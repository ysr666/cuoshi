import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {checkedPublicHostname,checkPublicCloudHealth} from '../future/server/deploy/check-public-health.mjs'
let count=0
const check=(v,m)=>{assert.ok(v,m);count++}
check(checkedPublicHostname('service.cuoshi.cn')==='service.cuoshi.cn',
 'Real production DNS name shape accepted (mocked; never sent)')
for(const domain of ['api.cuoshi.invalid','localhost','localhost.local',
 '127.0.0.1','10.1.2.3','[::1]','api.example.com','api.example.invalid',
 'local.internal','foo.test','foo.example','a.LOCAL.cn','foo..bar.cn',
 'a/b.cn','foo.cn:443','foo.cn@evil.cn','foo.cn?x=1',''] ){
 assert.throws(()=>checkedPublicHostname(domain),/domain_invalid/);count++
}
let invoked=0
const good=await checkPublicCloudHealth({CUOSHI_PUBLIC_DOMAIN:'service.cuoshi.cn'},
 async (url,ms)=>{
   invoked++
   check(url==='https://service.cuoshi.cn/healthz'&&ms===5000,
    'Exactly one HTTPS /healthz URL with 5 second upper deadline')
   return 204
 })
check(good===true&&invoked===1,'Only HTTP 204 is successful readiness')
for(const status of [200,301,302,401,403,404,429,500,503,undefined]){
 await assert.rejects(checkPublicCloudHealth({CUOSHI_PUBLIC_DOMAIN:'service.cuoshi.cn'},
   async()=>status),/monitor_unavailable/);count++
}
await assert.rejects(checkPublicCloudHealth({CUOSHI_PUBLIC_DOMAIN:'service.cuoshi.cn'},
 async()=>{throw Error('synthetic TLS certificate invalid')}
),/synthetic TLS/);count++
let queried=false
await assert.rejects(checkPublicCloudHealth({CUOSHI_PUBLIC_DOMAIN:'api.cuoshi.invalid'},
 async()=>{queried=true;return 204}),/domain_invalid/);count++
check(!queried,'Placeholder or invalid domain rejected before any network access')
const result=spawnSync(process.execPath,['future/server/deploy/check-public-health.mjs'],{
 env:{PATH:process.env.PATH||''},encoding:'utf8',timeout:7000
})
check(result.status===1&&result.stderr.trim()==='private_cloud_monitor_failed',
 'Real standalone monitor fails closed with generic error if not configured')
check(!result.stdout.includes('HTTPS readiness OK'),
 'Missing operator domain cannot be reported healthy')
const unit=readFileSync('future/server/deploy/systemd/cuoshi-health.service','utf8')
const timer=readFileSync('future/server/deploy/systemd/cuoshi-health.timer','utf8')
for(const x of ['Type=oneshot','User=cuoshi-monitor','Group=cuoshi-monitor',
 'EnvironmentFile=/etc/cuoshi/monitor.env','TimeoutStartSec=12s',
 'NoNewPrivileges=yes','ProtectSystem=strict',
 'ExecStart=/usr/bin/node /opt/cuoshi/current/future/server/deploy/check-public-health.mjs'])
 check(unit.includes(x),'Monitor low-privilege systemd contract: '+x)
for(const x of ['OnCalendar=*:0/5','Persistent=true','Unit=cuoshi-health.service'])
 check(timer.includes(x),'Recurrent health monitor contract: '+x)
check(!unit.includes('CUOSHI_PG_BACKUP_URL')&&!unit.includes('APP_SECRET')&&
 !unit.includes('cloud.env')&&!unit.includes('ExecStart=/bin/sh'),
 'Read-only monitor cannot load cloud private secrets or shell snippets')
console.log('PASS',count,'production HTTPS failure probe and unprivileged five-minute timer')
