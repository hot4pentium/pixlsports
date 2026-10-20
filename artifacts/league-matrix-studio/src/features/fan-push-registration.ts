/** Preview push must not install the production offline shell over Vite. */
export async function fanPushRegistration(): Promise<ServiceWorkerRegistration> {
  if (import.meta.env.PROD) return withTimeout(navigator.serviceWorker.ready);
  const base = import.meta.env.BASE_URL;
  const registration = await navigator.serviceWorker.register(`${base}preview-push-sw.js`, {
    scope: `${base}__push/`,
    updateViaCache: 'none',
  });
  if (registration.active) return registration;
  const worker = registration.installing ?? registration.waiting;
  if (!worker) throw new Error('The notification service could not start. Please try again.');
  return withTimeout(new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const changed = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', changed);
        if (worker.state === 'activated') resolve(registration);
        else reject(new Error('The notification service could not start. Please try again.'));
      }
    };
    worker.addEventListener('statechange', changed);
    changed();
  }));
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The notification service took too long to start. Please try again.')), 20_000);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
