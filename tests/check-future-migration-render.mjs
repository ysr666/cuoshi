import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,statSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {
 ORDER,validateMigrationConfig,sqlIdentifier,renderAllMigrations,
 createMigrationBundle,renderMigration
} from '../future/server/deploy/render-migrations.mjs'
let n=0
const check=(v,why)=>{assert.ok(v,why);n++}
const bad=(f,re,why)=>{assert.throws(f,re,why);n++}
const env={CUOSHI_PG_SCHEMA:'cuoshi_prod',
 CUOSHI_PG_BACKUP_ROLE:'cs_backup',CUOSHI_PG_ADMIN_ROLE:'cs_staff',
 CUOSHI_PG_AUTH_ROLE:'cs_login',CUOSHI_PG_DELETION_ROLE:'cs_deletion',
 CUOSHI_PG_MAINTENANCE_ROLE:'cs_maintenance',
 CUOSHI_PG_REPORTING_ROLE:'cs_reporting'}
check(sqlIdentifier('cuoshi_prod')==='"cuoshi_prod"','Identifiers are quoted SQL identifiers')
for(const unsafe of ['','__SCHEMA__','foo;DROP TABLE cloud_users','pg_danger',
 'public','postgres','root','user-name','user name','user"evil','汉字',
 '9name','a'.repeat(64)])
 bad(()=>sqlIdentifier(unsafe),/migration_identifier_rejected/,
  'Reject malicious or unsupported schema/role SQL identifier: '+unsafe)
bad(()=>validateMigrationConfig({...env,CUOSHI_PG_DELETION_ROLE:'cs_backup'}),
 /migration_roles_not_distinct/,'Deletion role never shares backup role')
bad(()=>validateMigrationConfig({...env,CUOSHI_PG_SCHEMA:'cs_staff'}),
 /migration_roles_not_distinct/,'Runtime role cannot double as schema name')
bad(()=>validateMigrationConfig({...env,CUOSHI_PG_AUTH_ROLE:undefined}),
 /migration_identifier_rejected/,'Missing identity role cannot be inferred')
const files=renderAllMigrations(env)
check(files.length===7&&files.every((x,i)=>x.name===ORDER[i]),
 'All seven migrations remain in documented, unskippable sequence')
for(const file of files){
 check(file.contents.includes('SET LOCAL search_path TO "cuoshi_prod", pg_catalog;'),
  'Each transaction pins safe explicit SQL schema: '+file.name)
 check(!/__[A-Z_]+__/.test(file.contents),
  'No unresolved template placeholders: '+file.name)
 check(file.contents.includes('BEGIN;')&&file.contents.includes('COMMIT;'),
  'Each generated SQL migration is transactional: '+file.name)
}
check(files[0].contents.includes('CREATE TABLE cloud_users'),
 'Initial unqualified tables bind to pinned target schema')
check(files[1].contents.includes('TO "cs_staff"')&&
 files[4].contents.includes('TO "cs_deletion"')&&
 files[6].contents.includes('TO "cs_login"'),
 'Privilege grants use exact separated role identifiers')
bad(()=>renderMigration('test_bad.sql',validateMigrationConfig(env)),
 /migration_template_unknown/,'No custom external SQL templates accepted')
const scratch=mkdtempSync(join(tmpdir(),'cuoshi-sql-render-'))
try{
 const folder=join(scratch,'generated')
 bad(()=>createMigrationBundle('relative-folder',env),
  /migration_output_must_be_absolute/,'No relative SQL artifact in project')
 bad(()=>createMigrationBundle(resolve('future/server/deploy/generated-migrations'),env),
  /migration_output_inside_repository_forbidden/,
  'Generated SQL never placed inside Git workspace')
 const created=createMigrationBundle(folder,env)
 check(created.count===7&&realpathSync(created.directory)===realpathSync(folder),'One unprivileged offline render complete')
 check((statSync(folder).mode&0o777)===0o700,
  'Sensitive migration bundle directory accessible only to owner')
 const manifest=JSON.parse(readFileSync(join(folder,'SHA256-MANIFEST.json'),'utf8'))
 check(manifest.migrations.length===7&&manifest.format==='cuoshi-v05-offline-sql-render-v1',
  'Fixed migration order and format saved to manifest')
 for(const file of manifest.migrations){
  const path=join(folder,file.file)
  check((statSync(path).mode&0o777)===0o600,
   'Generated SQL is readable only by owner: '+file.file)
  check(createHash('sha256').update(readFileSync(path)).digest('hex')===file.sha256,
   'Checksum matches exact generated SQL: '+file.file)
 }
 bad(()=>createMigrationBundle(folder,env),/EEXIST/,
  'Existing migration bundle cannot be overwritten')
}finally{rmSync(scratch,{recursive:true,force:true})}
console.log('PASS',n,'offline seven-step SQL render, privilege and injection guards')
