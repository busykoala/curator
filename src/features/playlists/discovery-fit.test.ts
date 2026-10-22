import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryReleaseFit} from './discovery-fit';
import {defaultConfig,type PlaylistDefinition} from './types';
import type {DiscoveryRelease} from './discovery-repository';
import {configuredIntent} from './intent-schema';
const playlist={config:{...defaultConfig('discovery'),tasteLanes:['techno'],exclusions:['festival_edm']}} as PlaylistDefinition;
const release:DiscoveryRelease={id:'release',artistId:'artist',artist:'Artist',album:'Album',genres:['reggae'],identityVerified:true,evidence:[]};
test('verified identity alone does not make unrelated editorial music suitable for automatic acquisition',()=>{
  assert.equal(discoveryReleaseFit(playlist,release),null);
  assert.equal(discoveryReleaseFit(playlist,{...release,genres:['techno']})?.lane,'familiar');
  assert.equal(discoveryReleaseFit(playlist,{...release,genres:['techno','festival EDM']}),null);
});
test('a bound artist similarity recommendation permits adjacent research without claiming a verified style',()=>{
  const related={...release,genres:[],evidence:[{provider:'listenbrainz',url:'https://api.listenbrainz.org/',fetchedAt:'',scope:'recording' as const,claims:{seedArtistId:'seed',seedArtist:'Rone',seedStyleTerms:['techno'],recommendedArtistId:'artist'}}]};
  assert.equal(discoveryReleaseFit(playlist,related)?.lane,'adjacent');
  assert.equal(discoveryReleaseFit(playlist,{...related,artistId:'different'}),null);
  assert.equal(discoveryReleaseFit(playlist,{...related,genres:['pop','pop rock','electronic']}),null);
  assert.equal(discoveryReleaseFit(playlist,{...related,evidence:[{...related.evidence[0],claims:{...related.evidence[0].claims,seedStyleTerms:['electronic']}}]}),null);
});
test('editorial musical claims require their exact supporting quote instead of a model-invented genre',()=>{
  const editorial={provider:'bandcamp',url:'https://daily.bandcamp.com/',fetchedAt:'',scope:'release' as const,claims:{artist:'Artist',album:'Album',styleQuote:'Artist’s Album offers patient hypnotic techno textures.',supportedStyleTerms:['techno']}};
  assert.equal(discoveryReleaseFit(playlist,{...release,genres:[],evidence:[editorial]})?.lane,'familiar');
  assert.equal(discoveryReleaseFit(playlist,{...release,evidence:[editorial]}),null,'Contradictory release genres require review');
  assert.equal(discoveryReleaseFit(playlist,{...release,evidence:[{...editorial,claims:{...editorial.claims,styleQuote:'A reggae classic.'}}]}),null);
  assert.equal(discoveryReleaseFit(playlist,{...release,genres:[],evidence:[{...editorial,claims:{...editorial.claims,styleQuote:'Other Artist’s Different Album offers hypnotic techno textures.'}}]}),null,'A different album on the same page cannot establish this release’s style');
  assert.equal(discoveryReleaseFit(playlist,{...release,genres:[],evidence:[{...editorial,claims:{...editorial.claims,styleQuote:'Artist’s Album is not techno.'}}]}),null,'A negated style is not positive evidence');
  assert.equal(discoveryReleaseFit(playlist,{...release,album:'Techno',genres:[],evidence:[{...editorial,claims:{...editorial.claims,album:'Techno',styleQuote:'Artist’s Techno offers acoustic folk songs.'}}]}),null,'A word in the title does not establish the musical style');
});
test('tag-radio evidence establishes an alternative within the requested styles and cannot bypass an artist exclusion',()=>{
  const evidence={provider:'listenbrainz-tags',url:'https://api.listenbrainz.org/1/lb-radio/tags',fetchedAt:'',scope:'recording' as const,claims:{recordingId:'recording',recommendedArtistId:'artist',tagMatch:'any',requestedTags:['techno']}};
  const candidate={...release,genres:[],evidence:[evidence]};assert.equal(discoveryReleaseFit(playlist,candidate)?.lane,'familiar');assert.match(discoveryReleaseFit(playlist,candidate)!.reason,/at least one/);
  assert.equal(discoveryReleaseFit(playlist,{...candidate,evidence:[{...evidence,claims:{...evidence.claims,requestedTags:['pop','techno']}}]}),null);
  const intent=configuredIntent(playlist,'revision');intent.hard.excludeArtists=['Artist'];assert.equal(discoveryReleaseFit(playlist,candidate,intent),null);
});
