export async function runWithFeedback(button, asyncFn, opts = {}) {
  const {
    spinnerMs = 1000,
    okMs = 1000,
    okHtml = "✅ OK",
    spinnerHtml = '<span class="btn-spinner"></span>',
  } = opts;

  const originalHtml = button.innerHTML;
  const originalDisabled = button.disabled;
  button.disabled = true;
  button.innerHTML = spinnerHtml;

  try {
    const [result] = await Promise.all([
      asyncFn(),
      new Promise((r) => setTimeout(r, spinnerMs)),
    ]);
    button.innerHTML = okHtml;
    await new Promise((r) => setTimeout(r, okMs));
    return result;
  } finally {
    button.innerHTML = originalHtml;
    button.disabled = originalDisabled;
  }
}
