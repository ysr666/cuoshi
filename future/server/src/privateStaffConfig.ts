/** Staff service always has a different network port and PG reporting role. */
import {databaseUrl,privateDatabaseSchema} from './privateConfig'
import {validateOwnerLoginSettings} from './ownerAuth'
export type PrivateStaffConfig={
 port:number;dbSchema:string;staffDbUrl:string;reportingDbUrl:string;
 signingKey:Uint8Array;edgeSecret:Uint8Array;soleOwnerId:string;
 ownerPasswordHash:string;ownerTotpSecret:string;ownerPeerHashKey:Uint8Array
}
function hexKey(raw:unknown):Uint8Array{
 if(typeof raw!=='string'||!/^[a-fA-F0-9]{64}$/.test(raw))
   throw Error('private_staff_secret_missing')
 return Uint8Array.from(Buffer.from(raw,'hex'))
}
export function parsePrivateStaffConfig(env:Record<string,string|undefined>):PrivateStaffConfig{
 if(!env||env.CUOSHI_STAFF_EDGE_ACK!=='ISOLATED_STAFF_LOOPBACK_ONLY')
   throw Error('private_staff_explicit_ack_required')
 const raw=env.CUOSHI_STAFF_PORT
 const port=Number(raw)
 if(typeof raw!=='string'||!/^[0-9]{4,5}$/.test(raw)||
    !Number.isSafeInteger(port)||port<1024||port>65535)
   throw Error('private_staff_port_invalid')
 if(port===Number(env.CUOSHI_PRIVATE_PORT))throw Error('private_staff_port_collision')
 const soleOwnerId=env.CUOSHI_OWNER_ADMIN_ID
 if(typeof soleOwnerId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(soleOwnerId))
   throw Error('private_admin_sole_owner_required')
 const dbSchema=privateDatabaseSchema(env.CUOSHI_PG_SCHEMA)
 const staff=databaseUrl(env,'CUOSHI_PG_STAFF_URL')
 const reporter=databaseUrl(env,'CUOSHI_PG_REPORTING_URL')
 if(staff.role===reporter.role)throw Error('private_staff_roles_not_separated')
 const signingKey=hexKey(env.CUOSHI_STAFF_SIGNING_KEY_HEX)
 const edgeSecret=hexKey(env.CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX)
 const ownerPeerHashKey=hexKey(env.CUOSHI_OWNER_LOGIN_PEER_KEY_HEX)
 const ownerPasswordHash=env.CUOSHI_OWNER_PASSWORD_SCRYPT??''
 const ownerTotpSecret=env.CUOSHI_OWNER_TOTP_SECRET??''
 if(Buffer.from(ownerPeerHashKey).equals(Buffer.from(signingKey))||
    Buffer.from(ownerPeerHashKey).equals(Buffer.from(edgeSecret)))
   throw Error('private_staff_secrets_not_separated')
 if(Buffer.from(signingKey).equals(Buffer.from(edgeSecret)))
   throw Error('private_staff_secrets_not_separated')
 validateOwnerLoginSettings({ownerId:soleOwnerId,passwordRecord:ownerPasswordHash,
  totpSecret:ownerTotpSecret,signingKey,peerHashKey:ownerPeerHashKey})
 return {port,dbSchema,staffDbUrl:staff.value,reportingDbUrl:reporter.value,
    signingKey,edgeSecret,soleOwnerId,ownerPasswordHash,ownerTotpSecret,ownerPeerHashKey}
}
