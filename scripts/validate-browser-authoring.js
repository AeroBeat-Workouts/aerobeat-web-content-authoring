// @ts-check

import assert from "node:assert/strict";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = normalize(new URL("..", import.meta.url).pathname);
const workerProbe = `import { sha256Hex } from "/node_modules/@aerobeat/web-hash/src/index.js";
self.onmessage = async (event) => {
  const expectedSecure = event.data;
  const subtleType = typeof globalThis.crypto?.subtle;
  if (isSecureContext !== expectedSecure) throw new Error("Worker secure-context precondition failed");
  if ((expectedSecure && subtleType !== "object") || (!expectedSecure && subtleType !== "undefined")) throw new Error("Worker WebCrypto precondition failed before conversion");
  let native = null; let nativeError = "";
  try { native = await sha256Hex("authoring-context-probe", { backend: "native" }); } catch (error) { nativeError = error instanceof Error ? error.message : String(error); }
  self.postMessage({ isSecureContext, subtleType, auto: await sha256Hex("authoring-context-probe"), fallback: await sha256Hex("authoring-context-probe", { backend: "fallback" }), native, nativeError });
};`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/hash-context-worker.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(workerProbe);
    return;
  }
  const relative = pathname === "/" ? ".testbed/demo/index.html" : pathname.slice(1);
  const path = normalize(join(root, relative));
  if (!path.startsWith(root) || !statSafe(path)) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", contentType(path));
  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/src/canonical.js") {
    const source = readFileSync(path, "utf8");
    const rewritten = source.replace('from "@aerobeat/web-hash"', 'from "/node_modules/@aerobeat/web-hash/src/index.js"');
    if (rewritten === source) { response.writeHead(500).end("Declared hash import was not found"); return; }
    response.end(rewritten);
    return;
  }
  if (pathname === "/src/converter.js" || pathname === "/src/validator.js" || pathname === "/src/persistence.js" || pathname === "/src/note-palette.js") {
    const source = readFileSync(path, "utf8");
    const rewritten = source.replace('from "@aerobeat/web-contracts/obstacle-contracts"', 'from "/node_modules/@aerobeat/web-contracts/src/obstacle-contracts.js"').replace('from "@aerobeat/web-contracts/note-palette-contracts"', 'from "/node_modules/@aerobeat/web-contracts/src/note-palette-contracts.js"');
    if (rewritten === source) { response.writeHead(500).end("Declared authoring contract import was not found"); return; }
    response.end(rewritten);
    return;
  }
  createReadStream(path).pipe(response);
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "0.0.0.0", () => resolve(undefined)); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Browser test server did not bind");
const addresses = Object.values(networkInterfaces()).flat().filter(Boolean)
  .filter((entry) => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("127."));
const preferred = addresses.find((entry) => entry.address.startsWith("100.")) ?? addresses[0];
assert.ok(preferred, "a genuine non-loopback IPv4 interface is required");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const externalRequests = [];
page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") errors.push(`${message.type()}: ${message.text()}`); });
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("request", (request) => {
  const hostname = new URL(request.url()).hostname;
  if (hostname !== "localhost" && hostname !== preferred.address) externalRequests.push(request.url());
});
try {
  const run = async (url, expectedSecure) => {
    const response = await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(response?.ok(), true);
    const precondition = await page.evaluate(async (secure) => {
      if (isSecureContext !== secure) throw new Error("Window secure-context precondition failed");
      const subtleType = typeof globalThis.crypto?.subtle;
      if ((secure && subtleType !== "object") || (!secure && subtleType !== "undefined")) throw new Error("Window WebCrypto precondition failed before authoring");
      const hashes = await import("@aerobeat/web-hash");
      let native = null; let nativeError = "";
      try { native = await hashes.sha256Hex("authoring-context-probe", { backend: "native" }); } catch (error) { nativeError = error instanceof Error ? error.message : String(error); }
      const worker = await new Promise((resolve, reject) => {
        const instance = new Worker("/hash-context-worker.js", { type: "module" });
        instance.onerror = (event) => { instance.terminate(); reject(new Error(event.message)); };
        instance.onmessage = (event) => { instance.terminate(); resolve(event.data); };
        instance.postMessage(secure);
      });
      return { isSecureContext, subtleType, auto: await hashes.sha256Hex("authoring-context-probe"), fallback: await hashes.sha256Hex("authoring-context-probe", { backend: "fallback" }), native, nativeError, worker };
    }, expectedSecure);
    assert.equal(precondition.isSecureContext, expectedSecure);
    assert.equal(precondition.subtleType, expectedSecure ? "object" : "undefined");
    assert.equal(precondition.auto, precondition.fallback);
    assert.equal(precondition.worker.isSecureContext, expectedSecure);
    assert.equal(precondition.worker.subtleType, expectedSecure ? "object" : "undefined");
    assert.equal(precondition.worker.auto, precondition.worker.fallback);
    if (expectedSecure) {
      assert.equal(precondition.native, precondition.fallback);
      assert.equal(precondition.worker.native, precondition.worker.fallback);
    } else {
      assert.equal(precondition.native, null);
      assert.match(precondition.nativeError, /unavailable/u);
      assert.equal(precondition.worker.native, null);
      assert.match(precondition.worker.nativeError, /unavailable/u);
    }
    const protocolMatrix=await page.evaluate(async()=>{const modulePath="/src/index.js",api=await import(modulePath),encoder=new TextEncoder(),difficultyBytes=encoder.encode(JSON.stringify({version:"3.3.0",colorNotes:[],bombNotes:[],obstacles:[],sliders:[],burstSliders:[]})),difficultyHash=await api.prefixedSha256(difficultyBytes),infoHash=await api.prefixedSha256(encoder.encode("{}"));const manifest={schemaId:"aerobeat.authoring-source.v2",infoFormat:"v2",infoVersion:"2.1.0",infoPath:"info.dat",infoHash,songName:"Protocol",songAuthorName:"",levelAuthorName:"",bpm:120,audioPath:"",audioContentHash:"",selectedDifficulty:{difficulty:"Hard",path:"hard.dat",beatMapFormat:"v3",beatMapVersion:"3.3.0",contentHash:difficultyHash,notePalette:null},sourceProvider:"synthetic",sourceId:"protocol",sourceVersionHash:"0".repeat(40)},options={difficulty:"Hard",songToken:"protocol",songName:"Protocol",bpm:120,sourceProvider:"synthetic",sourceId:"protocol",sourceVersionHash:"0".repeat(40),sourceInfoFormat:"v2",sourceInfoVersion:"2.1.0",sourceInfoHash:infoHash,sourceDifficultyPath:"hard.dat",sourceBeatmapFormat:"v3",sourceBeatmapVersion:"3.3.0",sourceDifficultyHash:difficultyHash,notePalette:null,audioPath:"",audioContentHash:"",modifiers:[]},request={schema:"aerobeat/authoring_worker_request",version:2,kind:"convert",jobId:"browser-protocol",manifest,difficultyBytes,options};const direct=async(value)=>new Promise((resolve,reject)=>{const worker=new Worker("/src/conversion-worker.js",{type:"module"});worker.onerror=(event)=>{worker.terminate();reject(new Error(event.message));};worker.onmessage=(event)=>{worker.terminate();resolve(event.data);};worker.postMessage(value);});const v1Manifest={schemaId:"aerobeat.authoring-source.v1",sourceFormatMajor:3,infoPath:"info.dat",songName:"Protocol",songAuthorName:"",levelAuthorName:"",bpm:120,audioPath:"",audioContentHash:"",selectedDifficulty:{difficulty:"Hard",path:"hard.dat",contentHash:difficultyHash},sourceProvider:"synthetic",sourceId:"protocol",sourceVersionHash:"0".repeat(40)};const requestRows=await Promise.all([direct({...request,manifest:v1Manifest}),direct({...request,version:1}),direct({...request,manifest:{...manifest,sourceFormatMajor:3}})]);class FakeWorker{constructor(){this.onmessage=(event)=>{void event;};}postMessage(){}terminate(){}emit(data){this.onmessage({data});}}const honest=await api.executeWorkerConversion(request),mixed=async(message)=>{const fake=new FakeWorker(),adapter=api.createBrowserAuthoringWorkerAdapter({workerFactory:()=>fake});const pending=adapter.convert(request).then(()=>"fulfilled",error=>error.code);fake.emit(message);return pending;};return{requests:requestRows.map((row)=>[row.version,row.kind,row.code]),messages:[await mixed({schema:"aerobeat/authoring_worker_message",version:2,kind:"result",jobId:request.jobId,result:{...honest,version:1}}),await mixed({schema:"aerobeat/authoring_worker_message",version:1,kind:"result",jobId:request.jobId,result:honest})]};});
    assert.deepEqual(protocolMatrix,{requests:[[2,"error","worker_request_invalid"],[2,"error","worker_request_invalid"],[2,"error","worker_request_invalid"]],messages:["worker_protocol_invalid","worker_protocol_invalid"]},"real Chromium module Worker and browser adapter must reject every mixed v1/v2 seam and stale sourceFormatMajor");
    const migration = expectedSecure ? await page.evaluate(async () => {
      const modulePath="/src/index.js";const {canonicalJson,createAeroWebContentAuthoringService,createIndexedDbPersistenceAdapter,prefixedSha256}=await import(modulePath);
      const hash=`sha256:${"3".repeat(64)}`,audio=new Uint8Array([4,3,2,1]),packageValue={packageId:"historical-package",songName:"Historical",source:{difficulty:"Hard"},provenance:{raw:"0.0.39"}};
      const packageRow={key:"historical",package:packageValue,packageHash:await prefixedSha256(canonicalJson(packageValue)),assets:[{path:"cover.bin",bytes:new Uint8Array([9,8])}],sourceCache:[{path:"Info.dat",bytes:new Uint8Array([7,6])}],createdAtMs:1700000000123,schemaVersion:5,writeToken:"historical-token",assetRefs:[{path:"media/audio/song.ogg",contentHash:hash}],flowCellOrientation:"aerobeat_top_left_v1",flowObstacleContract:"source_geometry_v1"};
      const collectionRow={collectionId:"historical-collection",songName:"Historical",sourceProvider:"beatsaver",sourceId:"raw39",sourceVersionHash:"raw39hash",converterProfileId:"legacy",converterProfileHash:"legacy-hash",modifierIds:[],packageKeys:["historical"],packages:[{packageKey:"historical",packageId:"historical-package",difficultyId:"Hard",difficultyLabel:"Hard"}],createdAtMs:1700000000456,schemaVersion:5,writeToken:"historical-collection-token",flowCellOrientation:"aerobeat_top_left_v1",flowObstacleContract:"source_geometry_v1"};
      const seed=async(name,version,packages,collections)=>new Promise((resolve,reject)=>{const request=indexedDB.open(name,version);request.onupgradeneeded=()=>{const database=request.result,packageStore=database.createObjectStore("packages",{keyPath:"key"}),assetStore=database.createObjectStore("assets",{keyPath:"contentHash"}),collectionStore=database.createObjectStore("collections",{keyPath:"collectionId"});database.createObjectStore("meta",{keyPath:"key"});for(const row of packages)packageStore.put(row);assetStore.put({contentHash:hash,bytes:audio,byteLength:audio.byteLength});for(const row of collections)collectionStore.put(row);};request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve();};});
      const inspect=async(name)=>new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const database=request.result,tx=database.transaction(["packages","assets","collections"],"readonly"),p=tx.objectStore("packages").getAll(),a=tx.objectStore("assets").getAll(),c=tx.objectStore("collections").getAll();tx.onerror=()=>reject(tx.error);tx.oncomplete=()=>{resolve({version:database.version,packages:p.result,assets:a.result,collections:c.result});database.close();};};});
      const remove=(name)=>new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});
      const name5=`browser-v5-${crypto.randomUUID()}`;await seed(name5,5,[packageRow],[collectionRow]);const adapter5=createIndexedDbPersistenceAdapter({databaseName:name5});const listed5=await adapter5.list(),collections5=await adapter5.listCollections(),exported5=await createAeroWebContentAuthoringService({persistence:adapter5}).exportPackage("historical");let stale5="";try{await adapter5.get("historical");}catch(error){stale5=error?.code??"";}const raw5=await inspect(name5);await adapter5.deleteCollection("historical-collection");adapter5.destroy();await remove(name5);
      const name6=`browser-v6-${crypto.randomUUID()}`,poisoned={...packageRow,schemaVersion:6,obstacleContract:"prior_obstacle_contract"},poisonedCollection={...collectionRow,schemaVersion:6,obstacleContract:"prior_obstacle_contract"};await seed(name6,6,[poisoned],[poisonedCollection]);const adapter6=createIndexedDbPersistenceAdapter({databaseName:name6});const listed6=await adapter6.list(),collections6=await adapter6.listCollections();let stale6="";try{await adapter6.get("historical");}catch(error){stale6=error?.code??"";}const raw6=await inspect(name6);adapter6.destroy();await remove(name6);
      const hostileName=`browser-v6-hostile-${crypto.randomUUID()}`,validBefore={...poisoned,key:"valid-before",package:{...packageValue,packageId:"valid-before"},flowObstacleContract:undefined};delete validBefore.flowObstacleContract;validBefore.obstacleContract="normalized_obstacle_v2";const hostile={...poisoned,key:"hostile",package:{...packageValue,packageId:"hostile"},unknownHostileField:true};await seed(hostileName,6,[validBefore,hostile],[]);const hostileAdapter=createIndexedDbPersistenceAdapter({databaseName:hostileName});let hostileCode="";try{await hostileAdapter.list();}catch(error){hostileCode=error?.code??"";}hostileAdapter.destroy();const hostileRaw=await inspect(hostileName);await remove(hostileName);
      return {hostile:{code:hostileCode,version:hostileRaw.version,validSchema:hostileRaw.packages.find((row)=>row.key==="valid-before")?.schemaVersion,field:hostileRaw.packages.find((row)=>row.key==="hostile")?.unknownHostileField},v5:{listed:listed5.length,collections:collections5.length,stale:stale5,exportBytes:exported5.byteLength,raw:{version:raw5.version,packageKeys:Object.keys(raw5.packages[0]),collectionKeys:Object.keys(raw5.collections[0]),package:raw5.packages[0].package,packageHash:raw5.packages[0].packageHash,assets:[...raw5.packages[0].assets[0].bytes],sourceCache:[...raw5.packages[0].sourceCache[0].bytes],audio:[...raw5.assets[0].bytes],createdAtMs:raw5.packages[0].createdAtMs,writeToken:raw5.packages[0].writeToken}},v6:{listed:listed6.length,collections:collections6.length,stale:stale6,raw:{version:raw6.version,packageKeys:Object.keys(raw6.packages[0]),collectionKeys:Object.keys(raw6.collections[0])}}};
    }) : null;
    if(migration){assert.deepEqual(migration.hostile,{code:"storage_migration_invalid",version:6,validSchema:6,field:true},"real Chromium hostile DB6 upgrade must fail atomically without partial rewrite");assert.equal(migration.v5.listed,1);assert.equal(migration.v5.collections,1);assert.equal(migration.v5.stale,"flow_obstacle_reimport_required");assert.ok(migration.v5.exportBytes>0);assert.equal(migration.v5.raw.version,7);assert.equal(migration.v5.raw.packageKeys.includes("flowObstacleContract"),false);assert.equal(migration.v5.raw.packageKeys.includes("obstacleContract"),true);assert.equal(migration.v5.raw.collectionKeys.includes("flowObstacleContract"),false);assert.deepEqual(migration.v5.raw.package, {packageId:"historical-package",songName:"Historical",source:{difficulty:"Hard"},provenance:{raw:"0.0.39"}});assert.match(migration.v5.raw.packageHash,/^sha256:[0-9a-f]{64}$/u);assert.deepEqual(migration.v5.raw.assets,[9,8]);assert.deepEqual(migration.v5.raw.sourceCache,[7,6]);assert.deepEqual(migration.v5.raw.audio,[4,3,2,1]);assert.equal(migration.v5.raw.createdAtMs,1700000000123);assert.equal(migration.v5.raw.writeToken,"historical-token");assert.equal(migration.v6.listed,1);assert.equal(migration.v6.collections,1);assert.equal(migration.v6.stale,"flow_obstacle_reimport_required");assert.equal(migration.v6.raw.version,7);assert.equal(migration.v6.raw.packageKeys.includes("flowObstacleContract"),false);assert.equal(migration.v6.raw.collectionKeys.includes("flowObstacleContract"),false);}
    const db7PaletteHistory=expectedSecure?await page.evaluate(async()=>{const modulePath="/src/index.js",{createIndexedDbPersistenceAdapter}=await import(modulePath),name=`browser-db7-palette-${crypto.randomUUID()}`,adapter=createIndexedDbPersistenceAdapter({databaseName:name}),obstacle={start:1,end:2,type:"obstacle",sourceGeometry:{schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3},gameplayGeometry:{schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3},gridMask:[1,5,9]},v3={schemaId:"aerobeat.song-package.v3",schemaVersion:3,packageVersion:"3.0.0",packageId:"same-source-v3",songName:"History",source:{difficulty:"Hard",obstacleContract:"normalized_obstacle_v2"},charts:[{schemaId:"aerobeat.chart.flow.v3",schemaVersion:3,mode:"flow",rulesetId:"flow_grid_v2",beats:[obstacle]}]},v4={schemaId:"aerobeat.song-package.v4",schemaVersion:4,packageVersion:"4.0.0",packageId:"same-source-v4",songName:"History",source:{difficulty:"Hard",obstacleContract:"normalized_obstacle_v2"},notePalette:null,charts:[{schemaId:"aerobeat.chart.flow.v4",schemaVersion:4,mode:"flow",rulesetId:"flow_grid_v2",notePalette:null,beats:[obstacle]}]},row=(key,pkg,marker)=>({key,package:pkg,packageHash:`sha256:${marker.repeat(64)}`,assets:[{path:"audio.bin",bytes:new Uint8Array([5,4,3])}],sourceCache:[{path:"Info.dat",bytes:new Uint8Array([2,1])}],createdAtMs:1,schemaVersion:7,writeToken:key});await adapter.put(row("v3",v3,"3"));const listedBefore=await adapter.list();const stale=await adapter.get("v3").then(()=>"fulfilled",error=>error.code),exported=await adapter.getForExport("v3");await adapter.put(row("v4",v4,"4"));const current=await adapter.get("v4"),listedAfter=await adapter.list();const preserved=await adapter.getForExport("v3");await adapter.delete("v3");const currentAfterDelete=await adapter.get("v4");await adapter.delete("v4");adapter.destroy();await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});return{listedBefore:listedBefore.map((x)=>[x.key,x.packageHash]),stale,exported:[...exported.assets[0].bytes],sourceCache:[...exported.sourceCache[0].bytes],listedAfter:listedAfter.map((x)=>x.key),preserved:[...preserved.assets[0].bytes],currentSchema:current.package.schemaVersion,currentAfterDelete:currentAfterDelete.package.schemaVersion};}):null;
    if(db7PaletteHistory)assert.deepEqual(db7PaletteHistory,{listedBefore:[["v3",`sha256:${"3".repeat(64)}`]],stale:"note_palette_reimport_required",exported:[5,4,3],sourceCache:[2,1],listedAfter:["v3","v4"],preserved:[5,4,3],currentSchema:4,currentAfterDelete:4},"real Chromium DB7 must preserve/list/export/delete v3 bytes while requiring palette reimport and accepting same-source v4");
    const db7CurrentV3Collection=expectedSecure?await page.evaluate(async()=>{
      const modulePath="/src/index.js";
      const {canonicalJson,createAeroWebContentAuthoringService,createIndexedDbPersistenceAdapter,prefixedSha256}=await import(modulePath);
      const name=`browser-db7-current-v3-collection-${crypto.randomUUID()}`,sharedHash=`sha256:${"a".repeat(64)}`;
      const obstacle={start:1,end:2,type:"obstacle",sourceGeometry:{schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3},gameplayGeometry:{schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3},gridMask:[1,5,9]};
      const packageValue={schemaId:"aerobeat.song-package.v3",schemaVersion:3,packageVersion:"3.0.0",packageId:"derrick-import-v3",songName:"Derrick Import",source:{difficulty:"Expert",obstacleContract:"normalized_obstacle_v2"},charts:[{schemaId:"aerobeat.chart.flow.v3",schemaVersion:3,mode:"flow",rulesetId:"flow_grid_v2",beats:[obstacle]}]},packageHash=await prefixedSha256(canonicalJson(packageValue));
      const packageRow={key:"derrick-import-v3",package:packageValue,packageHash,assets:[{path:"cover.bin",bytes:new Uint8Array([9,8])}],sourceCache:[{path:"Info.dat",bytes:new Uint8Array([7,6])}],createdAtMs:1700000001000,schemaVersion:7,writeToken:"derrick-import",flowCellOrientation:"aerobeat_top_left_v1",obstacleContract:"normalized_obstacle_v2",assetRefs:[{path:"song.ogg",contentHash:sharedHash}]};
      const collectionRow={collectionId:"derrick-import-collection",songName:"Derrick Import",sourceProvider:"beatsaver",sourceId:"map",sourceVersionHash:"version",converterProfileId:"canonical",converterProfileHash:"hash",modifierIds:[],packageKeys:["derrick-import-v3"],packages:[{packageKey:"derrick-import-v3",packageId:"derrick-import-v3",difficultyId:"Expert",difficultyLabel:"Expert"}],createdAtMs:1700000001000,schemaVersion:7,writeToken:"derrick-import",flowCellOrientation:"aerobeat_top_left_v1",obstacleContract:"normalized_obstacle_v2"};
      await new Promise((resolve,reject)=>{const request=indexedDB.open(name,7);request.onupgradeneeded=()=>{const database=request.result;database.createObjectStore("packages",{keyPath:"key"}).put(packageRow);database.createObjectStore("assets",{keyPath:"contentHash"}).put({contentHash:sharedHash,bytes:new Uint8Array([4,3,2,1]),byteLength:4});database.createObjectStore("collections",{keyPath:"collectionId"}).put(collectionRow);database.createObjectStore("meta",{keyPath:"key"});};request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve(undefined);};});
      const adapter=createIndexedDbPersistenceAdapter({databaseName:name}),service=createAeroWebContentAuthoringService({persistence:adapter});
      const hostileRow={...packageRow,key:"hostile-generation",package:{schemaId:"hostile.song-package",schemaVersion:99,packageVersion:"99.0.0",packageId:"hostile",songName:"Hostile"},packageHash:`sha256:${"f".repeat(64)}`};await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const database=request.result,transaction=database.transaction("packages","readwrite");transaction.objectStore("packages").put(hostileRow);transaction.oncomplete=()=>{database.close();resolve(undefined);};transaction.onerror=()=>reject(transaction.error);};});
      const hostile=await adapter.get("hostile-generation").then(()=>"fulfilled",error=>error.code),hostileExport=await adapter.getForExport("hostile-generation");await adapter.delete("hostile-generation");
      const listed=await adapter.list(),collections=await adapter.listCollections(),stale=await adapter.get("derrick-import-v3").then(()=>"fulfilled",error=>error.code),preserved=await adapter.getForExport("derrick-import-v3"),exportBytes=await service.exportPackage("derrick-import-v3");
      await adapter.deleteCollection("derrick-import-collection");
      const after={packages:await adapter.list(),collections:await adapter.listCollections()};service.destroy();adapter.destroy();await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve(undefined);request.onerror=()=>reject(request.error);});
      return {hostile,hostileExportPreserved:hostileExport?.packageHash===hostileRow.packageHash,listed:listed.map((entry)=>entry.key),collections:collections.map((entry)=>entry.collectionId),hashPreserved:listed[0]?.packageHash===packageHash&&preserved?.packageHash===packageHash,stale,packageSchema:preserved?.package.schemaVersion,assets:preserved?.assets.map((entry)=>[entry.path,[...entry.bytes]]),sourceCache:preserved?.sourceCache.map((entry)=>[entry.path,[...entry.bytes]]),exported:exportBytes.byteLength>0,after:[after.packages.length,after.collections.length]};
    }):null;
    if(db7CurrentV3Collection)assert.deepEqual(db7CurrentV3Collection,{hostile:"storage_record_invalid",hostileExportPreserved:true,listed:["derrick-import-v3"],collections:["derrick-import-collection"],hashPreserved:true,stale:"note_palette_reimport_required",packageSchema:3,assets:[["cover.bin",[9,8]],["song.ogg",[4,3,2,1]]],sourceCache:[["Info.dat",[7,6]]],exported:true,after:[0,0]},"real Chromium DB7 must reject hostile current-contract generations as storage-invalid while preserving management access and keeping Derrick-like v3 palette migration exact");
    const result = await page.evaluate(() => globalThis.runAuthoringHarness());
    assert.equal(result.chartCount, 5);
    assert.equal(result.listCount, 1);
    assert.deepEqual(result.audioBytes, [4, 3, 2, 1]);
    assert.equal(result.loadedPackageId, result.exportPackageId);
    assert.equal(result.exportAssetCount, 1);
    assert.equal(result.remaining, 0);
    assert.deepEqual(result.malformed, ["v2", "v3", "v4"].map((format) => ({ format, code: "obstacle_container_invalid", state: "failed", snapshotCode: "obstacle_container_invalid", packageCount: 0, collectionCount: 0 })), "real module Worker + IndexedDB service must reject malformed obstacle containers without a package or collection commit");
    assert.equal(result.snapshotHasRawBytes, false);
    assert.ok(result.states.includes("converting"));
    assert.ok(result.states.includes("persisting"));
    assert.match(result.packageHash, /^sha256:[0-9a-f]{64}$/u);
    assert.match(result.audioSha256, /^[0-9a-f]{64}$/u);
    return { precondition, result };
  };

  const secure = await run(`http://localhost:${address.port}/.testbed/demo/index.html`, true);
  const insecure = await run(`http://${preferred.address}:${address.port}/.testbed/demo/index.html`, false);
  assert.equal(insecure.result.packageHash, secure.result.packageHash, "Window + conversion Worker package identity must match secure native output");
  assert.equal(insecure.result.audioSha256, secure.result.audioSha256, "persisted/exported audio identity must match secure native output");
  assert.equal(insecure.result.loadedPackageId, secure.result.loadedPackageId);
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log(JSON.stringify({ secureOrigin: `http://localhost:${address.port}`, insecureOrigin: `http://${preferred.address}:${address.port}`, windowHashing: "PASS", moduleWorkerHashing: "PASS", protocolV2MixedSeams:"PASS", db7PaletteHistory:"PASS", conversionPersistence: "PASS", packageHash: secure.result.packageHash }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

/** @param {string} path @returns {boolean} */
function statSafe(path) { try { return statSync(path).isFile(); } catch { return false; } }
/** @param {string} path @returns {string} */
function contentType(path) { const extension = extname(path); return extension === ".html" ? "text/html; charset=utf-8" : extension === ".js" ? "text/javascript; charset=utf-8" : extension === ".json" ? "application/json; charset=utf-8" : "application/octet-stream"; }
