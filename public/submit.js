import { showMessage, mergeFiles, fileSelectionError } from './common.js?v=ui-20260922';

const form = document.querySelector('#request-form');
const message = document.querySelector('#message');
const fileList = document.querySelector('#file-list');
const imagePreviewList = document.querySelector('#image-preview-list');
const previewUrls = [];
const fileMessage = document.querySelector('#file-message');
const selected = { images: [], attachments: [] };
let submitting = false;

const previewDialog = document.createElement('dialog');
previewDialog.className = 'image-preview-dialog';
previewDialog.setAttribute('aria-label', '图片大图预览');
const previewDialogImage = document.createElement('img');
const previewDialogCaption = document.createElement('p');
const previewDialogClose = document.createElement('button');
previewDialogClose.type = 'button';
previewDialogClose.textContent = '关闭';
previewDialogClose.addEventListener('click', () => previewDialog.close());
previewDialog.append(previewDialogImage, previewDialogCaption, previewDialogClose);
previewDialogImage.addEventListener('error', () => {
  previewDialogImage.hidden = true;
  previewDialogCaption.textContent = previewDialogImage.alt + ' · 当前浏览器无法预览此图片，文件选择仍保留。请确认格式和内容正确。';
});
previewDialog.addEventListener('click', event => {
  const rect = previewDialog.getBoundingClientRect();
  if (event.target === previewDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) previewDialog.close();
});
document.body.append(previewDialog);

function operationId() {
  return `web-${crypto.randomUUID()}`;
}

function optionalInteger(data, field) {
  const value = String(data.get(field) || '').trim();
  return value ? Number(value) : undefined;
}

function plannerKind(productionType, subtype) {
  if (productionType === '平面') return subtype;
  return {
    产品展示: '细节',
    人物展示: '模特',
    产品加人物展示: '模特',
  }[subtype] || '待定';
}

function selectedFiles() {
  return [
    ...[...form.elements.images.files].map(file => ({ file, kind: 'image' })),
    ...[...form.elements.attachments.files].map(file => ({ file, kind: 'attachment' })),
  ];
}

function removeFile(inputName, index) {
  if (submitting) return;
  if (previewDialog.open) previewDialog.close();
  selected[inputName].splice(index, 1);
  syncFiles(inputName);
  renderFiles();
  showMessage(fileMessage, '已移除文件。');
}

function syncFiles(inputName) {
  const transfer = new DataTransfer();
  selected[inputName].forEach(file => transfer.items.add(file));
  form.elements[inputName].files = transfer.files;
}

function fileSize(file) {
  return file.size < 1024 * 1024 ? `${Math.max(1, Math.ceil(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
}

function imagePreview(file, index) {
  const url = URL.createObjectURL(file);
  previewUrls.push(url);
  const card = document.createElement('figure');
  card.className = 'image-preview-card';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'image-preview-thumb';
  open.setAttribute('aria-label', `查看大图：${file.name}`);
  const image = document.createElement('img');
  image.src = url;
  image.alt = file.name;
  image.addEventListener('error', () => {
    open.classList.add('preview-unavailable');
    image.alt = `${file.name}（浏览器无法生成预览）`;
  }, { once: true });
  open.append(image);
  open.addEventListener('click', () => {
    previewDialogImage.hidden = false;
    previewDialogImage.src = url;
    previewDialogImage.alt = file.name;
    previewDialogCaption.textContent = file.name;
    previewDialog.showModal();
  });
  const caption = document.createElement('figcaption');
  const name = document.createElement('strong');
  name.textContent = file.name;
  const size = document.createElement('small');
  size.textContent = fileSize(file);
  caption.append(name, size);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-file';
  remove.textContent = '移除';
  remove.setAttribute('aria-label', `移除图片：${file.name}`);
  remove.addEventListener('click', () => removeFile('images', index));
  card.append(open, caption, remove);
  return card;
}

function attachmentRow(file, index) {
  const row = document.createElement('div');
  row.className = 'file-row';
  const icon = document.createElement('span');
  icon.textContent = '附件';
  const name = document.createElement('strong');
  name.textContent = file.name;
  const size = document.createElement('small');
  size.textContent = fileSize(file);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-file';
  remove.textContent = '移除';
  remove.setAttribute('aria-label', `移除附件：${file.name}`);
  remove.addEventListener('click', () => removeFile('attachments', index));
  row.append(icon, name, size, remove);
  return row;
}

function renderFiles() {
  previewUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
  const images = [...form.elements.images.files];
  const attachments = [...form.elements.attachments.files];
  imagePreviewList.replaceChildren(...images.map(imagePreview));
  imagePreviewList.closest('.image-upload-box').classList.toggle('has-files', images.length > 0);
  form.elements.images.setAttribute('aria-label', images.length ? '继续添加图片' : '选择图片');
  const total = [...images, ...attachments].reduce((bytes, file) => bytes + file.size, 0);
  document.querySelector('#file-total').textContent = `${images.length + attachments.length} / 10 · ${total ? fileSize({ size: total }) : '0 MB'}`;
  const sections = [];
  if (attachments.length) {
    const attachmentSection = document.createElement('section');
    attachmentSection.className = 'selected-file-section';
    const heading = document.createElement('h3');
    heading.textContent = `附件（${attachments.length}）`;
    const rows = document.createElement('div');
    rows.className = 'attachment-list';
    rows.append(...attachments.map(attachmentRow));
    attachmentSection.append(heading, rows);
    sections.push(attachmentSection);
  }
  fileList.replaceChildren(...sections);
}

for (const inputName of ['images', 'attachments']) {
  form.elements[inputName].addEventListener('change', () => {
    const incoming = [...form.elements[inputName].files];
    const merged = mergeFiles(selected[inputName], incoming);
    const candidates = { ...selected, [inputName]: merged };
    const files = [
      ...candidates.images.map(file => ({ file, kind: 'image' })),
      ...candidates.attachments.map(file => ({ file, kind: 'attachment' })),
    ];
    const error = fileSelectionError(files);
    if (error) showMessage(fileMessage, error + ' 原有选择已保留。', 'error');
    else {
      selected[inputName] = merged;
      showMessage(fileMessage, '已选择 ' + files.length + ' 个文件。');
    }
    syncFiles(inputName);
    renderFiles();
  });
}

function updateCounts() {
  document.querySelectorAll('[data-count-for]').forEach(counter => {
    const input = form.elements[counter.dataset.countFor];
    counter.textContent = input.value.length + ' / ' + input.maxLength;
  });
}

function fieldError(input) {
  if (!input.matches('input:not([type="file"]), textarea, select')) return;
  let hint = document.getElementById('error-' + input.name);
  if (!hint) {
    hint = document.createElement('span');
    hint.className = 'field-error';
    hint.id = 'error-' + input.name;
    input.closest('label').append(hint);
    const descriptions = input.getAttribute('aria-describedby') || '';
    input.setAttribute('aria-describedby', (descriptions + ' ' + hint.id).trim());
  }
  input.setAttribute('aria-invalid', String(!input.validity.valid));
  hint.textContent = input.validity.valid ? '' : input.validity.valueMissing ? '请填写此项。' : input.validity.rangeOverflow || input.validity.rangeUnderflow ? `请输入 ${input.min}–${input.max} 之间的数值。` : '请检查填写格式。';
}
form.addEventListener('invalid', event => fieldError(event.target), true);
form.addEventListener('input', event => {
  if (event.target.hasAttribute('aria-invalid')) fieldError(event.target);
  updateCounts();
});
form.addEventListener('reset', () => {
  selected.images = [];
  selected.attachments = [];
  form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field-error').forEach(hint => { hint.textContent = ''; });
  showMessage(fileMessage, '');
  queueMicrotask(() => { renderFiles(); updateCounts(); });
});

const uploadErrors = {
  UNSUPPORTED_UPLOAD_TYPE: '有文件格式不受支持，请检查图片或附件类型。',
  UPLOAD_SIGNATURE_MISMATCH: '有文件内容与格式不符，请重新导出文件后再选择。',
  UPLOAD_SIZE_INVALID: '有文件为空或超过单个文件大小限制。',
  UPLOAD_BATCH_LIMIT: '文件数量或总容量超过限制。',
  REQUEST_TOO_LARGE: '文件超过上传大小限制。',
};

async function uploadFile({ file, kind }, requestOperationId) {
  const response = await fetch(`/api/v1/uploads?operationId=${encodeURIComponent(requestOperationId)}&kind=${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.code || 'UPLOAD_FAILED');
  return result.upload.id;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const data = new FormData(form);
  const requestOperationId = operationId();
  const files = selectedFiles();
  const selectionError = fileSelectionError(files);
  if (selectionError) {
    showMessage(message, selectionError, 'error');
    message.focus();
    return;
  }
  const productionType = form.dataset.productionType;
  const shootingSubtype = String(data.get('shootingSubtype') || '');
  const payload = {
    schemaVersion: 1,
    operationId: requestOperationId,
    productionType,
    sku: String(data.get('sku') || '').trim(),
    name: String(data.get('name') || '').trim(),
    kind: plannerKind(productionType, shootingSubtype),
    shootingSubtype,
    aspectRatio: String(data.get('aspectRatio') || '待定'),
    ...(productionType === '平面' ? { deliverableCount: optionalInteger(data, 'deliverableCount') } : {}),
    deliver: String(data.get('deliver') || '').trim(),
    requestedBy: String(data.get('requestedBy') || '').trim(),
    desiredDate: String(data.get('desiredDate') || ''),
    note: String(data.get('note') || '').trim(),
    uploadIds: [],
  };
  showMessage(message, files.length ? `正在上传 0/${files.length}…` : '正在提交…');
  submitting = true;
  form.setAttribute('aria-busy', 'true');
  const submitButton = form.querySelector('[type="submit"]');
  const buttonContent = submitButton.innerHTML;
  const enabledControls = [...form.querySelectorAll('input, select, textarea, button')].filter(control => !control.disabled);
  enabledControls.forEach(control => { control.disabled = true; });
  submitButton.textContent = '正在提交…';
  try {
    for (let index = 0; index < files.length; index += 1) {
      payload.uploadIds.push(await uploadFile(files[index], requestOperationId));
      showMessage(message, `正在上传 ${index + 1}/${files.length}…`);
    }
    const response = await fetch('/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      showMessage(message, '提交内容未通过校验，请检查填写内容。已填写的信息和文件仍然保留。', 'error');
      message.focus();
      return;
    }
    form.reset();
    renderFiles();
    showMessage(message, `需求已提交，等待排班。任务编号：${result.taskId}`, 'success');
    message.focus();
  } catch (error) {
    showMessage(message, (uploadErrors[error.message] || '暂时无法完成提交，请检查网络后重试。') + ' 已填写的信息和文件仍然保留。', 'error');
    message.focus();
  } finally {
    submitting = false;
    form.removeAttribute('aria-busy');
    enabledControls.forEach(control => { control.disabled = false; });
    submitButton.innerHTML = buttonContent;
  }
});

window.addEventListener('pagehide', () => {
  previewUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
});
