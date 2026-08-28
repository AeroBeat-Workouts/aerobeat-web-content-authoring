// @ts-check

/**
 * Browser harness policy: `scripts/validate-browser-authoring.js` captures page
 * console warning/error events and page errors and fails on every unexpected item.
 */
export default Object.freeze({
  testDir: "./test",
  consolePolicy: Object.freeze({ warning: "fail", error: "fail", pageError: "fail" })
});
