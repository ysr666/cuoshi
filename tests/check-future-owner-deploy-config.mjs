/** Template coverage without actual owner identity, PostgreSQL or secrets. */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const root='future/server/deploy/'
const example=readFileSync(root+'staff.env.example','utf8')
const settings=readFileSync('future/server/src/privateStaffConfig.ts','utf8')
const proxy=readFileSync(root+'prepare-proxy-env.mjs','utf8')
const map=new Map()
for(const line of example.split('\n')){
 if(!line.trim()||line.startsWith('#'))continue
 const pos=line.indexOf('=');assert.ok(pos>0,'Every variable is key=value')
 const name=line.slice(0,pos),value=line.slice(pos+1)
 assert.match(name,/^CUOSHI_[A-Z0-9_]+$/)
 assert.ok(!map.has(name),'No duplicated runtime variable: '+name)
 map.set(name,value)
}
const required=[
 'CUOSHI_STAFF_EDGE_ACK','CUOSHI_PRIVATE_PORT','CUOSHI_STAFF_PORT',
 'CUOSHI_PG_SCHEMA','CUOSHI_PG_STAFF_URL','CUOSHI_PG_REPORTING_URL',
 'CUOSHI_OWNER_ADMIN_ID','CUOSHI_OWNER_PASSWORD_SCRYPT',
 'CUOSHI_OWNER_TOTP_SECRET','CUOSHI_OWNER_LOGIN_PEER_KEY_HEX',
 'CUOSHI_STAFF_SIGNING_KEY_HEX','CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX'
]
assert.deepEqual([...map.keys()].sort(),required.sort(),'Owner service template exactly matches runtime inputs')
assert.equal(map.get('CUOSHI_STAFF_EDGE_ACK'),'ISOLATED_STAFF_LOOPBACK_ONLY')
assert.notEqual(map.get('CUOSHI_STAFF_PORT'),map.get('CUOSHI_PRIVATE_PORT'))
for(const name of required){
 assert.ok(settings.includes(name)||name==='CUOSHI_PRIVATE_PORT',
   'Template variable is consumed by owner server: '+name)
 assert.ok(!map.get(name)?.includes('SECRET_ACTUAL_VALUE'),
   'Template has no production secret')
}
for(const name of ['CUOSHI_OWNER_ADMIN_ID','CUOSHI_OWNER_PASSWORD_SCRYPT',
 'CUOSHI_OWNER_TOTP_SECRET','CUOSHI_OWNER_LOGIN_PEER_KEY_HEX',
 'CUOSHI_STAFF_SIGNING_KEY_HEX','CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX'])
 assert.match(map.get(name),/^REPLACE_/,'Sensitive value MUST be an invalid placeholder')
assert.ok(proxy.includes('CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX')&&
 proxy.includes('CUOSHI_ADMIN_GATE_PORT')&&proxy.includes('CUOSHI_STAFF_PORT'),
 'Caddy operator proof and standalone gate are provisioned distinctly')
assert.ok(example.includes('NOT human employees')&&example.includes('sole owner'),
 'No unreviewed staff/approval account setup instructions')
console.log('PASS '+required.length+' owner production config values mapped with placeholder-only secret policy')
