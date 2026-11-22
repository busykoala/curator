import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {canonicalize,seedTaxonomy} from './service';
test('unknown first-seen terms are proposed, never mapped onto an unrelated seed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-taxonomy-'));config.DATABASE_PATH=join(dir,'t.sqlite');
  try{
    seedTaxonomy();
    assert.deepEqual(canonicalize('genre',['Alternative'],'a'),[],'score 0 must not become "Ambient"');
    assert.deepEqual(canonicalize('genre',['Rock'],'a'),['Rock']);
    assert.deepEqual(canonicalize('style',['Hard Rock'],'a'),['Hard Rock']);
    assert.deepEqual(canonicalize('genre',['Alternative'],'b'),['Alternative'],'a second sighting creates the term');
  }finally{rmSync(dir,{recursive:true,force:true})}
});
