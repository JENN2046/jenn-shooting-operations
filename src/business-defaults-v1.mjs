import { digestResourceCapabilitiesV1 } from './scheduling-contract-v1.mjs';
export function businessInitialResource(resourceId) {
  const capabilityJson={schemaVersion:1,capabilityIds:['FLAT']};
  return {resourceId,v1DisplayPlace:'Jenn 摄影师',status:'active',capabilityJson,capabilityDigest:digestResourceCapabilitiesV1(capabilityJson)};
}
export function businessInitialConfig(resource, effectiveFrom) {
  const windows=[{start:'09:00',end:'12:00'},{start:'13:30',end:'18:00'}];
  return {schemaVersion:2,businessTimeZone:'Asia/Shanghai',resourceCalendars:[{
    resourceId:resource.resourceId,capabilityDigest:resource.capabilityDigest,
    rules:[{effectiveFrom,weeklyWindows:[1,2,3,4,5].flatMap(weekday=>windows.map(w=>({weekday,...w}))),
      alternatingSaturday:{workingAnchorDate:'2026-10-10',windows}}],dateOverrides:[]}],
    durationFallbackRules:[['细节',60],['模特',120],['场景',90]].map(([shootingSubtype,minutes],i)=>({ruleId:`JSO-DURATION-${i+1}`,productionType:'平面',shootingSubtype,durationMs:minutes*60000})),
    bufferRules:['细节','模特','场景'].map((shootingSubtype,i)=>({ruleId:`JSO-BUFFER-${i+1}`,productionType:'平面',shootingSubtype,bufferAfterMinutes:10})),
    softScoringWeights:{LIGHTING_SWITCH:1,REFLECTIVITY_SEQUENCE:1,IDLE_GAP:1,EXPECTED_OVERRUN:1,DESIRED_DATE_MISS:1},compatibleAlgorithmVersions:['deterministic-scheduler-v1']};
}
