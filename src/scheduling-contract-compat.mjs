import { normalizeSchedulingInputClassificationV3, canonicalizeSchedulingResultClassificationV3 } from './scheduling-contract-v1.mjs';
import { normalizeSchedulingInputV1, normalizeSchedulingInputCalendarV2, canonicalizeSchedulingResultV1, canonicalizeSchedulingResultCalendarV2 } from './scheduling-contract-v1.mjs';
export function normalizeSchedulingInput(input) {
  if (input?.calendarCompilerVersion === "calendar-compiler-v3") return normalizeSchedulingInputClassificationV3(input);
  return Object.getOwnPropertyDescriptor(input ?? {}, 'calendarCompilerVersion')?.value === 'calendar-compiler-v2' ? normalizeSchedulingInputCalendarV2(input) : normalizeSchedulingInputV1(input);
}
export function canonicalizeSchedulingResult(input) {
  if (input?.calendarCompilerVersion === "calendar-compiler-v3") return canonicalizeSchedulingResultClassificationV3(input);
  return Object.getOwnPropertyDescriptor(input ?? {}, 'calendarCompilerVersion')?.value === 'calendar-compiler-v2' ? canonicalizeSchedulingResultCalendarV2(input) : canonicalizeSchedulingResultV1(input);
}
