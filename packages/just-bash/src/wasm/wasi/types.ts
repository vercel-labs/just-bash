export interface WasiContext {
  /** Optional WASI imports for libraries that also need Preview 1 services. */
  readonly imports: WebAssembly.ModuleImports;
  /** Bind exported memory and run a WASI command's _start. */
  start(instance: WebAssembly.Instance): number;
  /** Bind exported memory and run _initialize, if exported, for a reactor. */
  initialize(instance: WebAssembly.Instance): void;
}
