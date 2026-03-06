import test from 'node:test'
import assert from 'node:assert/strict'
import {
  __clearBuildVisibleRowsCacheForTests,
  buildVisibleRows,
} from '@/components/projects/v2/explorer/utils/buildVisibleRows'
import { filesParentKey } from '@/stores/filesWorkspaceStore'

function node(id: string, name: string, parentId: string | null = null) {
  return {
    id,
    projectId: 'p1',
    parentId,
    type: 'file',
    name,
    s3Key: null,
    size: 0,
    mimeType: 'text/plain',
    metadata: {},
    createdBy: null,
    deletedBy: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  } as any
}

test('buildVisibleRows invalidates cache when treeVersion changes', () => {
  __clearBuildVisibleRowsCacheForTests()
  const nodesByIdV1 = {
    f1: node('f1', 'a.txt'),
  }
  const nodesByIdV2 = {
    ...nodesByIdV1,
    f2: node('f2', 'b.txt'),
  }

  const base = {
    projectId: 'p1',
    mode: 'tree',
    sort: 'name' as const,
    foldersFirst: true,
    viewMode: 'code',
    childrenByParentId: { [filesParentKey(null)]: ['f1'] },
    loadedChildren: { [filesParentKey(null)]: true },
    expandedFolderIds: {},
    folderMeta: {},
    sortedChildrenByParentId: {},
  }

  const rowsV1 = buildVisibleRows({ ...base, treeVersion: 1, nodesById: nodesByIdV1 })
  const rowsV2 = buildVisibleRows({
    ...base,
    treeVersion: 2,
    nodesById: nodesByIdV2,
    childrenByParentId: { [filesParentKey(null)]: ['f1', 'f2'] },
  })

  assert.equal(rowsV1.filter((row) => row.kind === 'node').length, 1)
  assert.equal(rowsV2.filter((row) => row.kind === 'node').length, 2)
})

test('buildVisibleRows caches for same structural key', () => {
  __clearBuildVisibleRowsCacheForTests()
  const rowsA = buildVisibleRows({
    projectId: 'p2',
    treeVersion: 9,
    mode: 'tree',
    sort: 'name',
    foldersFirst: true,
    viewMode: 'all',
    nodesById: { f1: node('f1', 'x.txt') },
    childrenByParentId: { [filesParentKey(null)]: ['f1'] },
    loadedChildren: { [filesParentKey(null)]: true },
    expandedFolderIds: {},
    folderMeta: {},
    sortedChildrenByParentId: {},
  })

  const rowsB = buildVisibleRows({
    projectId: 'p2',
    treeVersion: 9,
    mode: 'tree',
    sort: 'name',
    foldersFirst: true,
    viewMode: 'all',
    nodesById: { f1: node('f1', 'x.txt') },
    childrenByParentId: { [filesParentKey(null)]: ['f1'] },
    loadedChildren: { [filesParentKey(null)]: true },
    expandedFolderIds: {},
    folderMeta: {},
    sortedChildrenByParentId: {},
  })

  assert.equal(rowsA, rowsB)
})

test('buildVisibleRows expires stale cache entries by TTL', () => {
  __clearBuildVisibleRowsCacheForTests()
  const originalNow = Date.now
  let now = 1_700_000_000_000
  Date.now = () => now
  try {
    const params = {
      projectId: 'ttl-project',
      treeVersion: 1,
      mode: 'tree',
      sort: 'name' as const,
      foldersFirst: true,
      viewMode: 'all',
      nodesById: { f1: node('f1', 'ttl.txt') },
      childrenByParentId: { [filesParentKey(null)]: ['f1'] },
      loadedChildren: { [filesParentKey(null)]: true },
      expandedFolderIds: {},
      folderMeta: {},
      sortedChildrenByParentId: {},
    }

    const first = buildVisibleRows(params)
    now += 10 * 60 * 1000 + 1
    const second = buildVisibleRows(params)
    assert.notEqual(first, second)
  } finally {
    Date.now = originalNow
  }
})

test('buildVisibleRows evicts least-recently-used keys when budget is exceeded', () => {
  __clearBuildVisibleRowsCacheForTests()
  const originalNow = Date.now
  let now = 1_700_100_000_000
  Date.now = () => now
  try {
    const makeParams = (index: number) => ({
      projectId: `p-${index}`,
      treeVersion: 1,
      mode: 'tree',
      sort: 'name' as const,
      foldersFirst: true,
      viewMode: 'all',
      nodesById: { f1: node(`f-${index}`, `f-${index}.txt`) },
      childrenByParentId: { [filesParentKey(null)]: [`f-${index}`] },
      loadedChildren: { [filesParentKey(null)]: true },
      expandedFolderIds: {},
      folderMeta: {},
      sortedChildrenByParentId: {},
    })

    const firstRows = buildVisibleRows(makeParams(0))
    for (let index = 1; index <= 200; index += 1) {
      now += 1
      buildVisibleRows(makeParams(index))
    }
    now += 1
    const firstRowsAfterEviction = buildVisibleRows(makeParams(0))
    assert.notEqual(firstRows, firstRowsAfterEviction)
  } finally {
    Date.now = originalNow
  }
})
