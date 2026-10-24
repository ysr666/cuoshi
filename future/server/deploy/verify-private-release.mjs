/** Run BEFORE installing production dependencies in an extracted, reviewed
 * release tarball. Offline integrity/allowlist check; not a signature or
 * proof of cloud authorization. Never reads actual production secrets.
 */
import {createHash} from 'node:crypto'
import {readdirSync, readFileSync, lstatSync, realpathSync} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const defaultRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
const mandatory=[
  'future/server/deploy/verify-private-release.mjs',
  'future/server/.private-build/future/server/src/privateMain.js',
  'future/server/.private-build/future/server/src/privateStaffMain.js',
  'future/server/.private-build/future/server/src/privateMaintenance.js',
  'future/server/package.json',
  'future/server/package-lock.json',
  'future/server/sql/008_owner_admin_login.sql',
  'future/server/deploy/Caddyfile',
  'future/server/deploy/systemd/cuoshi-cloud.service',
  'future/server/deploy/staff.env.example',
  'future/admin/live/index.html'
]
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex')
const fail=(code)=>{throw Error('cuoshi_release_'+code)}
const safePath=(s)=>typeof s==='string'&&s.length>0&&!s.startsWith('/')&&
  s.split('/').every(x=>x!==''&&x!=='.'&&x!=='..')&&
  !s.includes('\\')&&!s.includes('\0')&&!s.includes('\r')
function walk(root,at=root){
  const result=[]
  for(const item of readdirSync(at,{withFileTypes:true})){
    const abs=join(at,item.name)
    if(item.isSymbolicLink())fail('symlink_forbidden')
    if(item.isDirectory())result.push(...walk(root,abs))
    else if(item.isFile())result.push(relative(root,abs).split(sep).join('/'))
    else fail('nonregular_file')
  }
  return result
}
function readStrict(root,rel){
  if(!safePath(rel))fail('invalid_path')
  const abs=join(root,...rel.split('/'))
  if(!lstatSync(abs).isFile())fail('not_regular_file')
  return readFileSync(abs)
}
export function verifyPrivateRelease(extractedRoot=defaultRoot){
  if(typeof extractedRoot!=='string'||!extractedRoot.startsWith('/'))fail('root_absolute_required')
  const root=realpathSync(extractedRoot)
  if(!lstatSync(root).isDirectory())fail('root_not_directory')
  const shipped=walk(root)
  const actual=new Set(shipped)
  if(actual.size!==shipped.length)fail('duplicate_file')
  const manifest=readStrict(root,'SHA256SUMS').toString('utf8')
  if(!manifest.endsWith('\n'))fail('manifest_format')
  const expected=new Map()
  for(const line of manifest.trimEnd().split('\n')){
    const row=/^([a-f0-9]{64})  ([^\n]+)$/.exec(line)
    if(!row||!safePath(row[2])||expected.has(row[2]))fail('manifest_format')
    const path=row[2]
    if(/(^|\/)(?:\.env(?:\.|$)|node_modules|\.git)(\/|$)/.test(path)||
       /\.(?:pem|key|map|log|ts)$/.test(path)||
       path.endsWith('/src/adminHttp.js')||path.endsWith('/src/staffDayService.js'))
      fail('private_source_forbidden')
    expected.set(path,row[1])
  }
  if(expected.size<30)fail('manifest_incomplete')
  const listed=new Set([...expected.keys(),'SHA256SUMS','RELEASE.txt'])
  if(shipped.length!==listed.size||[...actual].some(x=>!listed.has(x))||
    [...listed].some(x=>!actual.has(x)))fail('unlisted_or_missing_file')
  for(const name of mandatory)if(!expected.has(name))fail('required_file_missing')
  if([...expected].filter(([k])=>/^future\/server\/sql\/00[1-8]_[^/]+\.sql$/.test(k)).length!==8)
    fail('migrations_incomplete')
  for(const [name,hash] of expected){
    if(sha(readStrict(root,name))!==hash)fail('digest_mismatch')
  }
  const note=readStrict(root,'RELEASE.txt').toString('utf8')
  const commit=/^Git commit: ([0-9a-f]{40})$/m.exec(note)?.[1]
  if(!commit||!note.includes('NOT AN INSTALLED DEPLOYMENT')||
    !note.includes('Production secrets: NEVER BUNDLED'))
    fail('release_metadata_missing')
  // This digest is for operator comparison to a trusted CI artifact. A
  // locally rewritten SHA256SUMS is NOT an authenticated signature.
  return {commit,files:expected.size,manifestSha256:sha(Buffer.from(manifest))}
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==2)fail('unexpected_arguments')
    const result=verifyPrivateRelease()
    console.log('PASS cuoshi_release_integrity files='+result.files+
      ' commit='+result.commit+' manifest_sha256='+result.manifestSha256)
  }catch(err){
    const code=err instanceof Error&&/^cuoshi_release_[a-z_]+$/.test(err.message)?
      err.message:'cuoshi_release_validation_failed'
    console.error(code)
    process.exitCode=1
  }
}
