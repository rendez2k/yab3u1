const esc = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/** Shared object controls for the converter and Full Spectrum. */
export function quantityRows(objects, quantities = {}) {
  return objects.map(f => {
    const count = quantities[f.objectId] ?? 1;
    const name = esc(f.name);
    return `<div class="object-quantity"><span>${name}${f.instances > 1 ? ` <small>· ${f.instances} linked instances</small>` : ''}</span><div class="quantity-actions"><input aria-label="Quantity for ${name}" data-object="${esc(f.objectId)}" type="number" min="0" max="64" step="1" value="${count}"><button type="button" data-quantity="add" aria-label="Add copy of ${name}">Add copy</button><button type="button" data-quantity="remove" aria-label="Remove ${name}">Remove</button><button type="button" data-quantity="restore" aria-label="Restore ${name}"${count !== 0 ? ' hidden' : ''}>Restore</button></div></div>`;
  }).join('');
}

export function syncQuantityButtons(host) {
  host.querySelectorAll('.object-quantity').forEach(row => {
    const count = Number(row.querySelector('input').value);
    row.querySelector('[data-quantity="restore"]').hidden = count !== 0;
    row.querySelector('[data-quantity="remove"]').hidden = count === 0;
    row.querySelector('[data-quantity="add"]').disabled = count >= 64;
  });
}
export function bindQuantityButtons(host) {
  const sync = () => syncQuantityButtons(host);
  host.addEventListener('click', event => {
    const button = event.target.closest('[data-quantity]');
    if (!button) return;
    const input = button.closest('.object-quantity').querySelector('input');
    input.value = button.dataset.quantity === 'remove' ? 0 : button.dataset.quantity === 'restore' ? 1 : Math.min(64, (Number(input.value) || 0) + 1);
    input.dispatchEvent(new Event('input', {bubbles:true}));
    sync();
  });
  host.addEventListener('input', sync);
  new MutationObserver(sync).observe(host, {childList:true});
}
