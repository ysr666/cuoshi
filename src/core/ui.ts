import type { Skin } from './model'
export function themeClass(s:Skin):string {return s==='paper'?'paper':'modern'}
export function dateTitle(key:string):string { const [y,m,d]=key.split('-');return `${y}年${Number(m)}月${Number(d)}日` }
export function notify(s:string):void{uni.showToast({title:s,icon:'none',duration:1800})}
