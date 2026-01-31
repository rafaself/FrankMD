import { Controller } from "@hotwired/stimulus"
import { LocalImageSource } from "lib/image_sources/local_images"
import { FolderImageSource } from "lib/image_sources/folder_images"
import { WebImageSource } from "lib/image_sources/web_images"
import { GoogleImageSource } from "lib/image_sources/google_images"
import { PinterestImageSource } from "lib/image_sources/pinterest_images"
import { AiImageSource } from "lib/image_sources/ai_images"
import { encodePath } from "lib/url_utils"

// Image Picker Controller
// Orchestrates image selection from multiple sources
// Each source is handled by its own module for separation of concerns

export default class extends Controller {
  static targets = [
    // Dialog
    "imageDialog",
    // Common controls
    "imageOptions", "selectedImageName", "imageAlt", "imageLink",
    "imageLoading", "imageLoadingText", "insertImageBtn",
    // S3 options
    "s3Option", "uploadToS3", "resizeOptionLocal", "resizeSelectLocal",
    "s3ExternalOption", "reuploadToS3", "resizeOptionExternal", "resizeSelectExternal",
    "s3FolderOption", "uploadFolderToS3", "resizeOptionFolder", "resizeSelectFolder",
    // Tab buttons
    "imageTabLocal", "imageTabFolder", "imageTabWeb", "imageTabGoogle", "imageTabPinterest", "imageTabAi",
    // Tab panels
    "imageLocalPanel", "imageFolderPanel", "imageWebPanel", "imageGooglePanel", "imagePinterestPanel", "imageAiPanel",
    // Local images
    "imageSearch", "imageGrid", "localImagesForm", "localImagesConfigNotice",
    // Folder images
    "folderApiNotice", "browsePrompt", "localFolderContainer", "localFolderStatus", "localFolderGrid", "folderImageSearch",
    // Web images
    "webImageSearch", "webSearchBtn", "webImageStatus", "webImageGrid",
    // Google images
    "googleImageSearch", "googleSearchBtn", "googleImageStatus", "googleImageGrid",
    "googleImagesConfigNotice", "googleImagesForm",
    // Pinterest images
    "pinterestImageSearch", "pinterestSearchBtn", "pinterestImageStatus", "pinterestImageGrid",
    // AI images
    "aiImageConfigNotice", "aiImageForm", "aiImageModel", "aiImagePrompt",
    "aiImageGenerateBtn", "aiImageProcessing", "aiImageProcessingModel",
    "aiImageResult", "aiImagePreview", "aiImageRevisedPromptContainer", "aiImageRevisedPrompt",
    "aiImageSaveLocal", "aiImageSaveS3", "aiImageS3OptionContainer",
    "aiRefImageSection", "aiRefImagePreviewContainer", "aiRefImagePreview",
    "aiRefImageName", "aiRefImagePicker", "aiRefImageSearch", "aiRefImageGrid"
  ]

  connect() {
    // Initialize image sources
    this.localImages = new LocalImageSource()
    this.folderImages = new FolderImageSource()
    this.webImages = new WebImageSource()
    this.googleImages = new GoogleImageSource()
    this.pinterestImages = new PinterestImageSource()
    this.aiImages = new AiImageSource()

    // State
    this.imagesEnabled = false
    this.s3Enabled = false
    this.selectedImage = null
    this.currentTab = "local"
    this.searchTimeout = null

    // Load configuration
    this.loadConfig()
  }

  disconnect() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout)
    this.folderImages.cleanup()
    this.aiImages.abort()
  }

  get csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]')
    return meta ? meta.content : ""
  }

  // Configuration
  async loadConfig() {
    try {
      const response = await fetch("/images/config", {
        headers: { "Accept": "application/json" }
      })
      if (response.ok) {
        const config = await response.json()
        this.imagesEnabled = config.enabled
        this.s3Enabled = config.s3_enabled
        this.googleImages.enabled = config.google_enabled
      }
    } catch (error) {
      console.error("Error loading images config:", error)
    }

    await this.aiImages.loadConfig()
  }

  // Open dialog
  async open() {
    this.resetAll()
    this.setupUI()
    this.switchImageTab({ currentTarget: { dataset: { tab: "local" } } })

    if (this.imagesEnabled) {
      await this.loadLocalImages()
    }

    this.imageDialogTarget.showModal()
  }

  close() {
    this.folderImages.cleanup()
    this.imageDialogTarget.close()
  }

  closeImageDialog() {
    this.close()
  }

  resetAll() {
    this.selectedImage = null
    this.currentTab = "local"

    // Reset sources
    this.localImages.reset()
    this.folderImages.reset()
    this.webImages.reset()
    this.googleImages.reset()
    this.pinterestImages.reset()
    this.aiImages.reset()

    // Reset inputs
    if (this.hasImageSearchTarget) this.imageSearchTarget.value = ""
    if (this.hasWebImageSearchTarget) this.webImageSearchTarget.value = ""
    if (this.hasGoogleImageSearchTarget) this.googleImageSearchTarget.value = ""
    if (this.hasPinterestImageSearchTarget) this.pinterestImageSearchTarget.value = ""
    if (this.hasAiImagePromptTarget) this.aiImagePromptTarget.value = ""
    if (this.hasFolderImageSearchTarget) this.folderImageSearchTarget.value = ""
    if (this.hasAiRefImageSearchTarget) this.aiRefImageSearchTarget.value = ""

    // Reset grids
    if (this.hasWebImageGridTarget) this.webImageGridTarget.innerHTML = ""
    if (this.hasGoogleImageGridTarget) this.googleImageGridTarget.innerHTML = ""
    if (this.hasPinterestImageGridTarget) this.pinterestImageGridTarget.innerHTML = ""
    if (this.hasAiRefImageGridTarget) this.aiRefImageGridTarget.innerHTML = ""

    // Reset status messages
    if (this.hasWebImageStatusTarget) this.webImageStatusTarget.textContent = "Enter keywords and click Search or press Enter"
    if (this.hasGoogleImageStatusTarget) this.googleImageStatusTarget.textContent = "Enter keywords and click Search or press Enter"
    if (this.hasPinterestImageStatusTarget) this.pinterestImageStatusTarget.textContent = "Enter keywords and click Search or press Enter"

    // Reset AI UI
    if (this.hasAiImageProcessingTarget) this.aiImageProcessingTarget.classList.add("hidden")
    if (this.hasAiImageResultTarget) this.aiImageResultTarget.classList.add("hidden")
    if (this.hasAiImageGenerateBtnTarget) this.aiImageGenerateBtnTarget.disabled = false
    if (this.hasAiRefImagePreviewContainerTarget) this.aiRefImagePreviewContainerTarget.classList.add("hidden")
    if (this.hasAiRefImagePickerTarget) this.aiRefImagePickerTarget.classList.remove("hidden")

    // Reset options
    this.imageAltTarget.value = ""
    this.imageLinkTarget.value = ""
    this.imageOptionsTarget.classList.add("hidden")
    this.insertImageBtnTarget.disabled = true

    // Reset S3 options
    if (this.hasS3OptionTarget) this.s3OptionTarget.classList.add("hidden")
    if (this.hasS3ExternalOptionTarget) this.s3ExternalOptionTarget.classList.add("hidden")
    if (this.hasS3FolderOptionTarget) this.s3FolderOptionTarget.classList.add("hidden")
    if (this.hasUploadToS3Target) this.uploadToS3Target.checked = false
    if (this.hasReuploadToS3Target) this.reuploadToS3Target.checked = false
    if (this.hasUploadFolderToS3Target) this.uploadFolderToS3Target.checked = false
  }

  setupUI() {
    // Local images config notice
    if (this.hasLocalImagesConfigNoticeTarget && this.hasLocalImagesFormTarget) {
      this.localImagesConfigNoticeTarget.classList.toggle("hidden", this.imagesEnabled)
      this.localImagesFormTarget.classList.toggle("hidden", !this.imagesEnabled)
    }

    // Folder picker UI
    this.setupFolderPickerUI()

    // Google config notice
    if (this.hasGoogleImagesConfigNoticeTarget && this.hasGoogleImagesFormTarget) {
      this.googleImagesConfigNoticeTarget.classList.toggle("hidden", this.googleImages.enabled)
      this.googleImagesFormTarget.classList.toggle("hidden", !this.googleImages.enabled)
    }

    // AI config notice
    if (this.hasAiImageConfigNoticeTarget && this.hasAiImageFormTarget) {
      this.aiImageConfigNoticeTarget.classList.toggle("hidden", this.aiImages.enabled)
      this.aiImageFormTarget.classList.toggle("hidden", !this.aiImages.enabled)
    }
    if (this.hasAiImageS3OptionContainerTarget) {
      this.aiImageS3OptionContainerTarget.classList.toggle("hidden", !this.s3Enabled)
    }
    if (this.hasAiImageModelTarget && this.aiImages.model) {
      this.aiImageModelTarget.textContent = this.aiImages.model
    }
    if (this.hasAiRefImageSectionTarget) {
      this.aiRefImageSectionTarget.classList.toggle("hidden", !this.imagesEnabled)
    }
  }

  setupFolderPickerUI() {
    const hasApi = this.folderImages.isSupported
    const hasFolderImages = this.folderImages.displayedImages.length > 0

    if (this.hasFolderApiNoticeTarget) {
      this.folderApiNoticeTarget.classList.toggle("hidden", hasApi)
    }
    if (this.hasBrowsePromptTarget) {
      this.browsePromptTarget.classList.toggle("hidden", !hasApi || hasFolderImages)
    }
    if (this.hasLocalFolderContainerTarget) {
      this.localFolderContainerTarget.classList.toggle("hidden", !hasFolderImages)
    }
  }

  // Tab switching
  switchImageTab(event) {
    const tab = event.currentTarget.dataset.tab
    this.currentTab = tab

    const activeClasses = "border-[var(--theme-accent)] text-[var(--theme-accent)]"
    const inactiveClasses = "border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"

    const tabs = ["Local", "Folder", "Web", "Google", "Pinterest", "Ai"]
    tabs.forEach(t => {
      const target = this[`hasImageTab${t}Target`] ? this[`imageTab${t}Target`] : null
      if (target) {
        target.className = `px-4 py-2 text-sm font-medium border-b-2 ${tab === t.toLowerCase() ? activeClasses : inactiveClasses}`
      }
    })

    // Show/hide panels
    const panels = ["Local", "Folder", "Web", "Google", "Pinterest", "Ai"]
    panels.forEach(p => {
      const target = this[`hasImage${p}PanelTarget`] ? this[`image${p}PanelTarget`] : null
      if (target) {
        target.classList.toggle("hidden", tab !== p.toLowerCase())
      }
    })

    // Focus appropriate input
    if (tab === "local" && this.hasImageSearchTarget && this.imagesEnabled) {
      this.imageSearchTarget.focus()
    } else if (tab === "web" && this.hasWebImageSearchTarget) {
      this.webImageSearchTarget.focus()
    } else if (tab === "google" && this.hasGoogleImageSearchTarget && this.googleImages.enabled) {
      this.googleImageSearchTarget.focus()
    } else if (tab === "pinterest" && this.hasPinterestImageSearchTarget) {
      this.pinterestImageSearchTarget.focus()
    } else if (tab === "ai" && this.hasAiImagePromptTarget && this.aiImages.enabled) {
      this.aiImagePromptTarget.focus()
      if (this.imagesEnabled && this.hasAiRefImageGridTarget && !this.aiRefImageGridTarget.innerHTML.trim()) {
        this.loadAiRefImages()
      }
    }
  }

  // Deselect all images across all sources
  deselectAllImages() {
    this.localImages.deselectAll(this.hasImageGridTarget ? this.imageGridTarget : null)
    this.folderImages.deselectAll(this.hasLocalFolderGridTarget ? this.localFolderGridTarget : null)
    this.webImages.deselectAll(this.hasWebImageGridTarget ? this.webImageGridTarget : null)
    this.googleImages.deselectAll(this.hasGoogleImageGridTarget ? this.googleImageGridTarget : null)
    this.pinterestImages.deselectAll(this.hasPinterestImageGridTarget ? this.pinterestImageGridTarget : null)
  }

  // LOCAL IMAGES
  async loadLocalImages(search = "") {
    const images = await this.localImages.load(search)
    if (!images.error) {
      this.localImages.renderGrid(images, this.imageGridTarget, "click->image-picker#selectImage")
    }
  }

  onImageSearch() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout)
    this.searchTimeout = setTimeout(() => {
      this.loadLocalImages(this.imageSearchTarget.value.trim())
    }, 300)
  }

  selectImage(event) {
    const item = event.currentTarget
    const path = item.dataset.path
    const name = item.dataset.name

    this.deselectAllImages()
    item.classList.add("selected")
    this.selectedImage = { path, name, type: "local" }

    this.showImageOptions(name)
    if (this.s3Enabled && this.hasS3OptionTarget) {
      this.s3OptionTarget.classList.remove("hidden")
    }
    if (this.hasS3ExternalOptionTarget) this.s3ExternalOptionTarget.classList.add("hidden")
    if (this.hasS3FolderOptionTarget) this.s3FolderOptionTarget.classList.add("hidden")

    this.imageAltTarget.value = name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
  }

  // FOLDER IMAGES
  async browseLocalFolder() {
    const result = await this.folderImages.browse()
    if (!result.error && !result.cancelled) {
      this.folderImages.renderGrid(
        this.localFolderGridTarget,
        this.hasLocalFolderStatusTarget ? this.localFolderStatusTarget : null,
        "click->image-picker#selectLocalFolderImage",
        result.count
      )
      this.setupFolderPickerUI()
    }
  }

  onFolderImageSearch() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout)
    this.searchTimeout = setTimeout(async () => {
      const result = await this.folderImages.filter(this.folderImageSearchTarget.value)
      this.folderImages.renderGrid(
        this.localFolderGridTarget,
        this.hasLocalFolderStatusTarget ? this.localFolderStatusTarget : null,
        "click->image-picker#selectLocalFolderImage",
        result.total
      )
    }, 300)
  }

  selectLocalFolderImage(event) {
    const index = parseInt(event.currentTarget.dataset.index)
    const image = this.folderImages.getImage(index)
    if (!image) return

    this.deselectAllImages()
    event.currentTarget.classList.add("selected")
    this.selectedImage = {
      name: image.name,
      file: image.file,
      objectUrl: image.objectUrl,
      type: "local-folder"
    }

    this.showImageOptions(image.name)
    if (this.hasS3OptionTarget) this.s3OptionTarget.classList.add("hidden")
    if (this.hasS3ExternalOptionTarget) this.s3ExternalOptionTarget.classList.add("hidden")
    if (this.hasS3FolderOptionTarget) this.s3FolderOptionTarget.classList.remove("hidden")

    this.imageAltTarget.value = image.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
  }

  onS3FolderCheckboxChange() {
    // Resize is always shown for folder uploads
  }

  // WEB IMAGES
  onWebImageSearchKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault()
      this.searchWebImages()
    }
  }

  async searchWebImages() {
    this.webImageStatusTarget.textContent = "Searching..."
    if (this.hasWebSearchBtnTarget) this.webSearchBtnTarget.disabled = true

    const result = await this.webImages.search(this.webImageSearchTarget.value.trim())

    if (result.error) {
      this.webImageStatusTarget.innerHTML = `<span class="text-red-500">${result.error}</span>`
    } else {
      this.webImageStatusTarget.textContent = result.message
      this.webImages.renderGrid(this.webImageGridTarget, "click->image-picker#selectExternalImage")
    }

    if (this.hasWebSearchBtnTarget) this.webSearchBtnTarget.disabled = false
  }

  // GOOGLE IMAGES
  onGoogleImageSearchKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault()
      this.searchGoogleImages()
    }
  }

  async searchGoogleImages() {
    this.googleImageStatusTarget.textContent = "Searching..."
    if (this.hasGoogleSearchBtnTarget) this.googleSearchBtnTarget.disabled = true
    this.googleImageGridTarget.innerHTML = ""

    const result = await this.googleImages.search(this.googleImageSearchTarget.value.trim())

    if (result.error) {
      this.googleImageStatusTarget.innerHTML = `<span class="text-red-500">${result.error}</span>`
    } else {
      this.googleImageStatusTarget.textContent = result.message
      this.googleImages.renderGrid(this.googleImageGridTarget, "click->image-picker#selectExternalImage")
    }

    if (this.hasGoogleSearchBtnTarget) this.googleSearchBtnTarget.disabled = false
  }

  onGoogleImageScroll(event) {
    const container = event.target
    const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight

    if (this.googleImages.shouldLoadMore(scrollBottom)) {
      this.loadMoreGoogleImages()
    }
  }

  async loadMoreGoogleImages() {
    const result = await this.googleImages.loadMore()
    if (!result.error) {
      this.googleImageStatusTarget.textContent = result.message
      this.googleImages.renderGrid(this.googleImageGridTarget, "click->image-picker#selectExternalImage")
    }
  }

  // PINTEREST IMAGES
  onPinterestImageSearchKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault()
      this.searchPinterestImages()
    }
  }

  async searchPinterestImages() {
    this.pinterestImageStatusTarget.textContent = "Searching..."
    if (this.hasPinterestSearchBtnTarget) this.pinterestSearchBtnTarget.disabled = true
    this.pinterestImageGridTarget.innerHTML = ""

    const result = await this.pinterestImages.search(this.pinterestImageSearchTarget.value.trim())

    if (result.error) {
      this.pinterestImageStatusTarget.innerHTML = `<span class="text-red-500">${result.error}</span>`
    } else {
      this.pinterestImageStatusTarget.textContent = result.message
      this.pinterestImages.renderGrid(this.pinterestImageGridTarget, "click->image-picker#selectExternalImage")
    }

    if (this.hasPinterestSearchBtnTarget) this.pinterestSearchBtnTarget.disabled = false
  }

  // EXTERNAL IMAGE SELECTION (shared by Web, Google, Pinterest)
  selectExternalImage(event) {
    const item = event.currentTarget
    const url = item.dataset.url
    const thumbnail = item.dataset.thumbnail
    const title = item.dataset.title || "Image"
    const source = item.dataset.source || "external"

    this.deselectAllImages()
    item.classList.add("ring-2", "ring-blue-500")
    this.selectedImage = { url, thumbnail, title, source, type: "external" }

    this.showImageOptions(title)
    if (this.hasS3OptionTarget) this.s3OptionTarget.classList.add("hidden")
    if (this.hasS3FolderOptionTarget) this.s3FolderOptionTarget.classList.add("hidden")
    if (this.s3Enabled && this.hasS3ExternalOptionTarget) {
      this.s3ExternalOptionTarget.classList.remove("hidden")
    }

    this.imageAltTarget.value = title.replace(/[-_]/g, " ").substring(0, 100)
  }

  // AI IMAGES
  onAiImagePromptKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      this.generateAiImage()
    }
  }

  async generateAiImage() {
    const prompt = this.aiImagePromptTarget.value.trim()

    // Show processing UI
    if (this.hasAiImageProcessingTarget) this.aiImageProcessingTarget.classList.remove("hidden")
    if (this.hasAiImageProcessingModelTarget) {
      this.aiImageProcessingModelTarget.textContent = this.aiImages.model || "imagen-4.0-generate-001"
    }
    if (this.hasAiImageGenerateBtnTarget) this.aiImageGenerateBtnTarget.disabled = true
    if (this.hasAiImageResultTarget) this.aiImageResultTarget.classList.add("hidden")

    // ESC to cancel
    const escHandler = (e) => {
      if (e.key === "Escape") this.aiImages.abort()
    }
    document.addEventListener("keydown", escHandler)

    const result = await this.aiImages.generate(prompt, this.csrfToken)

    document.removeEventListener("keydown", escHandler)

    // Hide processing UI
    if (this.hasAiImageProcessingTarget) this.aiImageProcessingTarget.classList.add("hidden")
    if (this.hasAiImageGenerateBtnTarget) this.aiImageGenerateBtnTarget.disabled = false

    if (result.error) {
      alert(result.error)
      return
    }

    if (result.cancelled) return

    // Show result
    if (this.hasAiImagePreviewTarget) {
      this.aiImagePreviewTarget.src = result.previewSrc
    }

    if (this.hasAiImageRevisedPromptContainerTarget && this.hasAiImageRevisedPromptTarget) {
      if (result.imageData.revised_prompt) {
        this.aiImageRevisedPromptTarget.textContent = result.imageData.revised_prompt
        this.aiImageRevisedPromptContainerTarget.classList.remove("hidden")
      } else {
        this.aiImageRevisedPromptContainerTarget.classList.add("hidden")
      }
    }

    if (this.hasAiImageResultTarget) this.aiImageResultTarget.classList.remove("hidden")

    this.selectedImage = {
      type: "ai-generated",
      name: `ai_${Date.now()}.png`,
      title: prompt.substring(0, 50)
    }

    this.showImageOptions("AI Generated Image")
    if (this.hasS3OptionTarget) this.s3OptionTarget.classList.add("hidden")
    if (this.hasS3ExternalOptionTarget) this.s3ExternalOptionTarget.classList.add("hidden")
    if (this.hasS3FolderOptionTarget) this.s3FolderOptionTarget.classList.add("hidden")

    this.imageAltTarget.value = prompt.length > 100 ? prompt.substring(0, 100) + "..." : prompt
  }

  async loadAiRefImages(search = "") {
    if (!this.imagesEnabled || !this.hasAiRefImageGridTarget) return

    const images = await this.aiImages.loadRefImages(search)
    if (!images.error) {
      this.aiImages.renderRefImageGrid(images, this.aiRefImageGridTarget, "click->image-picker#selectAiRefImage")
    }
  }

  onAiRefImageSearch() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout)
    this.searchTimeout = setTimeout(() => {
      this.loadAiRefImages(this.aiRefImageSearchTarget.value.trim())
    }, 300)
  }

  selectAiRefImage(event) {
    const button = event.currentTarget
    const path = button.dataset.path
    const name = button.dataset.name

    this.aiImages.setRefImage(path, name)

    if (this.hasAiRefImagePreviewTarget) {
      this.aiRefImagePreviewTarget.src = `/images/preview/${encodePath(path)}`
    }
    if (this.hasAiRefImageNameTarget) {
      this.aiRefImageNameTarget.textContent = name
    }
    if (this.hasAiRefImagePreviewContainerTarget) {
      this.aiRefImagePreviewContainerTarget.classList.remove("hidden")
    }
    if (this.hasAiRefImagePickerTarget) {
      this.aiRefImagePickerTarget.classList.add("hidden")
    }
  }

  clearAiRefImage() {
    this.aiImages.clearRefImage()

    if (this.hasAiRefImagePreviewContainerTarget) {
      this.aiRefImagePreviewContainerTarget.classList.add("hidden")
    }
    if (this.hasAiRefImagePickerTarget) {
      this.aiRefImagePickerTarget.classList.remove("hidden")
    }
    if (this.hasAiRefImageSearchTarget) {
      this.aiRefImageSearchTarget.value = ""
    }
    this.loadAiRefImages()
  }

  // COMMON HELPERS
  showImageOptions(name) {
    this.imageOptionsTarget.classList.remove("hidden")
    this.selectedImageNameTarget.textContent = name
    this.insertImageBtnTarget.disabled = false
  }

  showImageLoading(message) {
    if (this.hasImageLoadingTarget) {
      this.imageLoadingTarget.classList.remove("hidden")
      this.imageLoadingTarget.classList.add("flex")
    }
    if (this.hasImageLoadingTextTarget) {
      this.imageLoadingTextTarget.textContent = message
    }
  }

  hideImageLoading() {
    if (this.hasImageLoadingTarget) {
      this.imageLoadingTarget.classList.add("hidden")
      this.imageLoadingTarget.classList.remove("flex")
    }
  }

  onS3CheckboxChange(event) {
    if (this.hasResizeOptionLocalTarget) {
      this.resizeOptionLocalTarget.classList.toggle("hidden", !event.target.checked)
      if (!event.target.checked && this.hasResizeSelectLocalTarget) {
        this.resizeSelectLocalTarget.value = "0.5"
      }
    }
  }

  onS3ExternalCheckboxChange(event) {
    if (this.hasResizeOptionExternalTarget) {
      this.resizeOptionExternalTarget.classList.toggle("hidden", !event.target.checked)
      if (!event.target.checked && this.hasResizeSelectExternalTarget) {
        this.resizeSelectExternalTarget.value = "0.5"
      }
    }
  }

  // INSERT IMAGE
  async insertImage() {
    if (!this.selectedImage) return

    let imageUrl

    try {
      if (this.selectedImage.type === "local") {
        imageUrl = await this.insertLocalImage()
      } else if (this.selectedImage.type === "local-folder") {
        imageUrl = await this.insertFolderImage()
      } else if (this.selectedImage.type === "ai-generated") {
        imageUrl = await this.insertAiImage()
      } else {
        imageUrl = await this.insertExternalImage()
      }
    } catch (error) {
      console.error("Error inserting image:", error)
      alert(`Failed to insert image: ${error.message}`)
      this.hideImageLoading()
      this.insertImageBtnTarget.disabled = false
      return
    }

    if (!imageUrl) return

    // Build markdown
    const altText = this.imageAltTarget.value.trim() || this.selectedImage.name || this.selectedImage.title || "Image"
    const linkUrl = this.imageLinkTarget.value.trim()

    let markdown = `![${altText}](${imageUrl})`
    if (linkUrl) {
      markdown = `[![${altText}](${imageUrl})](${linkUrl})`
    }

    this.dispatch("image-selected", { detail: { markdown } })
    this.close()
  }

  async insertLocalImage() {
    const uploadToS3 = this.s3Enabled && this.hasUploadToS3Target && this.uploadToS3Target.checked
    const resizeRatio = uploadToS3 && this.hasResizeSelectLocalTarget ? this.resizeSelectLocalTarget.value : ""
    let imageUrl = `/images/preview/${encodePath(this.selectedImage.path)}`

    if (uploadToS3) {
      this.showImageLoading(resizeRatio ? "Resizing and uploading to S3..." : "Uploading to S3...")
      this.insertImageBtnTarget.disabled = true

      const data = await this.localImages.uploadToS3(this.selectedImage.path, resizeRatio, this.csrfToken)
      imageUrl = data.url

      this.hideImageLoading()
    }

    return imageUrl
  }

  async insertFolderImage() {
    const uploadToS3 = this.s3Enabled && this.hasUploadFolderToS3Target && this.uploadFolderToS3Target.checked
    const resizeRatio = this.hasResizeSelectFolderTarget ? this.resizeSelectFolderTarget.value : ""

    const loadingMsg = uploadToS3
      ? (resizeRatio ? "Resizing and uploading to S3..." : "Uploading to S3...")
      : (resizeRatio ? "Resizing and saving..." : "Saving image...")
    this.showImageLoading(loadingMsg)
    this.insertImageBtnTarget.disabled = true

    const data = await this.folderImages.upload(this.selectedImage.file, resizeRatio, uploadToS3, this.csrfToken)

    this.hideImageLoading()
    return data.url
  }

  async insertAiImage() {
    const uploadToS3 = this.s3Enabled && this.hasAiImageSaveS3Target && this.aiImageSaveS3Target.checked

    const loadingMsg = uploadToS3 ? "Uploading to S3..." : "Saving image..."
    this.showImageLoading(loadingMsg)
    this.insertImageBtnTarget.disabled = true

    const data = await this.aiImages.save(uploadToS3, this.csrfToken)

    this.hideImageLoading()
    return data.url
  }

  async insertExternalImage() {
    const reuploadToS3 = this.s3Enabled && this.hasReuploadToS3Target && this.reuploadToS3Target.checked
    const resizeRatio = reuploadToS3 && this.hasResizeSelectExternalTarget ? this.resizeSelectExternalTarget.value : ""
    let imageUrl = this.selectedImage.url

    if (reuploadToS3) {
      this.showImageLoading(resizeRatio ? "Downloading, resizing and uploading to S3..." : "Downloading and uploading to S3...")
      this.insertImageBtnTarget.disabled = true

      const data = await this.webImages.uploadToS3(this.selectedImage.url, resizeRatio, this.csrfToken)
      imageUrl = data.url

      this.hideImageLoading()
    }

    return imageUrl
  }
}
