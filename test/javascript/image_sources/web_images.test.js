/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { WebImageSource } from "../../../app/javascript/lib/image_sources/web_images.js"

describe("WebImageSource", () => {
  let source
  let originalFetch

  beforeEach(() => {
    source = new WebImageSource()
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe("constructor", () => {
    it("initializes with empty results", () => {
      expect(source.results).toEqual([])
    })
  })

  describe("reset", () => {
    it("clears results", () => {
      source.results = [{ url: "test.jpg" }]
      source.reset()
      expect(source.results).toEqual([])
    })
  })

  describe("search", () => {
    it("returns error for empty query", async () => {
      const result = await source.search("")
      expect(result.error).toBe("Please enter search keywords")
    })

    it("returns error for null query", async () => {
      const result = await source.search(null)
      expect(result.error).toBe("Please enter search keywords")
    })

    it("fetches images from API", async () => {
      const mockImages = [
        { url: "http://example.com/1.jpg", title: "Image 1" },
        { url: "http://example.com/2.jpg", title: "Image 2" }
      ]

      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ images: mockImages })
      })

      const result = await source.search("cats")

      expect(global.fetch).toHaveBeenCalledWith("/images/search_web?q=cats")
      expect(result.images).toEqual(mockImages)
      expect(result.message).toBe("Found 2 images - click to select")
      expect(source.results).toEqual(mockImages)
    })

    it("encodes query parameters", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ images: [] })
      })

      await source.search("cats & dogs")

      expect(global.fetch).toHaveBeenCalledWith("/images/search_web?q=cats%20%26%20dogs")
    })

    it("handles API error response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ error: "API rate limit exceeded" })
      })

      const result = await source.search("cats")

      expect(result.error).toBe("API rate limit exceeded")
      expect(source.results).toEqual([])
    })

    it("handles empty results", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ images: [] })
      })

      const result = await source.search("xyznonexistent")

      expect(result.message).toBe("No images found")
      expect(source.results).toEqual([])
    })

    it("handles empty results with note", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ images: [], note: "Try different keywords" })
      })

      const result = await source.search("xyznonexistent")

      expect(result.message).toBe("Try different keywords")
    })

    it("handles network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"))

      const result = await source.search("cats")

      expect(result.error).toBe("Search failed. Please try again.")
      expect(source.results).toEqual([])
    })
  })

  describe("renderGrid", () => {
    it("renders empty state when no results", () => {
      const container = { innerHTML: "" }
      source.results = []

      source.renderGrid(container, "click->handler")

      expect(container.innerHTML).toContain("No images found")
    })

    it("renders image buttons", () => {
      const container = { innerHTML: "" }
      source.results = [
        { url: "http://example.com/1.jpg", title: "Cat", source: "example.com" }
      ]

      source.renderGrid(container, "click->handler#select")

      expect(container.innerHTML).toContain('data-url="http://example.com/1.jpg"')
      expect(container.innerHTML).toContain('data-title="Cat"')
      expect(container.innerHTML).toContain('data-action="click->handler#select"')
      expect(container.innerHTML).toContain('data-source="example.com"')
    })

    it("renders dimensions when available", () => {
      const container = { innerHTML: "" }
      source.results = [
        { url: "http://example.com/1.jpg", width: 800, height: 600 }
      ]

      source.renderGrid(container, "click->handler")

      expect(container.innerHTML).toContain("800x600")
    })

    it("uses thumbnail when available", () => {
      const container = { innerHTML: "" }
      source.results = [
        { url: "http://example.com/full.jpg", thumbnail: "http://example.com/thumb.jpg" }
      ]

      source.renderGrid(container, "click->handler")

      expect(container.innerHTML).toContain('src="http://example.com/thumb.jpg"')
      expect(container.innerHTML).toContain('data-thumbnail="http://example.com/thumb.jpg"')
    })

    it("escapes HTML in titles", () => {
      const container = { innerHTML: "" }
      source.results = [
        { url: "http://example.com/1.jpg", title: "<script>alert('xss')</script>" }
      ]

      source.renderGrid(container, "click->handler")

      expect(container.innerHTML).not.toContain("<script>")
      expect(container.innerHTML).toContain("&lt;script&gt;")
    })
  })

  describe("deselectAll", () => {
    it("removes selection classes from all items", () => {
      const mockElements = [
        { classList: { remove: vi.fn() } },
        { classList: { remove: vi.fn() } }
      ]
      const container = {
        querySelectorAll: vi.fn().mockReturnValue(mockElements)
      }

      source.deselectAll(container)

      expect(container.querySelectorAll).toHaveBeenCalledWith(".external-image-item")
      mockElements.forEach(el => {
        expect(el.classList.remove).toHaveBeenCalledWith("ring-2", "ring-blue-500")
      })
    })

    it("handles null container", () => {
      expect(() => source.deselectAll(null)).not.toThrow()
    })
  })
})
