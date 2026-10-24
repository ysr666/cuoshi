/** Curated, secret-free release payload for later AUTHORIZED Linux deployment.
 * Does not touch production, execute migrations, install services or listen.
 */
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,lstatSync,writeFileSync,chmodSync} from 'node:fs'
import {resolve,join,relative,dirname,sep} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
const root=realpathSync(resolve(fileURLToPath(new URL('../../../',import.meta.url))))
const allowedDeploy=[
 'Caddyfile','README.md','render-migrations.mjs',
 'prepare-owner.mjs','prepare-proxy-env.mjs','check-public-health.mjs',
 'maintenance.env.example','monitor.env.example','staff.env.example',
 'systemd/cuoshi-cloud.service','systemd/cuoshi-staff.service',
 'systemd/cuoshi-login-prune.service','systemd/cuoshi-login-prune.timer',
 'systemd/cuoshi-health.service','systemd/cuoshi-health.timer',
 'systemd/caddy.service.d/cuoshi.conf'
]
const adminAssets=['app.js','index.html','style.css']
const packageInputs=['docs/RELEASE_V05_FIVE_GATES.md',
 'future/server/package.json','future/server/package-lock.json',
 'future/admin/public/styles.css',...adminAssets.map(x=>'future/admin/live/'+x),
 ...allowedDeploy.map(x=>'future/server/deploy/'+x)]
const safeRel=(name)=>!name.startsWith('/')&&!name.split('/').some(x=>x===''||x==='..'||x==='.')
function pathsUnder(base){
 const items=[]
 function walk(dir){for(const item of readdirSync(dir,{withFileTypes:true})){
   const path=join(dir,item.name),rel=relative(root,path).replaceAll('\\','/')
   if(item.isSymbolicLink())throw Error('private_release_symlink_forbidden')
   if(item.isDirectory())walk(path)
   else if(item.isFile())items.push(rel)
   else throw Error('private_release_nonregular_file')
 }}walk(base)
 return items.sort()
}
function content(src){
 if(!safeRel(src))throw Error('private_release_invalid_path')
 const absolute=join(root,src)
 if(!existsSync(absolute)||!lstatSync(absolute).isFile())
   throw Error('private_release_missing_input')
 return readFileSync(absolute)
}
export function packagePrivateRelease(outDir){
 if(typeof outDir!=='string'||!outDir.startsWith('/'))
  throw Error('private_release_absolute_output_required')
 const parent=realpathSync(outDir)
 if(parent===root||parent.startsWith(root+sep))
  throw Error('private_release_inside_repository_forbidden')
 if(!statSync(parent).isDirectory()||
   !((statSync(parent).mode&0o077)===0))
  throw Error('private_release_output_permissions_unsafe')
 const output=join(parent,'cuoshi-private-deploy.tar.gz')
 if(existsSync(output))throw Error('private_release_output_exists')
 const compiled=join(root,'future/server/.private-build')
 if(!existsSync(compiled))throw Error('private_release_not_compiled')
 const compiledFiles=pathsUnder(compiled)
 // Explicitly reject retired employee/private-note HTTP handlers even if an
 // old tsc output survived outside the clean-build process.
 const retired=['adminHttp.js','staffDayService.js']
 if(compiledFiles.some(x=>retired.some(name=>x.endsWith('/'+name))))
  throw Error('private_release_retired_admin_handlers_forbidden')
 if(compiledFiles.length<20||!compiledFiles.includes('future/server/.private-build/future/server/src/privateMain.js')||
   !compiledFiles.includes('future/server/.private-build/future/server/src/privateStaffMain.js')||
   !compiledFiles.includes('future/server/.private-build/future/server/src/privateMaintenance.js')||
   !compiledFiles.includes('future/server/.private-build/package.json')||
   compiledFiles.some(x=>!x.endsWith('.js')&&x!=='future/server/.private-build/package.json'))
  throw Error('private_release_unapproved_compiled_files')
 const sql=pathsUnder(join(root,'future/server/sql'))
 if(sql.length!==8||sql.some((x,i)=>!x.endsWith('.sql')||!x.includes('/00'+(i+1)+'_')))
  throw Error('private_release_sql_migration_count_mismatch')
 const files=[...compiledFiles,...sql,...packageInputs].sort()
 if(new Set(files).size!==files.length)throw Error('private_release_duplicate_file')
 const stage=mkdtempSync(join(tmpdir(),'cuoshi-release-payload-'))
 try{
   const manifest=[]
   for(const path of files){
     const input=content(path)
     // A secret-bearing or nonreviewed file cannot ever be whitelisted.
     if(/(^|\/)(\.env(?:\.|$)|node_modules|\.git)(\/|$)/.test(path)||
        /\.(?:pem|key|map|log|ts)$/.test(path))
       throw Error('private_release_secret_or_source_forbidden')
     const dst=join(stage,path)
     mkdirSync(dirname(dst),{recursive:true,mode:0o700})
     writeFileSync(dst,input,{mode:0o600,flag:'wx'})
     manifest.push(createHash('sha256').update(input).digest('hex')+'  '+path)
   }
   const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
   if(!/^[a-f0-9]{40}$/.test(commit))throw Error('private_release_revision_invalid')
   writeFileSync(join(stage,'SHA256SUMS'),manifest.join('\n')+'\n',{mode:0o600,flag:'wx'})
   writeFileSync(join(stage,'RELEASE.txt'),
    'CUOSHI PRIVATE SERVER — NOT AN INSTALLED DEPLOYMENT\n'+
    'Git commit: '+commit+'\n'+
    'Production secrets: NEVER BUNDLED\n'+
    'Node: >=22; Linux x64/arm64 platform dependencies MUST be installed separately.\n'+
    'Production dependencies: npm ci --prefix future/server --omit=dev --ignore-scripts\n'+
    'Migration SQL: review eight files in future/server/sql; DO NOT AUTO-EXECUTE.\n'+
    'Requires authorized domain, TLS, real WeChat AppID/secret, schema and backup policy.\n'+
    'See future/server/deploy/README.md and docs/RELEASE_V05_FIVE_GATES.md.\n',
    {mode:0o600,flag:'wx'})
   execFileSync('tar',['-czf',output,'-C',stage,'.'],{stdio:'pipe'})
   chmodSync(output,0o600)
   const hash=createHash('sha256').update(readFileSync(output)).digest('hex')
   return {archive:output,sha256:hash,files:files.length,commit}
 }finally{rmSync(stage,{recursive:true,force:true})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
   const result=packagePrivateRelease(process.argv[2])
   console.log('PASS secret-free private release bundle, '+result.files+' reviewed files; sha256 '+result.sha256)
 }catch(e){
   const message=e instanceof Error?e.message:''
   console.error(/^private_release_[a-z_]+$/.test(message)?message:'private_release_failed')
   process.exitCode=1
 }
}
