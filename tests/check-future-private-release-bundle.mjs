/** Real tarball inspection and fail-closed boot from a clean deployment tree.
 * No production config, network, credentials, database or systemd involved.
 */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,realpathSync,rmSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join,dirname,sep} from 'node:path'
import {createRequire} from 'node:module'
import {packagePrivateRelease} from '../future/server/deploy/package-private-release.mjs'
let count=0
const check=(v,message)=>{assert.ok(v,message);count++}
const tmp=mkdtempSync(join(tmpdir(),'cuoshi-release-test-'))
try{
 const target=join(tmp,'private-output')
 mkdirSync(target,{mode:0o700})
 assert.throws(()=>packagePrivateRelease('relative'),/absolute_output_required/);count++
 assert.throws(()=>packagePrivateRelease(resolve('future/server')),/inside_repository_forbidden/);count++
 const result=packagePrivateRelease(target)
 check(result.archive===join(realpathSync(target),'cuoshi-private-deploy.tar.gz')&&result.files>30,
   'Produces one complete, curated deploy archive outside repo')
 check(/^[a-f0-9]{64}$/.test(result.sha256)&&
   createHash('sha256').update(readFileSync(result.archive)).digest('hex')===result.sha256,
   'Generated deployment checksum matches real compressed archive')
 check((statSync(result.archive).mode&0o777)===0o600,
   'Archive is private 0600 even if operator has a permissive default umask')
 assert.throws(()=>packagePrivateRelease(target),/output_exists/);count++
 const root=join(tmp,'extracted');mkdirSync(root,{mode:0o700})
 execFileSync('tar',['-xzf',result.archive,'-C',root])
 const entries=execFileSync('tar',['-tzf',result.archive],{encoding:'utf8'}).trim().split('\n')
 check(entries.length>=result.files+2,'Tar includes only allowlisted files plus manifest and release notes')
 for(const path of entries){
   check(!path.startsWith('/')&&!path.split('/').includes('..')&&
     !/(^|\/)(?:\.env|node_modules|\.git)(\/|$)/.test(path),
     'No dangerous absolute, traversal, secrets or vendor directory in archive')
 }
 const manifest=readFileSync(join(root,'SHA256SUMS'),'utf8').trim().split('\n')
 check(manifest.length===result.files,'SHA256SUMS lists every shipped source file exactly once')
 const seen=new Set()
 for(const line of manifest){
   const match=/^([a-f0-9]{64})  ([^\n]+)$/.exec(line)
   check(match,'Digest manifest row has safe SHA-256 format')
   const path=match[2]
   check(!seen.has(path),'No duplicate package entry '+path);seen.add(path)
   check(createHash('sha256').update(readFileSync(join(root,path))).digest('hex')===match[1],
     'Verified actual extracted bytes match manifest: '+path)
 }
 const required=[
 'future/server/.private-build/future/server/src/privateMain.js',
 'future/server/.private-build/future/server/src/privateStaffMain.js',
 'future/server/.private-build/future/server/src/privateMaintenance.js',
 'future/server/package.json','future/server/package-lock.json',
 'future/server/sql/008_owner_admin_login.sql',
 'future/admin/live/index.html','future/admin/live/app.js',
 'future/admin/live/style.css','future/admin/public/styles.css',
 'future/server/deploy/systemd/cuoshi-cloud.service',
 'future/server/deploy/Caddyfile'
 ]
 for(const path of required)check(seen.has(path),'All essential deployment paths included: '+path)
 for(const blocked of ['future/server/node_modules','future/server/.env',
     'src/pages/today/index.vue','future/.generated-mp/dist/build/mp-weixin/app.js'])
   check(!seen.has(blocked),'Source/staging secrets or client code excluded: '+blocked)
 const revision=readFileSync(join(root,'RELEASE.txt'),'utf8')
 check(revision.includes(result.commit)&&revision.includes('NOT AN INSTALLED DEPLOYMENT')&&
   revision.includes('Production secrets: NEVER BUNDLED'),
   'Immutable release revision and never-deployed status printed')
 const privateEntry=join(root,required[0])
 const ownerEntry=join(root,required[1])
 for(const entry of [privateEntry,ownerEntry]){
  const r=spawnSync(process.execPath,[entry],{
    cwd:root,env:{PATH:process.env.PATH||''},encoding:'utf8',timeout:6000})
  check(r.status===1&&r.stdout.length===0&&
    (r.stderr.includes('private_cloud_explicit_ack_required')||
     r.stderr.includes('private_staff_startup_blocked')),
    'Extracted production executable refuses startup without secure env')
 }
 const compiledRequire=createRequire(ownerEntry)
 const assets=compiledRequire('./staffHttpHost.js').createStaffConsoleAssets(join(root,'future/admin/live'))
 check(assets.size===4&&assets.get('/admin/')?.content.includes('html')&&
   assets.get('/admin/base.css')?.content.length>100,
   'Detached owner console assets load from the packaged directory')
 check(!readdirSync(root).some(x=>x==='node_modules'||x==='.env'),
   'No root dependency modules, secret files or foreign artifact')
 console.log('PASS '+count+' reviewed tarball, file digests, permissions, detached startup and owner console checks')
}finally{rmSync(tmp,{recursive:true,force:true})}
