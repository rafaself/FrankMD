import { Controller } from "@hotwired/stimulus"
import { FolderImageSource } from "lib/image_sources/folder_images"

// Folder Images Tab Controller
// Handles browsing and selecting images from local filesystem via File System Access API

export default class extends Controller {
  static targets = [
    "apiNotice", "browsePrompt", "container", "status", "grid", "search",
    "s3Option", "uploadToS3", "resizeOption", "resizeSelect"
  ]

  static values = {
    s3Enabled: Boolean
  }

  connect() {
    this.source = new FolderImageSource()
    this.searchTimeout = null
    this.selectedImage = null
  }

  disconnect() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout)
    this.source.cleanup()
  }

  get csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || ""
  }

  // Called by parent controller when tab becomes active
  activate() {
    this.setupUI()
  }

  configure(s3Enabled) {
    this.s3EnabledValue = s3Enabled
  }

  setupUI() {
    const hasApi = this.source.isSupported
    const hasFolderImages = this.source.displayedImages.length > 0

    if (this.hasApiNoticeTarget) {
      this.apiNoticeTarget.classList.toggle("hidden", hasApi)
    }
    if (this.hasBrowsePromptTarget) {
      this.browsePromptTarget.classList.toggle("hidden", !hasApi || hasFolderImages)
    }
    if (this.hasContainerTarget) {
      this.containerTarget.classList.toggle("hidden", !hasFolderImages)
    }
  }

  async browse() {
    const result = await this.source.browse()
    if (!result.error && !result.cancelled) {
      this.source.renderGrid(
        this.gridTarget,
        this.hasStatusTarget ? this.statusTarget : null,
        "click->folder-images#select",
        result.count
      )
      this.setupUI()
    }
  }

  onSearch() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout)
    this.searchTimeout = setTimeout(async () => {
      const result = await this.source.filter(this.searchTarget.value)
      this.source.renderGrid(
        this.gridTarget,
        this.hasStatusTarget ? this.statusTarget : null,
        "click->folder-images#select",
        result.total
      )
    }, 300)
  }

  select(event) {
    const index = parseInt(event.currentTarget.dataset.index)
    const image = this.source.getImage(index)
    if (!image) return

    this.selectedImage = {
      name: image.name,
      file: image.file,
      objectUrl: image.objectUrl
    }

    // Deselect all and select this one
    this.source.deselectAll(this.gridTarget)
    event.currentTarget.classList.add("selected")

    // Show S3/resize options (always shown for folder uploads)
    if (this.hasS3OptionTarget) {
      this.s3OptionTarget.classList.remove("hidden")
    }

    // Dispatch selection event to parent
    this.dispatch("selected", {
      detail: {
        type: "folder",
        name: image.name,
        alt: image.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
      }
    })
  }

  async getImageUrl() {
    if (!this.selectedImage) return null

    const uploadToS3 = this.s3EnabledValue && this.hasUploadToS3Target && this.uploadToS3Target.checked
    const resizeRatio = this.hasResizeSelectTarget ? this.resizeSelectTarget.value : ""

    const data = await this.source.upload(
      this.selectedImage.file,
      resizeRatio,
      uploadToS3,
      this.csrfToken
    )
    return data.url
  }

  reset() {
    this.source.reset()
    this.selectedImage = null
    if (this.hasSearchTarget) this.searchTarget.value = ""
    if (this.hasS3OptionTarget) this.s3OptionTarget.classList.add("hidden")
    if (this.hasUploadToS3Target) this.uploadToS3Target.checked = false
    this.setupUI()
  }
}
