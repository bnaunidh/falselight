// Explicit, bounded presets. Max is opt-in; medium remains the default.
export const QUALITY = {
 low:{pr:.75,prMin:.5,msaa:false,aniso:4,shadowMap:1024,shadowExtent:35,treeLod0:28,treeLod1:90,treeLod2:800,plants:28,debris:60,terrainLod0:90,spotShadows:false,flashShadows:false,lampShadows:false,terrainTex:512},
 medium:{pr:1.3,prMin:.8,msaa:true,aniso:8,shadowMap:2048,shadowExtent:55,treeLod0:44,treeLod1:150,treeLod2:1500,plants:50,debris:110,terrainLod0:150,spotShadows:true,flashShadows:false,lampShadows:false,terrainTex:1024},
 high:{pr:1.75,prMin:.9,msaa:true,aniso:16,shadowMap:4096,shadowExtent:70,treeLod0:60,treeLod1:200,treeLod2:2000,plants:70,debris:150,terrainLod0:200,spotShadows:true,flashShadows:true,lampShadows:true,terrainTex:1024},
 max:{pr:2,prMin:1,msaa:true,aniso:16,shadowMap:4096,shadowExtent:70,treeLod0:95,treeLod1:300,treeLod2:2400,plants:105,debris:220,terrainLod0:300,spotShadows:true,flashShadows:true,lampShadows:true,spotMap:2048,flashMap:1024,lampMap:1024,terrainTex:1024,grain:.035},
};
export const qualityName = name => Object.hasOwn(QUALITY,name)?name:'medium';
export function vegetationRanges(kind,q) {
 const tree=/fir|hemlock|snag|sapling/.test(kind);
 return tree?(kind==='veg_sapling'?[q.treeLod0*.6,q.treeLod1*.6,q.treeLod2*.5]:[q.treeLod0,q.treeLod1,q.treeLod2]):/rocks|stump|log|boulder/.test(kind)?[q.debris]:[q.plants];
}
export function applyQualityResources(e) {
 const q=e.quality,maxTex=e.renderer.capabilities.maxTextureSize||4096;
 const shadow=(light,on,size)=>{
  if(!light)return;light.castShadow=on;const s=light.shadow,n=Math.min(size,maxTex);if(!s)return;
  if(s.mapSize.x!==n||s.mapSize.y!==n||!on){s.map?.dispose();s.map=null;s.mapPass?.dispose();s.mapPass=null;s.mapSize.set(n,n);s.needsUpdate=true;}
 };
 shadow(e.sky?.sun,true,q.shadowMap);
 const c=e.sky?.sun.shadow.camera;if(c){c.left=c.bottom=-q.shadowExtent;c.right=c.top=q.shadowExtent;c.updateProjectionMatrix();}
 shadow(e.lights?.searchlight.spot,q.spotShadows,q.spotMap||1024);
 shadow(e.lights?.flashlight.light,q.flashShadows,q.flashMap||512);
 shadow(e.lights?.cabLamp.light,q.lampShadows,q.lampMap||512);
 if(e.msaa!==q.msaa){e.msaa=q.msaa;e.post?.rebuild(q.msaa);}
 const aniso=Math.min(e.renderer.capabilities.getMaxAnisotropy?.()||1,q.aniso),seen=new Set();
 e.scene.traverse(o=>{for(const m of o.material?[].concat(o.material):[]){if(!m||seen.has(m))continue;seen.add(m);for(const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'])if(m[k]&&m[k].anisotropy!==aniso){m[k].anisotropy=aniso;m[k].needsUpdate=true;}if(m.alphaTest>0&&m.alphaToCoverage!==q.msaa){m.alphaToCoverage=q.msaa;m.needsUpdate=true;}}});
 for(const vs of e.world?.vegSets||[])vs.ranges=vegetationRanges(vs.kind,q);
 if(e.world)e.world._vegQueue=e.world.vegSets.slice();
 if(e.post)e.post.params.grain=q.grain??.055;
}
