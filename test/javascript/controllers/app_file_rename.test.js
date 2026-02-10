import { describe, it, expect } from "vitest"

/**
 * Tests for the folder rename path remapping logic from app_controller.js.
 * Extracted as pure functions to test without full Stimulus controller setup.
 */

// Reimplements the expandedFolders remapping from onFileRenamed
function remapExpandedFolders(expandedFolders, oldPath, newPath) {
  return new Set(
    Array.from(expandedFolders, (path) => {
      if (path === oldPath || path.startsWith(oldPath + "/")) {
        return `${newPath}${path.slice(oldPath.length)}`
      }
      return path
    })
  )
}

// Reimplements the currentFile path update from onFileRenamed
function remapCurrentFile(currentFile, oldPath, newPath) {
  if (currentFile?.startsWith(oldPath + "/")) {
    return `${newPath}${currentFile.slice(oldPath.length)}`
  }
  return currentFile
}

describe("onFileRenamed: expandedFolders remapping", () => {
  it("remaps the renamed folder itself", () => {
    const expanded = new Set(["project"])
    const result = remapExpandedFolders(expanded, "project", "app")
    expect(result).toEqual(new Set(["app"]))
  })

  it("remaps nested children of renamed folder", () => {
    const expanded = new Set(["project", "project/src", "project/src/lib"])
    const result = remapExpandedFolders(expanded, "project", "app")
    expect(result).toEqual(new Set(["app", "app/src", "app/src/lib"]))
  })

  it("leaves unrelated folders unchanged", () => {
    const expanded = new Set(["project", "other", "docs/api"])
    const result = remapExpandedFolders(expanded, "project", "app")
    expect(result).toEqual(new Set(["app", "other", "docs/api"]))
  })

  it("does not remap folders that merely share a prefix", () => {
    // "project-old" should NOT be remapped when renaming "project"
    const expanded = new Set(["project", "project-old", "project-old/src"])
    const result = remapExpandedFolders(expanded, "project", "app")
    expect(result).toEqual(new Set(["app", "project-old", "project-old/src"]))
  })

  it("handles empty expanded set", () => {
    const result = remapExpandedFolders(new Set(), "old", "new")
    expect(result).toEqual(new Set())
  })

  it("handles deep nesting rename", () => {
    const expanded = new Set(["a/b/c", "a/b/c/d", "a/b/c/d/e"])
    const result = remapExpandedFolders(expanded, "a/b/c", "a/b/renamed")
    expect(result).toEqual(new Set(["a/b/renamed", "a/b/renamed/d", "a/b/renamed/d/e"]))
  })
})

describe("onFileRenamed: currentFile remapping", () => {
  it("remaps file inside renamed folder", () => {
    const result = remapCurrentFile("project/src/main.md", "project", "app")
    expect(result).toBe("app/src/main.md")
  })

  it("remaps file directly in renamed folder", () => {
    const result = remapCurrentFile("docs/readme.md", "docs", "documentation")
    expect(result).toBe("documentation/readme.md")
  })

  it("does not remap file outside renamed folder", () => {
    const result = remapCurrentFile("other/file.md", "project", "app")
    expect(result).toBe("other/file.md")
  })

  it("does not remap file with shared prefix but not in folder", () => {
    // "project-v2/file.md" should not be affected by renaming "project"
    const result = remapCurrentFile("project-v2/file.md", "project", "app")
    expect(result).toBe("project-v2/file.md")
  })

  it("handles null currentFile", () => {
    const result = remapCurrentFile(null, "project", "app")
    expect(result).toBe(null)
  })

  it("handles undefined currentFile", () => {
    const result = remapCurrentFile(undefined, "project", "app")
    expect(result).toBe(undefined)
  })
})
