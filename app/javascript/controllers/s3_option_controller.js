import { Controller } from "@hotwired/stimulus"

// S3 Option Controller
// Reusable component for S3 upload checkbox with resize options
// Used by image source controllers (local, folder, web, google, pinterest)

export default class extends Controller {
  static targets = ["checkbox", "resizeOption", "resizeSelect"]

  static values = {
    enabled: { type: Boolean, default: false }
  }

  connect() {
    // Initial state - resize hidden
    if (this.hasResizeOptionTarget) {
      this.resizeOptionTarget.classList.add("hidden")
    }
  }

  // Called by parent to show/hide this component
  show() {
    this.element.classList.remove("hidden")
  }

  hide() {
    this.element.classList.add("hidden")
    this.reset()
  }

  // Toggle resize option visibility based on checkbox
  onCheckboxChange(event) {
    if (this.hasResizeOptionTarget) {
      this.resizeOptionTarget.classList.toggle("hidden", !event.target.checked)
      if (!event.target.checked && this.hasResizeSelectTarget) {
        this.resizeSelectTarget.value = "0.5"
      }
    }
  }

  // Get current values (called by parent controller)
  get isChecked() {
    return this.hasCheckboxTarget && this.checkboxTarget.checked
  }

  get resizeRatio() {
    if (!this.isChecked) return ""
    return this.hasResizeSelectTarget ? this.resizeSelectTarget.value : ""
  }

  reset() {
    if (this.hasCheckboxTarget) this.checkboxTarget.checked = false
    if (this.hasResizeOptionTarget) this.resizeOptionTarget.classList.add("hidden")
    if (this.hasResizeSelectTarget) this.resizeSelectTarget.value = "0.5"
  }
}
