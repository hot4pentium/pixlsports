// A dynamically imported entry can execute after `load` has already fired.
export function afterPageLoad(
  document: Pick<Document, 'readyState'>,
  window: Pick<Window, 'addEventListener'>,
  callback: () => void,
) {
  if (document.readyState === 'complete') callback();
  else window.addEventListener('load', callback, { once: true });
}
