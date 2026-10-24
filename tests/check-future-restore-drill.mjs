import assert from 'node:assert/strict'
import {validateRestoreDrillArgs} from '../future/server/tests/check-restore-drill.mjs'
let count=0
const check=(v,m)=>{assert.ok(v,m);count++}
const bad=(v,schema,owner,ack)=>{
 assert.throws(()=>validateRestoreDrillArgs(v,schema,owner,ack),/restore_drill_/);count++
}
const source='postgresql://postgres:ci_only_disposable@127.0.0.1:5432/postgres'
const valid=validateRestoreDrillArgs(source,'cuoshi_it_012345abcd',
 'restorefixture0001','SYNTHETIC_POSTGRES_ONLY')
check(valid.hostname==='127.0.0.1'&&valid.pathname==='/postgres',
 'CI-only backup drill accepts explicit localhost disposable target')
for(const candidate of [
 'postgresql://postgres:pass@some-db.example.com/postgres',
 'postgresql://postgres:pass@192.168.1.4/postgres',
 'postgresql://postgres:pass@127.0.0.2/postgres',
 'postgresql://postgres:pass@127.0.0.1:5432/postgres?options=-c%20search_path%3Dpublic',
 'postgresql://postgres:pass@127.0.0.1:5432/postgres#mydb',
 'http://postgres:pass@localhost/postgres',
 'postgresql://postgres@localhost/postgres',
 'postgresql://postgres:pass@localhost/',
 'not-a-database'
])bad(candidate,'cuoshi_it_012345abcd','restorefixture0001','SYNTHETIC_POSTGRES_ONLY')
for(const invalid of ['public','pg_temp;delete','CUOSHI','',
 'foo;DROP DATABASE postgres','a'.repeat(64)])
 bad(source,invalid,'restorefixture0001','SYNTHETIC_POSTGRES_ONLY')
for(const invalidOwner of ['account0001','restorefixture00001','',
 'restorefixture0001;DROP'])
 bad(source,'cuoshi_it_012345abcd',invalidOwner,'SYNTHETIC_POSTGRES_ONLY')
bad(source,'cuoshi_it_012345abcd','restorefixture0001','')
bad(source,'cuoshi_it_012345abcd','restorefixture0001','RUN_ON_PRODUCTION')
console.log('PASS',count,'test-only PostgreSQL dump-and-restore safety gates')
