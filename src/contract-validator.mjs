const KINDS = new Set(['模特', '细节', '场景', '待定']);
const PRODUCTION_TYPES = new Set(['平面', '视频']);
const FLAT_SUBTYPES = new Set(['模特', '细节', '场景', '待定']);
const VIDEO_SUBTYPES = new Set(['产品展示', '人物展示', '产品加人物展示']);
const ASPECT_RATIOS = new Set(['待定', '1:1', '3:4', '4:5', '9:16', '16:9']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, field, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${field} must be a non-empty string`);
}

export function normalizePlannerData(input, now = new Date().toISOString()) {
  if (!isRecord(input)) throw new TypeError('planner data must be an object');
  return {
    schemaVersion: 1,
    revision: Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
    products: Array.isArray(input.products) ? input.products : [],
    tasks: Array.isArray(input.tasks) ? input.tasks : [],
    sessions: Array.isArray(input.sessions) ? input.sessions : [],
  };
}

export function validateSnapshot(snapshot) {
  const errors = [];
  if (!isRecord(snapshot)) return ['snapshot must be an object'];
  if (snapshot.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) errors.push('revision must be a non-negative integer');
  if (typeof snapshot.updatedAt !== 'string' || Number.isNaN(Date.parse(snapshot.updatedAt))) errors.push('updatedAt must be an ISO date-time');

  if (!Array.isArray(snapshot.products)) {
    errors.push('products must be an array');
  } else {
    snapshot.products.forEach((product, index) => {
      if (!Array.isArray(product) || product.length !== 2) {
        errors.push(`products[${index}] must be a [sku, name] tuple`);
        return;
      }
      requiredText(product[0], `products[${index}][0]`, errors);
      requiredText(product[1], `products[${index}][1]`, errors);
    });
  }

  const taskIds = new Set();
  if (!Array.isArray(snapshot.tasks)) {
    errors.push('tasks must be an array');
  } else {
    snapshot.tasks.forEach((task, index) => {
      if (!isRecord(task)) {
        errors.push(`tasks[${index}] must be an object`);
        return;
      }
      for (const field of ['id', 'sku', 'name', 'client', 'deliver']) requiredText(task[field], `tasks[${index}].${field}`, errors);
      if (!KINDS.has(task.kind)) errors.push(`tasks[${index}].kind is unsupported`);
      if (taskIds.has(task.id)) errors.push(`tasks[${index}].id is duplicated`);
      taskIds.add(task.id);
    });
  }

  const sessionIds = new Set();
  if (!Array.isArray(snapshot.sessions)) {
    errors.push('sessions must be an array');
  } else {
    snapshot.sessions.forEach((session, index) => {
      if (!isRecord(session)) {
        errors.push(`sessions[${index}] must be an object`);
        return;
      }
      requiredText(session.id, `sessions[${index}].id`, errors);
      if (sessionIds.has(session.id)) errors.push(`sessions[${index}].id is duplicated`);
      sessionIds.add(session.id);
      if (!Array.isArray(session.ids) || session.ids.length === 0) {
        errors.push(`sessions[${index}].ids must contain at least one task id`);
      } else {
        session.ids.forEach(taskId => {
          if (!taskIds.has(taskId)) errors.push(`sessions[${index}] references unknown task ${taskId}`);
        });
      }
      if (!DATE.test(session.date || '')) errors.push(`sessions[${index}].date is invalid`);
      if (!TIME.test(session.start || '') || !TIME.test(session.end || '')) errors.push(`sessions[${index}] time is invalid`);
      if (TIME.test(session.start || '') && TIME.test(session.end || '') && session.start >= session.end) {
        errors.push(`sessions[${index}] end must be later than start`);
      }
      if (typeof session.place !== 'string') errors.push(`sessions[${index}].place must be a string`);
      if (typeof session.note !== 'string') errors.push(`sessions[${index}].note must be a string`);
    });
  }
  return errors;
}

export function validateSubmission(input) {
  const errors = [];
  if (!isRecord(input)) return ['submission must be an object'];
  if (input.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (typeof input.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.operationId)) {
    errors.push('operationId is invalid');
  }
  for (const field of ['sku', 'name', 'deliver', 'requestedBy']) requiredText(input[field], field, errors);
  if (!PRODUCTION_TYPES.has(input.productionType)) errors.push('productionType is unsupported');
  if (!KINDS.has(input.kind)) errors.push('kind is unsupported');
  const allowedSubtypes = input.productionType === '平面' ? FLAT_SUBTYPES : input.productionType === '视频' ? VIDEO_SUBTYPES : null;
  if (!allowedSubtypes?.has(input.shootingSubtype)) errors.push('shootingSubtype is unsupported');
  if (!ASPECT_RATIOS.has(input.aspectRatio)) errors.push('aspectRatio is unsupported');
  if (input.deliverableCount !== undefined && (!Number.isInteger(input.deliverableCount) || input.deliverableCount < 1 || input.deliverableCount > 999)) {
    errors.push('deliverableCount must be an integer between 1 and 999');
  }
  if (input.productionType === '视频' && input.deliverableCount !== undefined) errors.push('deliverableCount is not valid for video requests');
  if (input.durationSeconds !== undefined) errors.push('durationSeconds is no longer accepted');
  if (input.audioRequirement !== undefined) errors.push('audioRequirement is no longer accepted');
  for (const field of ['desiredDate', 'note']) {
    if (input[field] !== undefined && typeof input[field] !== 'string') errors.push(`${field} must be a string`);
  }
  if (input.desiredDate && !DATE.test(input.desiredDate)) errors.push('desiredDate is invalid');
  if (input.uploadIds !== undefined) {
    if (!Array.isArray(input.uploadIds) || input.uploadIds.length > 10) {
      errors.push('uploadIds must be an array with at most 10 items');
    } else if (new Set(input.uploadIds).size !== input.uploadIds.length) {
      errors.push('uploadIds must be unique');
    } else if (input.uploadIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9-]{8,160}$/.test(id))) {
      errors.push('uploadIds contains an invalid id');
    }
  }
  return errors;
}
