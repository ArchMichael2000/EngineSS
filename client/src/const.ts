export function startLogin() {
  window.dispatchEvent(new CustomEvent("ess:auth-requested"));
}
