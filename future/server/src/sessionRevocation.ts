/** Future server-only bearer-token revocation.
 * No raw token, login code, openid or private record is persisted here.
 * A real deployment must monitor DB availability and fail closed.
 */
import {createHash} from 'node:crypto'
import type {DbPool} from './repository'
import type {SessionClaims} from './sessionTokens'
const table={
  'cuoshi-cloud-backup':'cloud_revoked_backup_tokens',
  'cuoshi-staff-admin':'cloud_revoked_staff_tokens'
} as const
function digestJti(jti:string){
  return createHash('sha256').update(jti,'utf8').digest('hex')
}
export async function ensureSessionNotRevoked(pool:DbPool,claims:SessionClaims){
  const c=await pool.connect()
  try{
    const tableName=table[claims.aud]
    if(!tableName)throw Error('unauthorized')
    const result=await c.query(
      `SELECT 1 FROM ${tableName} WHERE subject_id=$1 AND token_digest=$2`,
      [claims.sub,digestJti(claims.jti)]
    )
    if(result.rows.length)throw Error('session_revoked')
  }finally{c.release()}
}
export async function revokeVerifiedSession(pool:DbPool,claims:SessionClaims){
  const c=await pool.connect()
  try{
    const tableName=table[claims.aud]
    if(!tableName)throw Error('unauthorized')
    await c.query(
      `INSERT INTO ${tableName}(subject_id,token_digest,expires_at)
       VALUES($1,$2,to_timestamp($3))
       ON CONFLICT (subject_id,token_digest) DO NOTHING`,
      [claims.sub,digestJti(claims.jti),claims.exp]
    )
  }finally{c.release()}
}
