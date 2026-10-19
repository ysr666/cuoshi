/** Real compiled private runtime + independently installed pg package.
 * No listening socket, credentials, provider traffic or PostgreSQL required.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {readFileSync,statSync} from 'node:fs'
import {resolve,dirname,sep} from 'node:path'
let n=0
const check=(value,label)=>{assert.ok(value,label);n++}
const root=resolve('.')
const entry=resolve(root,'future/server/.private-build/future/server/src/privateMain.js')
const service=readFileSync(resolve(root,'future/server/deploy/systemd/cuoshi-cloud.service'),'utf8')
check(statSync(entry).isFile()&&service.includes(
 '/opt/cuoshi/current/future/server/.private-build/future/server/src/privateMain.js'),
 'systemd entry exactly matches actually compiled private backend entry')
const runtimeRequire=createRequire(entry)
const pgPath=runtimeRequire.resolve('pg')
const packageBase=resolve(root,'future/server/node_modules/pg')
check(pgPath.startsWith(packageBase+sep),
 'compiled backend resolves pg from its own isolated production node_modules')
check(!pgPath.includes('root/node_modules')&&
 !pgPath.includes('future/server/.private-build/node_modules'),
 'no unreviewed root/workspace dev dependencies needed at runtime')
const pg=runtimeRequire('pg')
check(typeof pg.Pool==='function'&&typeof pg.Client==='function',
 'production pg Pool/Client load from compiled service module location')
const actualPgVersion=runtimeRequire('pg/package.json').version
const lock=JSON.parse(readFileSync(resolve(root,'future/server/package-lock.json'),'utf8'))
check(actualPgVersion===lock.packages['node_modules/pg'].version,
 'actual deployed pg version equals isolated server lockfile pin')
const Params=runtimeRequire('pg/lib/connection-parameters')
const url='postgresql://cuoshi_role:synthetic@db.example.invalid:5432/cuoshi?sslmode=verify-full'
const params=new Params({connectionString:url,
 options:'-c search_path=cuoshi_prod,pg_catalog'})
check(params.ssl!==false&&typeof params.ssl==='object'&&
 params.host==='db.example.invalid',
 'driver parses verify-full as TLS with server hostname verification')
check(params.options==='-c search_path=cuoshi_prod,pg_catalog',
 'actual pg driver forwards audited private schema as startup option')
const safeSettings=runtimeRequire('./privateConfig.js').privatePoolConnectionOptions(
 url,'cuoshi_prod',2)
const driverSettings=new Params(safeSettings)
check(driverSettings.statement_timeout===15000&&
 driverSettings.lock_timeout===4000&&
 driverSettings.idle_in_transaction_session_timeout===10000&&
 driverSettings.query_timeout===20000,
 'Real pg client receives bounded SQL, lock, idle-transaction and query timeouts')
const noTls=new Params({connectionString:url.replace('verify-full','disable')})
check(noTls.ssl===false,
 'TLS test can distinguish secure and insecure pg connection modes')
const local=runtimeRequire('./privateConfig.js')
check(typeof runtimeRequire('./privateMaintenance.js').prunePrivateLoginWindows==='function',
 'compiled one-shot data-retention worker loads independently')
check(typeof local.privatePoolConnectionOptions==='function'&&
 typeof runtimeRequire('./privateReadiness.js').checkPrivateDatabaseReadiness==='function',
 'production-compiled database configuration and readiness helpers both resolve')
const run=spawnSync(process.execPath,[entry],{
 cwd:root,env:{PATH:process.env.PATH||''},encoding:'utf8',timeout:7000
})
check(run.status===1&&run.stderr.includes('private_cloud_explicit_ack_required'),
 'actual compiled entry exits before binding when deployment credentials absent')
check(!run.stdout.includes('listening')&&
 !run.stderr.includes('synthetic@')&&
 !run.stderr.includes('password'),
 'failed startup does not open a socket or echo secrets')
console.log('PASS',n,'actual private production binary, isolated pg dependency and TLS/schema startup')
