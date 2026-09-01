import { db,stateGet,stateSet } from "@/features/db/client";
import type { AcquisitionTarget,DownloadObservation,TargetOrigin } from "./types";

export function upsertTarget(input:{albumId:number;artistId?:number;origin:TargetOrigin;artist?:string;title?:string}){
  db().prepare(`INSERT INTO acquisition_targets(lidarr_album_id,lidarr_artist_id,origin,artist,title)
    VALUES(?,?,?,?,?) ON CONFLICT(lidarr_album_id) DO UPDATE SET
    lidarr_artist_id=coalesce(excluded.lidarr_artist_id,lidarr_artist_id),
    origin=CASE WHEN acquisition_targets.origin='user' THEN 'user' WHEN excluded.origin='user' THEN 'user' WHEN excluded.origin='playlist' THEN 'playlist' ELSE acquisition_targets.origin END,
    artist=CASE WHEN excluded.artist<>'' THEN excluded.artist ELSE artist END,
    title=CASE WHEN excluded.title<>'' THEN excluded.title ELSE title END,updated_at=CURRENT_TIMESTAMP`)
    .run(input.albumId,input.artistId??null,input.origin,input.artist??"",input.title??"");
}
export function targets():AcquisitionTarget[]{return db().prepare("SELECT * FROM acquisition_targets").all() as AcquisitionTarget[]}
export function targetByAlbum(albumId:number){return db().prepare("SELECT * FROM acquisition_targets WHERE lidarr_album_id=?").get(albumId) as AcquisitionTarget|undefined}
export function updateTarget(id:number,patch:Record<string,unknown>){const keys=Object.keys(patch);if(!keys.length)return;db().prepare(`UPDATE acquisition_targets SET ${keys.map(key=>`${key}=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...keys.map(key=>patch[key]),id)}
export function observe(value:DownloadObservation){db().prepare(`INSERT INTO download_observations(target_id,torrent_hash,state,downloaded,amount_left,progress,download_speed,connected_seeds,reported_seeds,availability,tracker) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(value.targetId,value.hash,value.state,value.downloaded,value.amountLeft,value.progress,value.speed,value.connectedSeeds,value.reportedSeeds,value.availability,value.tracker??null)}
export function intervene(decision:{targetId?:number;hash?:string;action:string;status:string;evidence?:unknown}){db().prepare("INSERT INTO download_interventions(target_id,torrent_hash,action,status,evidence_json) VALUES(?,?,?,?,?)").run(decision.targetId??null,decision.hash??null,decision.action,decision.status,JSON.stringify(decision.evidence??{}))}
export function destructiveAllowed(){const row=db().prepare("SELECT sum(created_at>=datetime('now','-15 minutes')) short,sum(created_at>=datetime('now','-1 hour')) hourly FROM download_interventions WHERE status='applied' AND action IN ('replace','cleanup','disable-source')").get() as{short:number|null;hourly:number|null};return Number(row.short??0)<5&&Number(row.hourly??0)<20}
export function acquireControllerLease(){const until=Number(stateGet("acquisition_lease","0"));if(until>Date.now())return false;stateSet("acquisition_lease",String(Date.now()+4*60_000));return true}
