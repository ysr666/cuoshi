/** Pure, offline migration rendering. No PostgreSQL network connections.
 * The resulting files still need a human-reviewed, dedicated migration role.
 */
import {createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs'
import {isAbsolute,resolve,join,sep,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const templates=new URL('../sql/',import.meta.url)
const repo=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
export const ORDER=Object.freeze([
 '001_initial.sql','002_runtime_permissions.sql',
 '003_wechat_identity.sql','004_session_revocation.sql',
 '005_account_cancellation.sql','006_global_session_revocation.sql',
 '007_login_rate_limits.sql','008_owner_admin_login.sql'
])
const keys={
 __SCHEMA__:'CUOSHI_PG_SCHEMA',
 __BACKUP_ROLE__:'CUOSHI_PG_BACKUP_ROLE',
 __ADMIN_ROLE__:'CUOSHI_PG_ADMIN_ROLE',
 __AUTH_ROLE__:'CUOSHI_PG_AUTH_ROLE',
 __DELETION_ROLE__:'CUOSHI_PG_DELETION_ROLE',
 __MAINTENANCE_ROLE__:'CUOSHI_PG_MAINTENANCE_ROLE',
 __REPORTING_ROLE__:'CUOSHI_PG_REPORTING_ROLE'
}
const reserved=new Set(['postgres','postgresql','root','admin','public','pg_catalog','information_schema'])
export function sqlIdentifier(raw){
 if(typeof raw!=='string'||!(/^[a-z][a-z0-9_]{0,62}$/).test(raw)||
  reserved.has(raw)||raw.startsWith('pg_'))
  throw Error('migration_identifier_rejected')
 return '"'+raw+'"'
}
export function validateMigrationConfig(env){
 const values={}
 for(const [token,key] of Object.entries(keys))values[token]=sqlIdentifier(env[key])
 const roleTokens=Object.keys(keys).filter(x=>x!=='__SCHEMA__')
 const roles=roleTokens.map(token=>values[token])
 if(new Set(roles).size!==roles.length||roles.includes(values.__SCHEMA__))
  throw Error('migration_roles_not_distinct')
 return values
}
export function renderMigration(name,values){
 if(!ORDER.includes(name))throw Error('migration_template_unknown')
 let sql=readFileSync(new URL(name,templates),'utf8')
 for(const [token,replacement] of Object.entries(values))sql=sql.replaceAll(token,replacement)
 if(/__[A-Z_]+__/.test(sql))throw Error('migration_placeholder_unresolved')
 // The source templates BEGIN transactions; pin unqualified DDL to the
 // explicitly validated schema, rather than relying on the operator's psql
 // default search_path or accidentally modifying the 'public' schema.
 if(!/^([\s\S]*?\n)BEGIN;\n/.test(sql))throw Error('migration_template_transaction_missing')
 sql=sql.replace('BEGIN;\n',`BEGIN;\nSET LOCAL search_path TO ${values.__SCHEMA__}, pg_catalog;\n`)
 return sql
}
export function renderAllMigrations(env){
 const values=validateMigrationConfig(env)
 return ORDER.map(name=>({name,contents:renderMigration(name,values)}))
}
export function createMigrationBundle(folder,env){
 if(typeof folder!=='string'||!isAbsolute(folder))throw Error('migration_output_must_be_absolute')
 const target=resolve(folder)
 // Never write generated SQL into source-control or via a symlinked parent.
 const parent=realpathSync(dirname(target))
 const actual=resolve(parent,folder.split(sep).at(-1))
 if(actual===repo||actual.startsWith(repo+sep))
  throw Error('migration_output_inside_repository_forbidden')
 const files=renderAllMigrations(env)
 // Exclusive directory creation prevents mixing schema versions, accidental
 // overwrite or following an output-directory symlink.
 mkdirSync(actual,{recursive:false,mode:0o700})
 try{
  const manifest=[]
  for(const file of files){
   writeFileSync(join(actual,file.name),file.contents,{flag:'wx',mode:0o600})
   manifest.push({file:file.name,sha256:createHash('sha256').update(file.contents).digest('hex')})
  }
  writeFileSync(join(actual,'SHA256-MANIFEST.json'),
   JSON.stringify({format:'cuoshi-v05-offline-sql-render-v1',migrations:manifest},null,2)+'\n',
   {flag:'wx',mode:0o600})
 }catch(error){rmSync(actual,{recursive:true,force:true});throw error}
 return {directory:actual,count:files.length}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=createMigrationBundle(process.argv[2],process.env)
  process.stdout.write('PASS '+result.count+' SQL migrations generated offline in restricted directory; inspect before privileged execution\n')
 }catch(error){
  // Output only controlled error codes; never echo SQL, DSNs, identifiers or secrets.
  const message=error instanceof Error?error.message:''
  process.stderr.write(/^migration_[a-z_]+$/.test(message)?message:'migration_render_failed')
  process.stderr.write('\n');process.exitCode=1
 }
}
