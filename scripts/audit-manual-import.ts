import assert from "node:assert/strict";
import { exactManualImport } from "../src/features/acquisition/manual-import";

const original = globalThis.fetch;
let albums = [42, 42];
let submitted: Record<string, unknown> | undefined;
let archive=false;
let image=false,recheckRejected=false;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if(url.endsWith('/manualimport')&&init?.method==='POST'){
    const selected=JSON.parse(String(init.body));assert.equal(selected.length,2);assert.ok(selected.every((r:{replaceExistingFiles:boolean})=>!r.replaceExistingFiles));
    return Response.json(selected.map((r:Record<string,unknown>,i:number)=>({...r,artist:{id:7},album:{id:42},tracks:[{id:100+i}],rejections:recheckRejected?[{reason:'Has missing tracks'}]:[]})));
  }
  if (url.includes("/manualimport?")) {
    const query=new URL(url).searchParams;
    if(archive&&(query.has('downloadId')||query.get('folder')!=='/data/downloads/test'))return Response.json([]);
    const rows=albums.map((albumId, index) => ({
    path: `/data/downloads/test/${index + 1}.flac`,
    artist: { id: 7, artistName: "Artist" },
    album: { id: albumId, title: "Album" },
    tracks: [{ id: 100 + index }],
    rejections: image?[{reason:'Has unmatched tracks'}]:[],
    quality: { quality: { id: 6, name: "FLAC" } },
    albumReleaseId: 9,
  }));return Response.json(image?[{path:'/data/downloads/test/image.flac',tracks:[],rejections:[{reason:'Has unmatched tracks'}]},...rows]:rows);}
  if (url.endsWith("/command") && init?.method === "POST") {
    submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
    return Response.json({ id: 1, status: "started" });
  }
  if (url.endsWith("/command/1")) return Response.json({ id: 1, status: "completed" });
  throw new Error(`Unexpected request: ${url}`);
};

async function main() { try {
  const result = await exactManualImport({ id: 1, downloadId: "hash", status: "completed" });
  assert.notEqual(result, false);
  assert.equal(result && result.albumId, 42);
  assert.equal((submitted?.files as unknown[]).length, 2);
  assert.deepEqual((submitted?.files as Array<{ albumReleaseId?: number }>).map(file => file.albumReleaseId), [9, 9]);
  albums = [42, 43];
  submitted = undefined;
  assert.equal(await exactManualImport({ id: 2, downloadId: "other" }), false);
  assert.equal(submitted, undefined);
  albums=[42,42];archive=true;
  assert.notEqual(await exactManualImport({id:3,albumId:42,artistId:7,downloadId:'archive',trackFileCount:19,outputPath:'/data/downloads/test.7z'}),false);
  assert.equal(((submitted as Record<string,unknown>|undefined)?.files as unknown[]).length,2);
  image=true;submitted=undefined;
  assert.notEqual(await exactManualImport({id:4,albumId:42,artistId:7,downloadId:'image',outputPath:'/data/downloads/test.7z'}),false);
  assert.equal(((submitted as Record<string,unknown>|undefined)?.files as unknown[]).length,2);
  recheckRejected=true;submitted=undefined;
  assert.equal(await exactManualImport({id:5,albumId:42,artistId:7,downloadId:'invalid',outputPath:'/data/downloads/test.7z'}),false);
  assert.equal(submitted,undefined);
  console.log("Manual import audit passed: unique album identities are recovered and ambiguous mappings are rejected.");
} finally {
  globalThis.fetch = original;
} }

main().catch((error) => { console.error(error); process.exitCode = 1; });
