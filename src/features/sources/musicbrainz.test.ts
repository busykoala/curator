import assert from "node:assert/strict";
import test from "node:test";
import { catalogTitleVariants,cleanCatalogText } from "./musicbrainz";

test("removes catalog edition markers",()=>{
  assert.equal(cleanCatalogText("Genie In A Bottle (Maxi-Single)"),"Genie In A Bottle");
  assert.equal(cleanCatalogText("Original Rockers (UK)"),"Original Rockers");
  assert.equal(cleanCatalogText("The Social Network [Blu-ray 5.1 Surround Mix]"),"The Social Network");
});

test("derives canonical title variants from noisy library names",()=>{
  assert.ok(catalogTitleVariants("Massive Attack","Massive Attack ?– Blue Lines").includes("Blue Lines"));
  assert.ok(catalogTitleVariants("Pink Floyd","More (Music From The Film More) (2011 Remastered)").includes("More"));
  assert.ok(catalogTitleVariants("Portishead","Roseland NYC Live 25").includes("Roseland NYC Live"));
  assert.ok(catalogTitleVariants("The Beatles","The Beatles - Love Me Do").includes("Love Me Do"));
  assert.ok(catalogTitleVariants("The Doobie Brothers","The Best of The Doobies").includes("Best of The Doobies"));
});
