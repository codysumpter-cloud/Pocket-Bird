(() => {
  const bridge = window.PocketBuddyDesktop;
  if (!bridge) return;

  let lastInteractive = null;
  let shadowRoot = null;

  function setInteractive(value) {
    const next = Boolean(value);
    if (next === lastInteractive) return;
    lastInteractive = next;
    bridge.setInteractive(next);
  }

  function findShadowRoot() {
    if (shadowRoot?.host?.isConnected) return shadowRoot;
    const host = document.getElementById("birb-shadow-host");
    shadowRoot = host?.shadowRoot ?? null;
    return shadowRoot;
  }

  function isInteractiveElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.id === "birb" || element.id === "pocket-buddy-custom-pet") return true;
    if (element.closest("#birb-menu, #birb-field-guide, .birb-window, .pb-window, .pb-home, .pb-toast")) return true;
    if (element.matches("button, input, select, textarea, a, [role='button']")) return true;
    const cursor = getComputedStyle(element).cursor;
    return cursor === "pointer" || cursor === "grab" || cursor === "grabbing";
  }

  function pointerIsInteractive(clientX, clientY) {
    const root = findShadowRoot();
    if (!root) return false;
    if (root.querySelector(".pb-home")) return true;
    const elements = root.elementsFromPoint?.(clientX, clientY) ?? [];
    return elements.some(isInteractiveElement);
  }

  document.addEventListener("mousemove", (event) => {
    setInteractive(pointerIsInteractive(event.clientX, event.clientY));
  }, { passive: true });

  document.addEventListener("mouseleave", () => setInteractive(false), { passive: true });
  document.addEventListener("contextmenu", (event) => event.preventDefault());

  const interval = setInterval(() => {
    if (findShadowRoot()) {
      clearInterval(interval);
      setInteractive(false);
    }
  }, 50);

  bridge.onCommand((command) => {
    const buddy = window.PocketBuddy;
    if (!buddy) return;
    if (command === "home") buddy.home?.open?.();
    else if (command === "pets") buddy.showPets?.();
    else if (command === "care") buddy.showCare?.();
    else if (command === "talk") buddy.showTalk?.();
    setTimeout(() => setInteractive(true), 0);
  });
})();
