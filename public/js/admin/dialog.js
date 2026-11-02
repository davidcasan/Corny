import { el, showMessage } from '../dom.js';

// Janela com formulário. onSubmit recebe os valores e pode lançar erro: a mensagem aparece
// dentro da janela, que continua aberta para corrigir. Resolve com o retorno de onSubmit,
// ou null se cancelar.
//
// fields: [{ name, label, type: 'text' | 'password' | 'checkbox', value, placeholder, help, disabled, maxLength }]
export function openFormDialog({ title, hint, fields, submitLabel = 'Salvar', onSubmit }) {
  const inputs = {};
  const message = el('div', { className: 'message', role: 'status' });
  const submitBtn = el('button', { type: 'submit', className: 'btn-primary' }, submitLabel);

  const form = el('form', { className: 'modal-form', noValidate: true },
    hint && el('p', { className: 'focal-hint' }, hint),
    fields.map(field => fieldRow(field, inputs)),
    message,
    el('div', { className: 'focal-actions' },
      el('button', { type: 'button', className: 'btn-ghost', onClick: () => dialog.close() }, 'Cancelar'),
      submitBtn
    )
  );
  const dialog = el('dialog', { className: 'focal-dialog modal-dialog' }, el('h3', {}, title), form);

  return new Promise((resolve) => {
    let result = null;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([name, input]) =>
        [name, input.type === 'checkbox' ? input.checked : input.value]
      ));
      submitBtn.disabled = true;
      try {
        result = await onSubmit(values);
        dialog.close();
      } catch (err) {
        showMessage(message, err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });

    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.showModal();
    form.querySelector('input:not([disabled])')?.focus();
  });
}

// Janela só para mostrar conteúdo (ex.: histórico de partidas)
export function openDialog({ title, content }) {
  const dialog = el('dialog', { className: 'focal-dialog modal-dialog' },
    el('h3', {}, title),
    content,
    el('div', { className: 'focal-actions' },
      el('button', { type: 'button', className: 'btn-secondary', onClick: () => dialog.close() }, 'Fechar')
    )
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function fieldRow(field, inputs) {
  const id = `dialog-${field.name}`;

  if (field.type === 'checkbox') {
    const input = el('input', { type: 'checkbox', id, checked: Boolean(field.value), disabled: field.disabled });
    inputs[field.name] = input;
    return el('label', { className: 'check-row', htmlFor: id }, input, el('span', {}, field.label));
  }

  const input = el('input', {
    type: field.type || 'text',
    id,
    value: field.value ?? '',
    placeholder: field.placeholder ?? '',
    autocomplete: field.type === 'password' ? 'new-password' : 'off',
    maxLength: field.maxLength,
    disabled: field.disabled
  });
  inputs[field.name] = input;
  return el('div', {},
    el('label', { htmlFor: id }, field.label),
    input,
    field.help && el('p', { className: 'field-help' }, field.help)
  );
}
