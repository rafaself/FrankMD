import { Controller } from "@hotwired/stimulus"
import { LocalImageSource } from "lib/image_sources/local_images"

// Local Images Tab Controller
// Handles searching and selecting images from the server's images directory

export default class extends Controller {
  static targets = [
    "configNotice", "form", "search", "grid",
    "s3Option", "uploadToS3", "resizeOption", "resizeSelect"
  ]

  static values = {
    enabled: Boolean,
    s3Enabled: Boolean
  }

  connect() {
    this.source = new LocalImageSource()
    this.searchTimeout = null
  }

  disconnect() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout)
  }

  get csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || ""
  }

  // Called by parent controller when tab becomes active
  async activate() {
    if (this.enabledValue && this.hasGridTarget) {
      await this.loadImages()
      if (this.hasSearchTarget) this.searchTarget.focus()
    }
  }

  configure(enabled, s3Enabled) {
    this.enabledValue = enabled
    this.s3Enabled = s3Enabled

    if (this.hasConfigNoticeTarget && this.hasFormTarget) {
      this.configNoticeTarget.classList.toggle("hidden", enabled)
      this.formTarget.classList.toggle("hidden", !enabled)
    }
  }

  async loadImages(search = "") {
    const images = await this.source.load(search)
    if (!images.error && this.hasGridTarget) {
      this.source.renderGrid(images, this.gridTarget, "click->local-images#select")
    }
  }

  onSearch() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout)
    this.searchTimeout = setTimeout(() => {
      this.loadImages(this.searchTarget.value.trim())
    }, 300)
  }

  select(event) {
    const item = event.currentTarget
    const path = item.dataset.path
    const name = item.dataset.name

    // Deselect all and select this one
    this.source.deselectAll(this.gridTarget)
    item.classList.add("selected")

    // Show S3 options if enabled
    if (this.s3Enabled && this.hasS3OptionTarget) {
      this.s3OptionTarget.classList.remove("hidden")
    }

    // Dispatch selection event to parent
    this.dispatch("selected", {
      detail: {
        type: "local",
        path,
        name,
        alt: name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
      }
    })
  }

  onS3CheckboxChange(event) {
    if (this.hasResizeOptionTarget) {
      this.resizeOptionTarget.classList.toggle("hidden", !event.target.checked)
      if (!event.target.checked && this.hasResizeSelectTarget) {
        this.resizeSelectTarget.value = "0.5"
      }
    }
  }

  async getImageUrl() {
    const uploadToS3 = this.s3Enabled && this.hasUploadToS3Target && this.uploadToS3Target.checked
    const resizeRatio = uploadToS3 && this.hasResizeSelectTarget ? this.resizeSelectTarget.value : ""
    const path = this.source.selectedPath

    if (!path) return null

    if (uploadToS3) {
      const data = await this.source.uploadToS3(path, resizeRatio, this.csrfToken)
      return data.url
    }

    return `/images/preview/${encodeURIComponent(path).replace(/%2F/g, "/")}`
  }

  reset() {
    this.source.reset()
    if (this.hasSearchTarget) this.searchTarget.value = ""
    if (this.hasS3OptionTarget) this.s3OptionTarget.classList.add("hidden")
    if (this.hasUploadToS3Target) this.uploadToS3Target.checked = false
  }
}
