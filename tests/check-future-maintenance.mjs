import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
let count=0
const check=(v,name)=>{assert.ok(v,name);count++}
const reject=(fn,re,name)=>{assert.throws(fn,re,name);count++}
const root=resolve('.')
const entry=resolve(root,'future/server/.private-build/future/server/src/privateMaintenance.js')
check(existsSync(entry),'Real independently compiled maintenance entry exists')
const req=createRequire(entry)
const {parsePrivateMaintenanceConfig,prunePrivateLoginWindows}=req('./privateMaintenance.js')
const pg=req('pg')
check(typeof pg.Pool==='function','Actual runtime pg module resolvable from scheduler entry')
const env={CUOSHI_MAINTENANCE_ACK:'PRUNE_LOGIN_WINDOWS_ONLY',
 CUOSHI_PG_SCHEMA:'cuoshi_prod',CUOSHI_PG_MAINTENANCE_URL:
 'postgresql://cuoshi_maint:fake@db.example.invalid:5432/cuoshi?sslmode=verify-full'}
const good=parsePrivateMaintenanceConfig(env)
check(good.schema==='cuoshi_prod'&&good.url===env.CUOSHI_PG_MAINTENANCE_URL,
 'Restricted one-purpose config requires exact schema and separate DB role')
for(const delta of [
 {CUOSHI_MAINTENANCE_ACK:undefined},{CUOSHI_MAINTENANCE_ACK:'ENABLE_ALL'},
 {CUOSHI_PG_SCHEMA:'public'},{CUOSHI_PG_SCHEMA:'pg_catalog'},
 {CUOSHI_PG_SCHEMA:'test;DROP TABLE x'},
 {CUOSHI_PG_MAINTENANCE_URL:undefined},
 {CUOSHI_PG_MAINTENANCE_URL:'postgresql://postgres:password@db.example.invalid/db?sslmode=verify-full'},
 {CUOSHI_PG_MAINTENANCE_URL:env.CUOSHI_PG_MAINTENANCE_URL.replace('verify-full','disable')},
 {CUOSHI_PG_MAINTENANCE_URL:env.CUOSHI_PG_MAINTENANCE_URL+'&options=-c%20search_path%3Dpublic'}
])reject(()=>parsePrivateMaintenanceConfig({...env,...delta}),
 /private_cloud_/,'Fail closed maintenance config: '+Object.keys(delta).join(','))
const role={role:'cuoshi_maint',rolsuper:false,rolcreatedb:false,
 rolcreaterole:false,rolreplication:false,rolbypassrls:false}
const capability={active_schema:'cuoshi_prod',subject:'cloud_wechat_login_rate_windows',
 can_prune:true,can_read:false,can_delete:false}
const queries=[]
const pool=(r=role,c=capability,result=3)=>({async query(sql){
 queries.push(sql)
 if(sql.includes('FROM pg_roles'))return {rows:[r]}
 if(sql.includes('current_schema()'))return {rows:[c]}
 if(sql==='SELECT cloud_prune_wechat_login_windows() AS removed')return {rows:[{removed:result}]}
 throw Error('unexpected_db_query')
}})
const removed=await prunePrivateLoginWindows(pool(),'cuoshi_prod')
check(removed===3&&queries.length===3,
 'Worker executes exact three queries and returns aggregated deletion count only')
check(!queries.join('|').includes('SELECT *')&&
 !queries.join('|').includes('cloud_snapshots')&&
 !queries.join('|').includes('cloud_admin_audit'),
 'Worker never reads private backup or admin audit records')
for(const badRole of [{...role,rolsuper:true},{...role,rolcreatedb:true},
 {...role,rolcreaterole:true},{...role,rolreplication:true},
 {...role,rolbypassrls:true}]){
 await assert.rejects(prunePrivateLoginWindows(pool(badRole),'cuoshi_prod'),
 /maintenance_role_unsafe/);count++
}
for(const badCap of [{...capability,can_prune:false},
 {...capability,can_read:true},{...capability,can_delete:true},
 {...capability,active_schema:'public'},{...capability,subject:null}]){
 await assert.rejects(prunePrivateLoginWindows(pool(role,badCap),'cuoshi_prod'),
 /maintenance_scope_unsafe/);count++
}
await assert.rejects(prunePrivateLoginWindows(pool(role,capability,-1),'cuoshi_prod'),
 /maintenance_result_invalid/);count++
await assert.rejects(prunePrivateLoginWindows(pool(role,capability,'1'),'cuoshi_prod'),
 /maintenance_result_invalid/);count++
const run=spawnSync(process.execPath,[entry],{
 cwd:root,env:{PATH:process.env.PATH||''},encoding:'utf8',timeout:7000})
check(run.status===1&&run.stderr.includes('private_cloud_maintenance_ack_required'),
 'Actual executable fails closed before PostgreSQL connection when not authorized')
check(!run.stdout.includes('Cuoshi private login window prune completed')&&
 !run.stderr.includes('fake@'),
 'Maintenance service never reports success or leaks DSN without authorization')
const base='future/server/deploy/systemd/'
const unit=readFileSync(base+'cuoshi-login-prune.service','utf8')
const timer=readFileSync(base+'cuoshi-login-prune.timer','utf8')
const must=['Type=oneshot','User=cuoshi-maint','Group=cuoshi-maint',
 'EnvironmentFile=/etc/cuoshi/maintenance.env',
 'ExecStart=/usr/bin/node /opt/cuoshi/current/future/server/.private-build/future/server/src/privateMaintenance.js',
 'TimeoutStartSec=60s','NoNewPrivileges=yes','ProtectSystem=strict','UMask=0077',
 'CapabilityBoundingSet=','AmbientCapabilities=']
for(const x of must)check(unit.includes(x),'Restricted maintenance service: '+x)
check(!unit.includes('CUOSHI_PG_BACKUP_URL')&&!unit.includes('APP_SECRET')&&
 !unit.includes('cloud.env')&&!unit.includes('ExecStart=/bin/sh'),
 'Scheduler never reuses application secrets or invokes shell commands')
for(const x of ['OnCalendar=hourly','Persistent=true',
 'Unit=cuoshi-login-prune.service','WantedBy=timers.target'])
 check(timer.includes(x),'Hourly durable-expiry timer: '+x)
check(!timer.includes('OnBootSec=')&&!unit.includes('Restart=always'),
 'No busy loop during database outage; retries on next scheduled hourly trigger')
console.log('PASS',count,'restricted maintenance task, hourly scheduler and fail-closed safeguards')
