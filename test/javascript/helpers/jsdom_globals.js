import { JSDOM } from "jsdom"

/**
 * Creates a fresh JSDOM instance and assigns all DOM globals needed by
 * Stimulus controllers under test. This is the superset of globals used
 * across all manual-JSDOM test files (theme, locale, find-replace, s3-option).
 *
 * Returns the JSDOM instance so callers can access dom.window for further setup.
 */
export function setupJsdomGlobals() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>")
  global.window = dom.window
  global.document = dom.window.document
  global.Element = dom.window.Element
  global.HTMLElement = dom.window.HTMLElement
  global.HTMLDialogElement = dom.window.HTMLDialogElement || dom.window.HTMLElement
  global.CustomEvent = dom.window.CustomEvent
  global.MutationObserver = dom.window.MutationObserver
  global.Node = dom.window.Node
  global.getComputedStyle = dom.window.getComputedStyle
  return dom
}
