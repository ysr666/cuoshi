/** Backend operations view. Database role has SELECT permission only on anonymous totals. */
import type {DbPool} from './repository'
export type DeletionSummary={month:string;accountsDeleted:number;snapshotsErased:number}
export async function readAnonymousDeletionSummary(pool:DbPool,months=12):Promise<DeletionSummary[]>{
  if(!Number.isInteger(months)||months<1||months>36)throw Error('invalid_reporting_range')
  const db=await pool.connect()
  try{
    const rows=await db.query(`SELECT period,accounts_deleted,snapshots_erased
      FROM cloud_account_deletion_totals
      WHERE period>=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date-
        ($1::integer*interval '1 month')
      ORDER BY period DESC LIMIT $1`,[months])
    return rows.rows.map(row=>({
      month:new Date(row.period).toISOString().slice(0,7),
      accountsDeleted:Number(row.accounts_deleted),
      snapshotsErased:Number(row.snapshots_erased)
    }))
  }finally{db.release()}
}
