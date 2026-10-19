/** Production one-shot privacy maintenance, never an HTTP listener.
 * Only the restricted PostgreSQL maintenance role can run the bounded SQL
 * function installed by migration 007. No backup, user or audit data reads.
 */
import {createRequire} from 'node:module'
import {databaseUrl,privateDatabaseSchema,privatePoolConnectionOptions} from './privateConfig'

type PoolLike={query(sql:string):Promise<{rows:Record<string,any>[]}>,end():Promise<void>}
export function parsePrivateMaintenanceConfig(env:Record<string,string|undefined>){
 if(env?.CUOSHI_MAINTENANCE_ACK!=='PRUNE_LOGIN_WINDOWS_ONLY')
   throw Error('private_cloud_maintenance_ack_required')
 const schema=privateDatabaseSchema(env.CUOSHI_PG_SCHEMA)
 const {value}=databaseUrl(env,'CUOSHI_PG_MAINTENANCE_URL')
 return {schema,url:value}
}
export async function prunePrivateLoginWindows(pool:PoolLike,schema:string):Promise<number>{
 const expected=privateDatabaseSchema(schema)
 const role=await pool.query(`SELECT current_user AS role,rolsuper,rolcreatedb,
   rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`)
 const r=role.rows[0]
 if(!r||typeof r.role!=='string'||r.rolsuper!==false||r.rolcreatedb!==false||
    r.rolcreaterole!==false||r.rolreplication!==false||r.rolbypassrls!==false)
   throw Error('private_cloud_maintenance_role_unsafe')
 const cap=await pool.query(`SELECT current_schema() AS active_schema,
    to_regclass('cloud_wechat_login_rate_windows') AS subject,
    has_function_privilege(current_user,'cloud_prune_wechat_login_windows()','EXECUTE') AS can_prune,
    has_table_privilege(current_user,'cloud_wechat_login_rate_windows','SELECT') AS can_read,
    has_table_privilege(current_user,'cloud_wechat_login_rate_windows','DELETE') AS can_delete`)
 const flags=cap.rows[0]
 if(!flags||flags.active_schema!==expected||!flags.subject||
    flags.can_prune!==true||flags.can_read!==false||flags.can_delete!==false)
   throw Error('private_cloud_maintenance_scope_unsafe')
 const result=await pool.query('SELECT cloud_prune_wechat_login_windows() AS removed')
 const removed=result.rows[0]?.removed
 if(!Number.isSafeInteger(removed)||removed<0)
   throw Error('private_cloud_maintenance_result_invalid')
 return removed
}

async function main(){
 const config=parsePrivateMaintenanceConfig(process.env)
 const localRequire=createRequire(__filename)
 const {Pool}=localRequire('pg') as {Pool:new(opts:Record<string,unknown>)=>PoolLike}
 const pool=new Pool(privatePoolConnectionOptions(config.url,config.schema,1))
 try{
   const removed=await prunePrivateLoginWindows(pool,config.schema)
   process.stdout.write('Cuoshi private login window prune completed; rows='+removed+'\n')
 }finally{await pool.end()}
}
if(require.main===module){
 void main().catch(error=>{
   const message=error instanceof Error?error.message:''
   const safe=/^private_cloud_[a-z_]+(?::CUOSHI_[A-Z_]+)?$/.test(message)?
     message:'private_cloud_maintenance_failed'
   process.stderr.write(safe+'\n');process.exitCode=1
 })
}
