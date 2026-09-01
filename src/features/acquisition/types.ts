export type ControllerMode = "bulk" | "completion";
export type TargetOrigin = "migration" | "user" | "playlist";
export type AcquisitionTarget = {
  id:number; lidarr_album_id:number; lidarr_artist_id:number|null; origin:TargetOrigin;
  artist:string; title:string; status:string; quality_phase:string; download_hash:string|null;
  attempts_today:number; attempts_day:string|null; last_search_at:string|null;
  next_retry_at:string|null; first_queued_at:string|null; last_progress_at:string|null;
  last_size_left:number|null; source_name:string|null; imported_at:string|null;
  last_release_guid:string|null;
  created_at:string;
};
export type DownloadObservation = {
  targetId:number|null; hash:string; state:string; downloaded:number; amountLeft:number;
  progress:number; speed:number; connectedSeeds:number; reportedSeeds:number;
  availability:number; tracker?:string;
};
export type InterventionDecision = { action:string; reason:string; destructive?:boolean; targetId?:number; hash?:string };
export type SourceScore = { indexerId:number; name:string; score:number; priority:number; hardFailures:number };
