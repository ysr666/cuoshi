import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const base='future/server/deploy/systemd/'
const cloud=readFileSync(base+'cuoshi-cloud.service','utf8')
const caddy=readFileSync(base+'caddy.service.d/cuoshi.conf','utf8')
let count=0
const check=(value,msg)=>{assert.ok(value,msg);count++}
for(const item of ['[Service]','User=cuoshi','Group=cuoshi',
 'EnvironmentFile=/etc/cuoshi/cloud.env',
 'ExecStart=/usr/bin/node /opt/cuoshi/current/future/server/.private-build/future/server/src/privateMain.js',
 'Restart=on-failure','UMask=0077','NoNewPrivileges=yes',
 'ProtectSystem=strict','ProtectHome=yes','PrivateDevices=yes',
 'PrivateTmp=yes','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
 'CapabilityBoundingSet=','AmbientCapabilities=','TimeoutStopSec=30s'])
 check(cloud.includes(item),'Private backend systemd contract: '+item)
check(!/^User=root$/m.test(cloud)&&!/^ExecStart=.*sh -c/m.test(cloud),
 'Cloud service never runs root and never executes shell snippets')
check(!cloud.includes('APP_SECRET=')&&!cloud.includes('PG_BACKUP_URL=')&&
 !cloud.includes('EDGE_SHARED_SECRET_HEX='),
 'Template never embeds literal credentials or privately configured URLs')
check(!cloud.includes('ExecStart=/usr/bin/npm')&&
 !cloud.includes('ExecStart=+'),
 'Startup invokes only the compiled private Node entry without npm install')
check(caddy.includes('EnvironmentFile=/etc/cuoshi/caddy.env'),
 'Caddy reads its separately restricted DERIVED edge proof')
check(!caddy.includes('EDGE_SHARED_SECRET_HEX')&&
 !caddy.includes('User=root'),
 'Caddy drop-in never acquires raw Node root secret or elevated user')
check(!caddy.includes('ExecStart=')&&!caddy.includes('ExecReload='),
 'Caddy package vendor service binary and rights remain untouched')
console.log('PASS',count,'Linux service isolation and least-privilege startup templates (static)')
