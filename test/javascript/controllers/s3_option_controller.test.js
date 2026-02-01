import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Application } from "@hotwired/stimulus"
import { JSDOM } from "jsdom"
import S3OptionController from "../../../app/javascript/controllers/s3_option_controller.js"

describe("S3OptionController", () => {
  let application
  let controller
  let element

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>")
    global.window = dom.window
    global.document = dom.window.document
    global.Element = dom.window.Element
    global.HTMLElement = dom.window.HTMLElement
    global.MutationObserver = dom.window.MutationObserver

    document.body.innerHTML = `
      <div data-controller="s3-option">
        <input type="checkbox" data-s3-option-target="checkbox" />
        <div data-s3-option-target="resizeOption" class="">
          <select data-s3-option-target="resizeSelect">
            <option value="0.25">25%</option>
            <option value="0.5" selected>50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
          </select>
        </div>
      </div>
    `

    element = document.querySelector('[data-controller="s3-option"]')
    application = Application.start()
    application.register("s3-option", S3OptionController)

    return new Promise((resolve) => {
      setTimeout(() => {
        controller = application.getControllerForElementAndIdentifier(element, "s3-option")
        resolve()
      }, 0)
    })
  })

  afterEach(() => {
    application.stop()
    vi.restoreAllMocks()
  })

  describe("connect()", () => {
    it("hides resize option on connect", () => {
      expect(controller.resizeOptionTarget.classList.contains("hidden")).toBe(true)
    })
  })

  describe("show()", () => {
    it("removes hidden class from element", () => {
      element.classList.add("hidden")
      controller.show()
      expect(element.classList.contains("hidden")).toBe(false)
    })
  })

  describe("hide()", () => {
    it("adds hidden class to element", () => {
      controller.hide()
      expect(element.classList.contains("hidden")).toBe(true)
    })

    it("resets checkbox and resize option", () => {
      controller.checkboxTarget.checked = true
      controller.resizeSelectTarget.value = "0.75"
      controller.resizeOptionTarget.classList.remove("hidden")

      controller.hide()

      expect(controller.checkboxTarget.checked).toBe(false)
      expect(controller.resizeSelectTarget.value).toBe("0.5")
      expect(controller.resizeOptionTarget.classList.contains("hidden")).toBe(true)
    })
  })

  describe("onCheckboxChange()", () => {
    it("shows resize option when checkbox is checked", () => {
      controller.onCheckboxChange({ target: { checked: true } })
      expect(controller.resizeOptionTarget.classList.contains("hidden")).toBe(false)
    })

    it("hides resize option when checkbox is unchecked", () => {
      controller.resizeOptionTarget.classList.remove("hidden")
      controller.onCheckboxChange({ target: { checked: false } })
      expect(controller.resizeOptionTarget.classList.contains("hidden")).toBe(true)
    })

    it("resets resize select to default when unchecked", () => {
      controller.resizeSelectTarget.value = "0.75"
      controller.onCheckboxChange({ target: { checked: false } })
      expect(controller.resizeSelectTarget.value).toBe("0.5")
    })
  })

  describe("isChecked getter", () => {
    it("returns true when checkbox is checked", () => {
      controller.checkboxTarget.checked = true
      expect(controller.isChecked).toBe(true)
    })

    it("returns false when checkbox is unchecked", () => {
      controller.checkboxTarget.checked = false
      expect(controller.isChecked).toBe(false)
    })
  })

  describe("resizeRatio getter", () => {
    it("returns empty string when checkbox is unchecked", () => {
      controller.checkboxTarget.checked = false
      expect(controller.resizeRatio).toBe("")
    })

    it("returns select value when checkbox is checked", () => {
      controller.checkboxTarget.checked = true
      controller.resizeSelectTarget.value = "0.75"
      expect(controller.resizeRatio).toBe("0.75")
    })
  })

  describe("reset()", () => {
    it("unchecks the checkbox", () => {
      controller.checkboxTarget.checked = true
      controller.reset()
      expect(controller.checkboxTarget.checked).toBe(false)
    })

    it("hides resize option", () => {
      controller.resizeOptionTarget.classList.remove("hidden")
      controller.reset()
      expect(controller.resizeOptionTarget.classList.contains("hidden")).toBe(true)
    })

    it("resets resize select to default value", () => {
      controller.resizeSelectTarget.value = "1"
      controller.reset()
      expect(controller.resizeSelectTarget.value).toBe("0.5")
    })
  })
})

describe("S3OptionController without targets", () => {
  let application
  let controller
  let element

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>")
    global.window = dom.window
    global.document = dom.window.document
    global.Element = dom.window.Element
    global.HTMLElement = dom.window.HTMLElement
    global.MutationObserver = dom.window.MutationObserver

    document.body.innerHTML = `
      <div data-controller="s3-option">
      </div>
    `

    element = document.querySelector('[data-controller="s3-option"]')
    application = Application.start()
    application.register("s3-option", S3OptionController)

    return new Promise((resolve) => {
      setTimeout(() => {
        controller = application.getControllerForElementAndIdentifier(element, "s3-option")
        resolve()
      }, 0)
    })
  })

  afterEach(() => {
    application.stop()
  })

  it("handles missing targets gracefully on connect", () => {
    expect(controller).toBeDefined()
  })

  it("isChecked returns false when checkbox target is missing", () => {
    expect(controller.isChecked).toBe(false)
  })

  it("resizeRatio returns empty string when targets are missing", () => {
    expect(controller.resizeRatio).toBe("")
  })

  it("reset handles missing targets gracefully", () => {
    expect(() => controller.reset()).not.toThrow()
  })
})
