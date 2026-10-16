/**
 * Isolated FUTURE backend account cancellation.
 * Requires verified, unrevoked user's signed session at the calling layer
 * and a distinct restricted cancellation DB role. Not a public route.
 */
import type {DbPool,VerifiedUserSession} from './repository'
const validId=(x:unknown)=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(x)

export const ACCOUNT_DELETE_CONFIRMATION='注销账号并清除云端记录'

export type AccountCancellationResult={
  deleted:true
  privateBackupErased:boolean
  redactedAuditRows:number
  retainedBackendData:'anonymous_daily_totals_and_redacted_security_audits'
}

/** Immediate DB erasure. Backups held by infrastructure require separate lifecycle controls. */
export async function cancelVerifiedAccount(
  pool:DbPool,session:VerifiedUserSession,typedConfirmation:string
):Promise<AccountCancellationResult>{
  if(!session||!validId(session.userId)||!validId(session.deviceId))
    throw Error('unauthorized')
  if(typedConfirmation!==ACCOUNT_DELETE_CONFIRMATION)
    throw Error('account_deletion_confirmation_required')
  const db=await pool.connect()
  try{
    // SQL function runs one atomic statement: tombstone account, erase private
    // cloud data and identity mapping, redact audits, aggregate retained totals.
    const output=await db.query(
      'SELECT deleted,redacted_audits,had_snapshot FROM cloud_cancel_account($1)',
      [session.userId]
    )
    const row=output.rows[0]
    if(row?.deleted!==true)throw Error('account_deletion_failed')
    return {
      deleted:true,privateBackupErased:row.had_snapshot===true,
      redactedAuditRows:Number(row.redacted_audits)||0,
      retainedBackendData:'anonymous_daily_totals_and_redacted_security_audits'
    }
  }finally{db.release()}
}
