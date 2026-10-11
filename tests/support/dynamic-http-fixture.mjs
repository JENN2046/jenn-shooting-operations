import assert from 'node:assert/strict';
import {fixture,resourceId} from './business-http-fixture.mjs';
const time=t=>`2026-10-12T${t}:00.000Z`;
export async function setup(){const f=fixture();f.setTime(time('00:00'));await f.setup();
 for(const [id,start,end] of [['A','01:00','02:00'],['B','02:20','03:20'],['C','05:30','06:30']]){
 f.store.db.prepare(`INSERT INTO requests_v2 (id,source_ordinal,sku,name,client,legacy_deliver_text,kind,v1_status_mode,request_lifecycle,lifecycle_provenance,source,imported_at,v1_assets_present,v1_request_present,production_type,shooting_subtype,deliverable_count,aspect_ratio,requested_by,desired_date,note,sample_status,lighting_preset,reflectivity,priority)
 VALUES (?, ?,?,?,'Synthetic','Photo','细节','canonical','open','domain_command','submission',?,1,1,'平面','细节',1,'1:1','Synthetic','2026-10-12','','arrivedVerified','SOFT','low','p1')`).run('REQ-'+id,id.charCodeAt(0),id,id,time('00:00'));
 const r={id:'REQ-'+id};
 f.store.db.prepare(`INSERT INTO schedule_items(id,source_ordinal,resource_id,resource_resolution_status,resource_mapping_version,planned_start,planned_end,buffer_after_minutes,buffer_source,schedule_status,schedule_status_provenance,lock_status,lock_status_provenance,note,allocation_mode,source,business_created_at,business_updated_at,imported_at) VALUES(?, ?,?,'resolved','resource-catalog-v1',?,?,20,'C1','confirmed','domain_command','unlocked','domain_command','','single','human',?,?,?)`).run(id,id.charCodeAt(0),resourceId,time(start),time(end),time('00:00'),time('00:00'),time('00:00'));
 f.store.db.prepare('INSERT INTO schedule_item_tasks VALUES (?,?,0,?,?)').run(id,r.id,time('00:00'),time('00:00'));
 }
 return f;}
