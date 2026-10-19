import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const base='future/server/deploy/systemd/'
const unit=readFileSync(base+'cuoshi-login-prune.service','utf8')
const timer=readFileSync(base+'cuoshi-login-prune.timer','utf8')
const worker=readFileSync('future/server/src/privateMaintenance.ts','utf8')
let n=0
const check=(v,m)=>{assert.ok(v,m);n++}
for(const x of ['User=cuoshi-maint','Type=oneshot',
 'EnvironmentFile=/etc/cuoshi/maintenance.env','ProtectSystem=strict',
 'NoNewPrivileges=yes','ExecStart=/usr/bin/node /opt/cuoshi/current/future/server/.private-build/future/server/src/privateMaintenance.js'])
 check(unit.includes(x),'Restricted unit: '+x)
for(const x of ['OnCalendar=hourly','Persistent=true','Unit=cuoshi-login-prune.service'])
 check(timer.includes(x),'Hourly timer: '+x)
check(!unit.includes('cloud.env')&&!unit.includes('APP_SECRET'),
 'No app/provider credentials in maintenance unit')
check(worker.includes('SELECT cloud_prune_wechat_login_windows() AS removed')&&
 !worker.includes('SELECT * FROM cloud_snapshots'),
 'Worker only invokes bounded cleanup SQL')
console.log('PASS',n,'static isolated expiry job and production schedule')
