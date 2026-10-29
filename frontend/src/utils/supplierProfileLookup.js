// Poll only recoverable preparation responses. Cancelling a form or changing its RUC
// cancels both the request and the pending wait, so an old result cannot fill a new supplier.
function waitForRetry(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("Supplier lookup cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
  });
}

export async function lookupSupplierProfile(load, { signal, onRetry = () => {}, wait = waitForRetry } = {}) {
  while (!signal?.aborted) {
    try {
      const profile = await load();
      if (signal?.aborted) throw signal.reason || new Error("Supplier lookup cancelled");
      return profile;
    } catch (error) {
      if (signal?.aborted || error.status !== 503 || error.details?.retryable === false || !error.details?.retryAfterSeconds) throw error;
      const retrySeconds = Math.max(5, Math.min(60, Number(error.details.retryAfterSeconds) || 15));
      onRetry(error, retrySeconds);
      await wait(retrySeconds * 1000, signal);
    }
  }
  throw signal.reason || new Error("Supplier lookup cancelled");
}
