export function bindGlobalShortcuts({ openAddModal, state }) {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey || e.repeat) return;

    if (!state.token || document.querySelector('.modal.open')) return;

    const key = e.key.toLowerCase();
    if (key === 'k' || key === 'n') {
      e.preventDefault();
      openAddModal();
    }
  });
}