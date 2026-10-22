import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryReleaseFit} from './discovery-fit';
import {defaultConfig,type PlaylistDefinition} from './types';
import type {DiscoveryRelease} from './discovery-repository';
const playlist={config:{...defaultConfig('discovery'),tasteLanes:['techno'],exclusions:['festival_edm']}} as PlaylistDefinition;
const release:DiscoveryRelease={id:'release',artistId:'artist',artist:'Artist',album:'Album',genres:['reggae'],identityVerified:true,evidence:[]};
test('verified identity alone does not make unrelated editorial music suitable for automatic acquisition',()=>{
  assert.equal(discoveryReleaseFit(playlist,release),null);
  assert.equal(discoveryReleaseFit(playlist,{...release,genres:['techno']})?.lane,'familiar');
  assert.equal(discoveryReleaseFit(playlist,{...release,genres:['techno','festival EDM']}),null);
});
test('a bound artist similarity recommendation permits adjacent research without claiming a verified style',()=>{
  const related={...release,evidence:[{provider:'listenbrainz',url:'https://api.listenbrainz.org/',fetchedAt:'',scope:'recording' as const,claims:{seedArtistId:'seed',seedArtist:'Rone',recommendedArtistId:'artist'}}]};
  assert.equal(discoveryReleaseFit(playlist,related)?.lane,'adjacent');
  assert.equal(discoveryReleaseFit(playlist,{...related,artistId:'different'}),null);
});
test('editorial musical claims require their exact supporting quote instead of a model-invented genre',()=>{
  const editorial={provider:'bandcamp',url:'https://daily.bandcamp.com/',fetchedAt:'',scope:'release' as const,claims:{styleQuote:'Patient hypnotic techno textures.',supportedStyleTerms:['techno']}};
  assert.equal(discoveryReleaseFit(playlist,{...release,evidence:[editorial]})?.lane,'familiar');
  assert.equal(discoveryReleaseFit(playlist,{...release,evidence:[{...editorial,claims:{...editorial.claims,styleQuote:'A reggae classic.'}}]}),null);
});
