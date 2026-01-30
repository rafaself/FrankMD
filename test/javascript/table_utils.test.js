import { describe, it, expect } from 'vitest'
import {
  parseMarkdownTable,
  generateMarkdownTable,
  swapColumns,
  swapRows,
  deleteColumn,
  deleteRow,
  addColumn,
  addRow
} from '../../app/javascript/lib/table_utils.js'

describe('parseMarkdownTable', () => {
  it('parses a simple markdown table', () => {
    const markdown = `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25']
    ])
  })

  it('handles table with extra whitespace', () => {
    const markdown = `|  Name  |  Age  |
|--------|-------|
|  Alice |  30   |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['Name', 'Age'],
      ['Alice', '30']
    ])
  })

  it('skips empty lines', () => {
    const markdown = `| Header |

| --- |

| Value |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['Header'],
      ['Value']
    ])
  })

  it('handles array input', () => {
    const lines = [
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |'
    ]

    const result = parseMarkdownTable(lines)

    expect(result).toEqual([
      ['A', 'B'],
      ['1', '2']
    ])
  })

  it('skips separator rows with colons (alignment)', () => {
    const markdown = `| Left | Center | Right |
|:-----|:------:|------:|
| L    | C      | R     |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['Left', 'Center', 'Right'],
      ['L', 'C', 'R']
    ])
  })

  it('returns empty array for empty input', () => {
    expect(parseMarkdownTable('')).toEqual([])
    expect(parseMarkdownTable([])).toEqual([])
  })

  it('handles cells with special characters', () => {
    const markdown = `| Code | Description |
| --- | --- |
| \`foo\` | A *bold* statement |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['Code', 'Description'],
      ['`foo`', 'A *bold* statement']
    ])
  })
})

describe('generateMarkdownTable', () => {
  it('generates a properly formatted table', () => {
    const data = [
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25']
    ]

    const result = generateMarkdownTable(data)

    expect(result).toBe(`| Name  | Age |
| ----- | --- |
| Alice | 30  |
| Bob   | 25  |`)
  })

  it('pads columns to consistent width', () => {
    const data = [
      ['A', 'LongerHeader'],
      ['Short', 'X']
    ]

    const result = generateMarkdownTable(data)
    const lines = result.split('\n')

    // All lines should have the same length
    expect(lines[0].length).toBe(lines[1].length)
    expect(lines[1].length).toBe(lines[2].length)
  })

  it('handles empty cells', () => {
    const data = [
      ['A', 'B', 'C'],
      ['1', '', '3']
    ]

    const result = generateMarkdownTable(data)

    // Empty cells get padded with spaces
    expect(result).toContain('|     |')
  })

  it('returns empty string for empty data', () => {
    expect(generateMarkdownTable([])).toBe('')
    expect(generateMarkdownTable(null)).toBe('')
    expect(generateMarkdownTable(undefined)).toBe('')
  })

  it('normalizes uneven row lengths', () => {
    const data = [
      ['A', 'B', 'C'],
      ['1', '2']  // Missing third column
    ]

    const result = generateMarkdownTable(data)
    const lines = result.split('\n')

    // Should have 3 pipe separators in each line (3 columns)
    expect(lines[2].split('|').length).toBe(5) // 5 parts = 3 columns + empty ends
  })

  it('minimum column width is 3 characters', () => {
    const data = [
      ['A', 'B'],
      ['1', '2']
    ]

    const result = generateMarkdownTable(data)

    // Check separator row has at least 3 dashes per column
    expect(result).toContain('| --- | --- |')
  })
})

describe('roundtrip: parse then generate', () => {
  it('reconstructs table after parsing', () => {
    const data = [
      ['Product', 'Price', 'Quantity'],
      ['Apple', '$1.50', '10'],
      ['Banana', '$0.75', '25']
    ]

    const markdown = generateMarkdownTable(data)
    const parsed = parseMarkdownTable(markdown)

    expect(parsed).toEqual(data)
  })
})

describe('swapColumns', () => {
  it('swaps two columns', () => {
    const data = [
      ['A', 'B', 'C'],
      ['1', '2', '3']
    ]

    const result = swapColumns(data, 0, 2)

    expect(result).toEqual([
      ['C', 'B', 'A'],
      ['3', '2', '1']
    ])
  })

  it('does not mutate original array', () => {
    const data = [['A', 'B']]
    swapColumns(data, 0, 1)
    expect(data).toEqual([['A', 'B']])
  })
})

describe('swapRows', () => {
  it('swaps two rows', () => {
    const data = [
      ['Header'],
      ['Row1'],
      ['Row2']
    ]

    const result = swapRows(data, 1, 2)

    expect(result).toEqual([
      ['Header'],
      ['Row2'],
      ['Row1']
    ])
  })
})

describe('deleteColumn', () => {
  it('removes a column', () => {
    const data = [
      ['A', 'B', 'C'],
      ['1', '2', '3']
    ]

    const result = deleteColumn(data, 1)

    expect(result).toEqual([
      ['A', 'C'],
      ['1', '3']
    ])
  })
})

describe('deleteRow', () => {
  it('removes a row', () => {
    const data = [
      ['Header'],
      ['Row1'],
      ['Row2']
    ]

    const result = deleteRow(data, 1)

    expect(result).toEqual([
      ['Header'],
      ['Row2']
    ])
  })
})

describe('addColumn', () => {
  it('adds a column with header', () => {
    const data = [
      ['A', 'B'],
      ['1', '2']
    ]

    const result = addColumn(data, 'New')

    expect(result).toEqual([
      ['A', 'B', 'New'],
      ['1', '2', '']
    ])
  })
})

describe('addRow', () => {
  it('adds an empty row', () => {
    const data = [
      ['A', 'B', 'C'],
      ['1', '2', '3']
    ]

    const result = addRow(data)

    expect(result).toEqual([
      ['A', 'B', 'C'],
      ['1', '2', '3'],
      ['', '', '']
    ])
  })
})
