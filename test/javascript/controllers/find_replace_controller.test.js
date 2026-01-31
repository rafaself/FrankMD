import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Application } from "@hotwired/stimulus"
import { JSDOM } from "jsdom"
import FindReplaceController from "../../../app/javascript/controllers/find_replace_controller.js"

describe("FindReplaceController", () => {
  let application
  let controller
  let element
  let textarea

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>")
    global.window = dom.window
    global.document = dom.window.document
    global.Element = dom.window.Element
    global.HTMLElement = dom.window.HTMLElement
    global.HTMLDialogElement = dom.window.HTMLDialogElement || dom.window.HTMLElement
    global.CustomEvent = dom.window.CustomEvent
    global.getComputedStyle = dom.window.getComputedStyle
    global.MutationObserver = dom.window.MutationObserver
    global.Node = dom.window.Node

    window.t = vi.fn((key, options = {}) => {
      if (key === "dialogs.find_replace.match_count") {
        return `${options.current} of ${options.total}`
      }
      if (key === "dialogs.find_replace.no_results") {
        return "No results"
      }
      return key
    })

    document.body.innerHTML = `
      <textarea id="editor"></textarea>
      <div data-controller="find-replace">
        <dialog data-find-replace-target="dialog"></dialog>
        <input data-find-replace-target="findInput" />
        <div data-find-replace-target="replaceSection"></div>
        <input data-find-replace-target="replaceInput" />
        <button data-find-replace-target="tabFind"></button>
        <button data-find-replace-target="tabReplace"></button>
        <span data-find-replace-target="matchCount"></span>
        <div data-find-replace-target="miniBar"></div>
        <span data-find-replace-target="miniCount"></span>
        <span data-find-replace-target="miniModeLabel"></span>
        <button data-find-replace-target="caseSensitiveToggle"></button>
        <button data-find-replace-target="regexToggle"></button>
      </div>
    `

    HTMLDialogElement.prototype.show = vi.fn(function () {
      this.open = true
    })
    HTMLDialogElement.prototype.showModal = vi.fn(function () {
      this.open = true
    })
    HTMLDialogElement.prototype.close = vi.fn(function () {
      this.open = false
    })

    element = document.querySelector('[data-controller="find-replace"]')
    textarea = document.getElementById("editor")
    application = Application.start()
    application.register("find-replace", FindReplaceController)

    return new Promise((resolve) => {
      setTimeout(() => {
        controller = application.getControllerForElementAndIdentifier(element, "find-replace")
        resolve()
      }, 0)
    })
  })

  afterEach(() => {
    application.stop()
    vi.restoreAllMocks()
  })

  it("initializes state on connect", () => {
    expect(controller.matches).toEqual([])
    expect(controller.currentMatchIndex).toBe(-1)
    expect(controller.activeTab).toBe("find")
  })

  it("opens dialog in replace tab", () => {
    controller.open({ textarea, tab: "replace" })

    expect(controller.dialogTarget.open).toBe(true)
    expect(controller.activeTab).toBe("replace")
    expect(controller.replaceSectionTarget.classList.contains("hidden")).toBe(false)
  })

  it("finds matches and updates count", () => {
    textarea.value = "Hello hello"
    controller.textareaRef = textarea
    controller.findInputTarget.value = "hello"

    controller.findAll()

    expect(controller.matches.length).toBe(2)
    expect(controller.matchCountTarget.textContent).toBe("1 of 2")
  })

  it("dispatches jump on find next", () => {
    textarea.value = "one one"
    controller.textareaRef = textarea
    controller.findInputTarget.value = "one"
    controller.findAll()

    const dispatchSpy = vi.spyOn(controller, "dispatch")
    controller.findNext()

    expect(dispatchSpy).toHaveBeenCalledWith("jump", {
      detail: { start: 0, end: 3 }
    })
  })

  it("dispatches replace with resolved regex groups", () => {
    textarea.value = "foo-bar"
    controller.textareaRef = textarea
    controller.findInputTarget.value = "(\\w+)-(\\w+)"
    controller.replaceInputTarget.value = "$2-$1"
    controller.useRegexValue = true
    controller.findAll()

    const dispatchSpy = vi.spyOn(controller, "dispatch")
    controller.replaceCurrent()

    expect(dispatchSpy).toHaveBeenCalledWith("replace", {
      detail: { start: 0, end: 7, replacement: "bar-foo" }
    })
  })

  it("dispatches replace-all with updated text", () => {
    textarea.value = "a a"
    controller.textareaRef = textarea
    controller.findInputTarget.value = "a"
    controller.replaceInputTarget.value = "b"
    controller.findAll()

    const dispatchSpy = vi.spyOn(controller, "dispatch")
    controller.replaceAll()

    expect(dispatchSpy).toHaveBeenCalledWith("replace-all", expect.objectContaining({
      detail: expect.objectContaining({ updatedText: "b b" })
    }))
  })
})
