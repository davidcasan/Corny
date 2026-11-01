export function setupFullscreenButton(button) {
  if (!button) return;

  if (!document.fullscreenEnabled) {
    button.style.display = 'none';
    return;
  }

  button.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
}
