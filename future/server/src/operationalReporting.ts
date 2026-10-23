/**
 * Production-pattern, anonymous aggregate read (not yet deployed).
 * Requires the separate restricted reporting role. Never accepts owner IDs,
 * returns notes, raw event data, or invents a sync-success percentage.
 */
import type {DbPool} from './repository'
export type OperationalOverview={
  totalAccounts:number
  cloudEnabledAccounts:number
  storedSnapshots:number
  snapshotsUpdatedLast7d:number
  accountsCreatedLast7d:number
}
const count=(value:unknown):number=>{
  const parsed=typeof value==='string'?Number(value):value
  if(typeof parsed!=='number'||!Number.isSafeInteger(parsed)||parsed<0)
    throw Error('invalid_operational_overview')
  return parsed
}
export async function readAnonymousOperationalOverview(pool:DbPool,staffId:string,mfaVerified:boolean):Promise<OperationalOverview>{
  if(!pool||typeof pool.connect!=='function')throw Error('reporting_pool_required')
  const client=await pool.connect()
  try{
    const result=await client.query(`SELECT total_accounts,cloud_enabled_accounts,
      stored_snapshots,snapshots_updated_7d,accounts_created_7d
      FROM cloud_reporting_overview($1,$2)`,[staffId,mfaVerified])
    if(result.rows.length===0)throw Error('operational_reporting_access_denied')
    if(result.rows.length!==1)throw Error('invalid_operational_overview')
    const row=result.rows[0]
    return {
      totalAccounts:count(row.total_accounts),
      cloudEnabledAccounts:count(row.cloud_enabled_accounts),
      storedSnapshots:count(row.stored_snapshots),
      snapshotsUpdatedLast7d:count(row.snapshots_updated_7d),
      accountsCreatedLast7d:count(row.accounts_created_7d)
    }
  }finally{client.release()}
}
