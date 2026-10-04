// Vite import suffixes seen by the Node-side type check (shared/ reaches client modules in tests).
declare module "*?worker&url" {
  const src: string;
  export default src;
}
