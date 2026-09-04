import { lookup } from "node:dns/promises";

export type WebResult={title:string;url:string;snippet:string};
export type OpenedPage={url:string;title:string;description:string;images:string[];text:string};

function privateAddress(address:string):boolean{
  return address==="::1"||address.startsWith("fe80:")||address.startsWith("fc")||address.startsWith("fd")||/^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

async function safeUrl(value:string):Promise<URL>{
  const url=new URL(value);
  if(!["http:","https:"].includes(url.protocol))throw new Error("Only HTTP(S) web destinations are allowed");
  if(url.username||url.password)throw new Error("Authenticated web destinations are not allowed");
  const addresses=await lookup(url.hostname,{all:true});
  if(!addresses.length||addresses.some((item)=>privateAddress(item.address)))throw new Error("Private web destination rejected");
  return url;
}

async function boundedFetch(value:string,maxBytes:number):Promise<{url:URL;contentType:string;text:string}>{
  let url=await safeUrl(value);
  for(let hop=0;hop<4;hop+=1){
    const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(15_000),headers:{Accept:"text/html,application/xhtml+xml,text/plain,application/xml;q=0.8,*/*;q=0.2","Accept-Language":"en-US,en;q=0.8","User-Agent":"MusicCurator/2.0 (+https://curator.blizzard.busykoala.io/)"}});
    if(response.status>=300&&response.status<400){const next=response.headers.get("location");if(!next)throw new Error("Invalid web redirect");url=await safeUrl(new URL(next,url).toString());continue}
    if(!response.ok)throw new Error(`${response.status} ${url}`);
    const contentType=response.headers.get("content-type")??"";
    if(!/text|html|xml|json/i.test(contentType))throw new Error("Unsupported web content type");
    const length=Number(response.headers.get("content-length")??0);if(length>maxBytes)throw new Error("Web response too large");
    const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>maxBytes)throw new Error("Web response too large");
    return{url,contentType,text:new TextDecoder().decode(bytes)};
  }
  throw new Error("Too many web redirects");
}

function entities(value:string):string{return value.replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,code:string)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi,(_,code:string)=>String.fromCodePoint(Number.parseInt(code,16)))}
function plain(value:string):string{return entities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}
function attr(value:string,name:string):string|undefined{return entities(value.match(new RegExp(`${name}=["']([^"']+)["']`,"i"))?.[1]??"")||undefined}
function resultUrl(value:string):string|undefined{try{const raw=entities(value),url=new URL(raw.startsWith("//")?`https:${raw}`:raw);return url.hostname.endsWith("duckduckgo.com")&&url.searchParams.get("uddg")?url.searchParams.get("uddg")??undefined:url.toString()}catch{return undefined}}

export async function webSearch(query:string):Promise<WebResult[]>{
  const normalized=query.replace(/\s+/g," ").trim().slice(0,300);if(!normalized)throw new Error("Search query is empty");
  const {text}=await boundedFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalized)}`,2_000_000),results:WebResult[]=[];
  const anchors=[...text.matchAll(/<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)];
  for(let index=0;index<anchors.length&&results.length<8;index+=1){
    const markup=anchors[index][0],url=resultUrl(attr(markup,"href")??"");if(!url)continue;
    const after=text.slice((anchors[index].index??0)+markup.length,(anchors[index+1]?.index??text.length));
    const snippet=plain(after.match(/<a\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>[\s\S]*?<\/a>/i)?.[0]??"").slice(0,500);
    results.push({title:plain(markup).slice(0,200),url,snippet});
  }
  if(!results.length)throw new Error("Web search returned no parseable results");
  return results;
}

export async function openWebPage(value:string):Promise<OpenedPage>{
  const {url,text}=await boundedFetch(value,1_500_000),head=text.slice(0,250_000);
  const title=plain(head.match(/<title\b[^>]*>[\s\S]*?<\/title>/i)?.[0]??"").slice(0,240);
  const metas=[...head.matchAll(/<meta\b[^>]*>/gi)].map((match)=>match[0]),images:string[]=[];let description="";
  for(const meta of metas){const key=(attr(meta,"property")??attr(meta,"name")??"").toLowerCase(),content=attr(meta,"content");if(!content)continue;if(!description&&["description","og:description","twitter:description"].includes(key))description=plain(content).slice(0,600);if(["og:image","og:image:secure_url","twitter:image"].includes(key))try{const image=new URL(content,url).toString();if(!images.includes(image))images.push(image)}catch{}}
  return{url:url.toString(),title,description,images:images.slice(0,8),text:plain(text).slice(0,8_000)};
}
