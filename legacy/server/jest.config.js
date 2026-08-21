module.exports = {
  preset: 'ts-jest',
  // Node 22 globals (fetch, AbortController) that jest 26's stock node env omits.
  testEnvironment: './jest.env.js',
};