/**
 * Custom jest environment: jest 26's sandboxed `node` VM omits Node 18+ web
 * globals (`fetch`, `AbortController`, …) that the Node 22 runtime provides
 * natively. This environment module runs in the host realm (real Node 22), so
 * it can copy those globals into the test sandbox — letting the LLM client's
 * `fetch`/`AbortController`-based code run under test exactly as in production.
 *
 * Remove if/when jest is upgraded to a version whose node environment already
 * exposes these globals.
 */
const NodeEnvironment = require('jest-environment-node');

const HOST_GLOBALS = [
  'fetch',
  'Headers',
  'Request',
  'Response',
  'AbortController',
  'AbortSignal',
];

module.exports = class CodeaiNodeEnvironment extends NodeEnvironment {
  async setup() {
    await super.setup();
    for (const name of HOST_GLOBALS) {
      if (this.global[name] === undefined && global[name] !== undefined) {
        this.global[name] = global[name];
      }
    }
  }
};
