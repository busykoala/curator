export type Row = Record<string, unknown>;
export type CoverageValue={present:number;total:number;missing:number};
export type SemanticSummary={total:number;complete:number;partial:number;failed:number;pending:number;audioAnalyzed:number;albumsProfiled:number;recent:number;dimensions:Record<string,CoverageValue>};
export type Snapshot = { semantic:SemanticSummary;metrics:Record<string,number>;coverage:Record<string,CoverageValue>;paused:boolean;operational:{autostart:boolean;running:boolean;phase:string;scan:Row;processing:Row;lastScan:number;lastError:string};files:Row[];issueGroups:Row[];failedAlbums:Row[];jobs:Row[];taxonomy:Row[];proposals:Row[];sources:Row[];ai:Row[] };
export const issueCopy:Record<string,{title:string;detail:string}>={
  missing_albumArtist:{title:"Missing album artist",detail:"Needed to group tracks into the correct album. Curator adds it during enrichment."},
  missing_embedded_art:{title:"Cover not embedded",detail:"A sidecar cover may exist; Curator embeds the verified cover on the next safe write."},
  missing_artist_artwork:{title:"Contributor image missing",detail:"No verified artist or composer portrait has been accepted yet."},
  missing_genre:{title:"Genre not classified",detail:"Waiting for deterministic cleanup and semantic classification."},
  missing_style:{title:"Style not classified",detail:"This album still needs a more specific musical style."},
  missing_mood:{title:"Mood not classified",detail:"This album still needs evidence-backed mood tags."},
  missing_scene:{title:"Scene context not assigned",detail:"Scene is optional; this shows where no portable or evidence-backed cultural context is currently available."},
  categorization_pending:{title:"Semantic categorization pending",detail:"Tracks are queued for the current schema, classifier, and audio-analysis policy."},
  censored_metadata:{title:"Damaged text",detail:"The stored title or credit contains replacement markers and needs Unicode repair."},
  processing_deferred:{title:"Source temporarily unavailable",detail:"MusicBrainz or another provider asked Curator to wait. This retries automatically and is not a permanent failure."},
  scan_failed:{title:"File scan failed",detail:"The file could not be read safely. Its original contents were not changed."},
  processing_failed:{title:"Processing failed",detail:"The worker preserved the original file. Review and retry the grouped item."},
  identity_unresolved:{title:"Catalog identity uncertain",detail:"Semantic metadata was enriched, but factual MusicBrainz IDs were withheld because evidence was not decisive."},
  categorization_partial:{title:"Semantic profile is sparse",detail:"Core track-level dimensions are incomplete and scheduled for an evidence or AI retry."},
  categorization_failed:{title:"Track categorization failed",detail:"Audio and existing metadata were preserved; the semantic profile can be retried independently."},
};
