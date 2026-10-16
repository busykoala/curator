export type RequestLimits={hourly?:number;daily?:number};
export type LimitField={name:string;value?:unknown};
export function configuredRequestLimits(fields:LimitField[]=[]):RequestLimits {
  const count=Number(fields.find(f=>f.name==='baseSettings.queryLimit')?.value);
  const unit=Number(fields.find(f=>f.name==='baseSettings.limitsUnit')?.value);
  if(!Number.isFinite(count)||count<=0)return {};
  return unit===1?{hourly:Math.max(1,Math.floor(count))}:unit===0?{daily:Math.max(1,Math.floor(count))}:{};
}
