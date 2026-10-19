/** The exact pre-listener PostgreSQL checks shared by privateMain and real PG CI.
 * No secrets logged, no schema mutations, no listeners, no WeChat exchange.
 */
import type {DbPool} from './repository'
import {privateDatabaseSchema} from './privateConfig'

export type ReadinessPool=DbPool & {query(sql:string):Promise<{rows:Record<string,unknown>[]}>}
export type PrivateRuntimePools={
 identityDb:ReadinessPool
 backupDb:ReadinessPool
 staffDb:ReadinessPool
 cancellationDb:ReadinessPool
}

export async function checkPrivateDatabaseReadiness(
 pools:PrivateRuntimePools,schemaName:string
):Promise<void>{
 const schema=privateDatabaseSchema(schemaName)
 if(!pools?.identityDb||!pools.backupDb||!pools.staffDb||!pools.cancellationDb)
   throw Error('private_cloud_database_connections_required')
 const roles:string[]=[]
 for(const pool of [pools.identityDb,pools.backupDb,pools.staffDb,pools.cancellationDb]){
   const result=await pool.query(`SELECT current_user AS name,rolsuper,rolcreatedb,
     rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`)
   const role=result.rows[0]
   if(!role||typeof role.name!=='string'||role.rolsuper!==false||
      role.rolcreatedb!==false||role.rolcreaterole!==false||
      role.rolreplication!==false||role.rolbypassrls!==false)
     throw Error('private_cloud_database_role_unsafe')
   const ownership=await pool.query(`SELECT EXISTS(
     SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
       AND c.relname IN ('cloud_users','cloud_snapshots','cloud_admin_audit',
         'cloud_wechat_identities','cloud_wechat_login_rate_windows')
   ) AS owns_sensitive_tables`)
   if(ownership.rows[0]?.owns_sensitive_tables!==false)
     throw Error('private_cloud_database_role_unsafe')
   const selected=await pool.query(
     "SELECT current_schema() AS active_schema,to_regclass('cloud_users') AS users")
   if(selected.rows[0]?.active_schema!==schema||!selected.rows[0]?.users)
     throw Error('private_cloud_database_schema_missing')
   roles.push(role.name)
 }
 if(new Set(roles).size!==4)throw Error('private_cloud_database_roles_not_separated')
 const limiter=await pools.identityDb.query(
   "SELECT to_regprocedure('cloud_take_wechat_login_slot(text)') AS configured")
 if(!limiter.rows[0]?.configured)
   throw Error('private_cloud_login_limiter_migration_missing')
 const cancellation=await pools.cancellationDb.query(
   "SELECT to_regprocedure('cloud_cancel_account(text)') AS configured")
 if(!cancellation.rows[0]?.configured)
   throw Error('private_cloud_account_cancellation_migration_missing')
}
