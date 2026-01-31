import { Controller } from "@hotwired/stimulus"
import { PinterestImageSource } from "lib/image_sources/pinterest_images"
import { WebImageSource } from "lib/image_sources/web_images"

// Pinterest Images Tab Controller
// Handles searching images via Pinterest

export default class extends Controller {
  static targets = [
    "search", "searchBtn", "status", "grid",
    "s3Option", "reuploadToS3", "resizeOption", "resizeSelect"
  ]

  static values = {
    s3Enabled: Boolean
  }

  connect() {
    this.source = new PinterestImageSource()
    this.webSource = new WebImageSource() // For S3 upload
    this.selectedImage = null
  }

  get csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || ""
  }

  // Called by parent controller when tab becomes active
  activate() {
    if (this.hasSearchTarget) this.searchTarget.focus()
  }

  configure(s3Enabled) {
    this.s3EnabledValue = s3Enabled
  }

  onSearchKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault()
      this.search()
    }
  }

  async search() {
    if (this.hasStatusTarget) this.statusTarget.textContent = "Searching..."
    if (this.hasSearchBtnTarget) this.searchBtnTarget.disabled = true
    if (this.hasGridTarget) this.gridTarget.innerHTML = ""

    const result = await this.source.search(this.searchTarget.value.trim())

    if (result.error) {
      if (this.hasStatusTarget) {
        this.statusTarget.innerHTML = `<span class="text-red-500">${result.error}</span>`
      }
    } else {
      if (this.hasStatusTarget) this.statusTarget.textContent = result.message
      if (this.hasGridTarget) {
        this.source.renderGrid(this.gridTarget, "click->pinterest-images#select")
      }
    }

    if (this.hasSearchBtnTarget) this.searchBtnTarget.disabled = false
  }

  select(event) {
    const item = event.currentTarget
    this.selectedImage = {
      url: item.dataset.url,
      thumbnail: item.dataset.thumbnail,
      title: item.dataset.title || "Image",
      source: item.dataset.source || "pinterest"
    }

    // Deselect all and select this one
    this.source.deselectAll(this.gridTarget)
    item.classList.add("ring-2", "ring-blue-500")

    // Show S3 options if enabled
    if (this.s3EnabledValue && this.hasS3OptionTarget) {
      this.s3OptionTarget.classList.remove("hidden")
    }

    // Dispatch selection event to parent
    this.dispatch("selected", {
      detail: {
        type: "external",
        url: this.selectedImage.url,
        name: this.selectedImage.title,
        alt: this.selectedImage.title.replace(/[-_]/g, " ").substring(0, 100)
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
    if (!this.selectedImage) return null

    const reuploadToS3 = this.s3EnabledValue && this.hasReuploadToS3Target && this.reuploadToS3Target.checked
    const resizeRatio = reuploadToS3 && this.hasResizeSelectTarget ? this.resizeSelectTarget.value : ""

    if (reuploadToS3) {
      const data = await this.webSource.uploadToS3(this.selectedImage.url, resizeRatio, this.csrfToken)
      return data.url
    }

    return this.selectedImage.url
  }

  reset() {
    this.source.reset()
    this.selectedImage = null
    if (this.hasSearchTarget) this.searchTarget.value = ""
    if (this.hasGridTarget) this.gridTarget.innerHTML = ""
    if (this.hasStatusTarget) this.statusTarget.textContent = "Enter keywords and click Search or press Enter"
    if (this.hasS3OptionTarget) this.s3OptionTarget.classList.add("hidden")
    if (this.hasReuploadToS3Target) this.reuploadToS3Target.checked = false
  }
}
