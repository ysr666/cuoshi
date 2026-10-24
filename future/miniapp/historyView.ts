/** Presentation only. Never rewrites append-only events or timestamps. */
import type {ChangeEvent} from '../../src/core/model'

export function pastCountChange(event:Pick<ChangeEvent,'before'|'after'|'targetDate'>):string{
 const {before,after}=event
 if(before===null&&after!==null)return `从未记录改为 ${after} 件`
 if(after===null&&before!==null)return `取消原来的 ${before} 件记录`
 if(before===null||after===null)return '记录未发生变化'
 if(after>before)return `增加 ${after-before} 件（${before} → ${after}）`
 if(after<before)return `减少 ${before-after} 件（${before} → ${after}）`
 return `仍为 ${after} 件`
}
export function localEventTime(iso:string):string{
 const date=new Date(iso)
 if(!Number.isFinite(date.getTime()))return '时间不可用'
 const two=(n:number)=>String(n).padStart(2,'0')
 return `${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
