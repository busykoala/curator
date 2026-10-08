import assert from "node:assert/strict";
import test from "node:test";
import { identityIsWritable,resolveIdentity } from "./resolve";
import type { MbCandidate } from "@/features/sources/musicbrainz";

function candidate(title:string,artistNames:string[],primary="Album"):MbCandidate{return{id:"11111111-1111-4111-8111-111111111111",title,score:100,"first-release-date":"1999-01-01","primary-type":primary,"artist-credit":artistNames.map((name,index)=>({artist:{id:`22222222-2222-4222-8222-22222222222${index}`,name},joinphrase:index<artistNames.length-1?" & ":""}))}}

for(const [artist,album,group] of [
  ["Massive Attack","Massive Attack ?– Blue Lines",candidate("Blue Lines",["Massive Attack"])],
  ["Pink Floyd","Ummagumma (Studio Album)",candidate("Ummagumma",["Pink Floyd"])],
  ["The Doobie Brothers","The Best of The Doobies",candidate("Best of The Doobies",["The Doobie Brothers"])],
  ["Hans Zimmer & Benjamin Wallfisch","Blade Runner 2049",candidate("Blade Runner 2049",["Hans Zimmer","Benjamin Wallfisch"])],
  ["Scooter & Xillions","Rave Teacher (Somebody Like Me)",candidate("Rave Teacher (Somebody Like Me)",["Scooter","Xillions"],"Single")],
] as const)test(`writes an unambiguous catalog identity for ${album}`,()=>{const identity=resolveIdentity(artist,album,[group],[]);assert.equal(identityIsWritable(identity),true);assert.ok(identity.confidence>=.9)});

test("recognizes a maxi-single as a single",()=>{const identity=resolveIdentity("Christina Aguilera","Genie In A Bottle (Maxi-Single)",[candidate("Genie in a Bottle",["Christina Aguilera"],"Single")],[]);assert.equal(identityIsWritable(identity),true);assert.ok(identity.confidence>=.95)});
