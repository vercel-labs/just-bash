/**
 * Vitest setup file: ensures DefenseInDepthBox singleton is reset between
 * test files so process-wide monkey-patches don't leak across tests.
 *
 * With `isolate: false`, test files share the same thread and module state.
 * Without this cleanup, patches from one file's Bash instance persist into
 * the next file's tests.
 */
import { afterAll, beforeAll } from "vitest";
import { DefenseInDepthBox } from "./security/defense-in-depth-box.js";

beforeAll(() => {
  DefenseInDepthBox.resetInstance();
});

afterAll(() => {
  DefenseInDepthBox.resetInstance();
});
