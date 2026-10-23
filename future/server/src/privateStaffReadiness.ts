/** Validate minimal read roles before ever binding the employee listener. */
import {privateDatabaseSchema} from './privateConfig'
export type StaffReadinessPool={query(sql:string):Promise<{rows:Record<string,unknown>[]}>}
export async function checkPrivateStaffReadiness(
 staff:StaffReadinessPool,reporting:StaffReadinessPool,schemaName:string
){
 const schema=privateDatabaseSchema(schemaName)
 if(!staff?.query||!reporting?.query)throw Error('private_staff_pools_missing')
 const names:string[]=[]
 for(const db of [staff,reporting]){
   const result=await db.query(`SELECT current_user AS name,rolsuper,rolcreatedb,
     rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`)
   const r=result.rows[0]
   if(typeof r?.name!=='string'||r.rolsuper!==false||r.rolcreatedb!==false||
     r.rolcreaterole!==false||r.rolreplication!==false||r.rolbypassrls!==false)
      throw Error('private_staff_role_unsafe')
   names.push(r.name)
   const scope=await db.query(`SELECT current_schema() AS schema_name,
     to_regclass('cloud_users') AS users,
     has_table_privilege(current_user,'cloud_users','SELECT') AS direct_users,
     has_table_privilege(current_user,'cloud_snapshots','SELECT') AS direct_records`)
   const row=scope.rows[0]
   if(row?.schema_name!==schema||!row.users)
     throw Error('private_staff_schema_missing')
   if(row.direct_users!==false||row.direct_records!==false)
     throw Error('private_staff_direct_private_access_forbidden')
 }
 if(names[0]===names[1])throw Error('private_staff_roles_not_separated')
 const staffPerm=await staff.query(`SELECT
   has_function_privilege(current_user,
     'cloud_read_day(text,boolean,text,text,text)','EXECUTE') AS day_read,
   has_function_privilege(current_user,
     'cloud_reporting_overview(text,boolean)','EXECUTE') AS report_read`)
 const reportPerm=await reporting.query(`SELECT
   has_function_privilege(current_user,
     'cloud_read_day(text,boolean,text,text,text)','EXECUTE') AS day_read,
   has_function_privilege(current_user,
     'cloud_reporting_overview(text,boolean)','EXECUTE') AS report_read`)
 if(staffPerm.rows[0]?.day_read!==true||staffPerm.rows[0]?.report_read!==false||
    reportPerm.rows[0]?.day_read!==false||reportPerm.rows[0]?.report_read!==true)
    throw Error('private_staff_function_privileges_unsafe')
}
