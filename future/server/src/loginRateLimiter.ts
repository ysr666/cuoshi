/** Durable WeChat login limiter for the future server; NO public listener. */
import {createHmac} from 'node:crypto'
import {isIP} from 'node:net'
import type {IncomingMessage} from 'node:http'
import type {DbPool} from './repository'

/**
 * The app/identity DB role can only EXECUTE an atomic SECURITY DEFINER
 * PostgreSQL function. The DB, not the Node worker, owns the fixed limits:
 * 12 calls per remote socket IP and 200 globally, per fixed minute.
 *
 * Never read X-Forwarded-For, X-Real-IP or other untrusted HTTP headers.
 * The optional verifiedPeer must come from a separately authenticated,
 * loopback-bound edge; no raw proxy header should ever be passed to it.
 * Without one, remoteAddress represents the proxy (conservative shared quota).
 */
export function createPostgresWechatLoginLimiter(args:{
  db:DbPool
  peerHmacKey:Uint8Array
  /** Optional authenticated edge-supplied address; null denies login. */
  verifiedPeer?:(req:IncomingMessage)=>string|null
}){
  if(typeof args?.db?.connect!=='function'||
     !(args.peerHmacKey instanceof Uint8Array)||args.peerHmacKey.byteLength<32||
     (args.verifiedPeer!==undefined&&typeof args.verifiedPeer!=='function'))
    throw Error('wechat_login_limiter_not_configured')
  const key=Uint8Array.from(args.peerHmacKey)
  return async (req:IncomingMessage):Promise<boolean>=>{
    const peer=args.verifiedPeer?args.verifiedPeer(req):req?.socket?.remoteAddress
    if(typeof peer!=='string'||!isIP(peer))return false
    const digest=createHmac('sha256',key)
      .update('cuoshi-v05-login-peer-v1:').update(peer.toLowerCase()).digest('hex')
    // DB failure MUST propagate to the HTTP handler (generic 503). Never
    // silently switch to an unshared in-memory allow-all fallback.
    const db=await args.db.connect()
    try{
      const result=await db.query(
        'SELECT cloud_take_wechat_login_slot($1) AS allowed',[digest])
      return result.rows.length===1&&result.rows[0].allowed===true
    }finally{db.release()}
  }
}
