/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

const replacements = [
  {
    file: 'src/app/actions/upload.ts',
    from: "import { assertProjectUploadAccess } from '@/app/actions/files';",
    to: "import { assertProjectUploadAccess } from '@/app/actions/files/_shared';"
  },
  {
    file: 'src/components/projects/tabs/sprint/SprintDetailDrawer.tsx',
    from: 'import { getNodeActivity, getNodeLinkedTasks, getNodeMetadataBatch } from "@/app/actions/files";',
    to: 'import { getNodeActivity, getNodeLinkedTasks } from "@/app/actions/files/events";\nimport { getNodeMetadataBatch } from "@/app/actions/files/nodes";'
  },
  {
    file: 'src/components/projects/v2/FileTreePicker.tsx',
    from: 'import { getProjectNodes } from "@/app/actions/files";',
    to: 'import { getProjectNodes } from "@/app/actions/files/nodes";'
  },
  {
    file: 'src/components/projects/v2/explorer/ExplorerContextMenu.tsx',
    from: 'import {\n  bulkRestoreNodes,\n  bulkTrashNodes,\n  getTrashNodes,\n} from "@/app/actions/files";',
    to: 'import {\n  bulkRestoreNodes,\n  bulkTrashNodes,\n  getTrashNodes,\n} from "@/app/actions/files/mutations";'
  },
  {
    file: 'src/components/projects/v2/explorer/ExplorerDialogsHost.tsx',
    from: 'import { getProjectNodes } from "@/app/actions/files";',
    to: 'import { getProjectNodes } from "@/app/actions/files/nodes";'
  },
  {
    file: 'src/components/projects/v2/explorer/useExplorerBoot.ts',
    from: 'import {\n  getProjectNodesWithCounts,\n  getBreadcrumbs,\n} from "@/app/actions/files";',
    to: 'import {\n  getProjectNodesWithCounts,\n  getBreadcrumbs,\n} from "@/app/actions/files/nodes";'
  },
  {
    file: 'src/components/projects/v2/explorer/useExplorerDragDrop.ts',
    from: 'import { bulkMoveNodes } from "@/app/actions/files";',
    to: 'import { bulkMoveNodes } from "@/app/actions/files/mutations";'
  },
  {
    file: 'src/components/projects/v2/explorer/useExplorerMutations.ts',
    from: 'import {\n  createFolder,\n  renameNode,\n  bulkMoveNodes,\n  bulkTrashNodes,\n  deleteNode,\n} from "@/app/actions/files";',
    to: 'import {\n  createFolder,\n  renameNode,\n  bulkMoveNodes,\n  bulkTrashNodes,\n  deleteNode,\n} from "@/app/actions/files/mutations";'
  },
  {
    file: 'src/components/projects/v2/files-tab/breadcrumb/BreadcrumbBar.tsx',
    from: 'import { getBreadcrumbs } from "@/app/actions/files";',
    to: 'import { getBreadcrumbs } from "@/app/actions/files/nodes";'
  },
  {
    file: 'src/components/projects/v2/files-tab/file/FileView.tsx',
    from: 'import { getProjectFileContent } from "@/app/actions/files";',
    to: 'import { getProjectFileContent } from "@/app/actions/files/content";'
  },
  {
    file: 'src/components/projects/v2/files-tab/file/TextViewer.tsx',
    from: 'import {\n  getProjectFileContent,\n  updateProjectFileStatsSafe,\n} from "@/app/actions/files";',
    to: 'import {\n  getProjectFileContent,\n  updateProjectFileStatsSafe,\n} from "@/app/actions/files/content";'
  },
  {
    file: 'src/components/projects/v2/files-tab/picker/SingleAttachmentPicker.tsx',
    from: 'import { linkNodeToTask } from "@/app/actions/files";',
    to: 'import { linkNodeToTask } from "@/app/actions/files/links";'
  },
  {
    file: 'src/components/projects/v2/navigation/BreadcrumbBar.tsx',
    from: 'import { getBreadcrumbs, findNodeByPathAny } from "@/app/actions/files";',
    to: 'import { getBreadcrumbs, findNodeByPathAny } from "@/app/actions/files/nodes";'
  },
  {
    file: 'src/components/projects/v2/tasks/components/TaskFilesExplorer.tsx',
    from: 'import { getProjectNodes } from "@/app/actions/files";',
    to: 'import { getProjectNodes } from "@/app/actions/files/nodes";'
  },
  {
    file: 'src/hooks/useTaskAttachments.ts',
    from: 'import { getTaskAttachments } from "@/app/actions/files";',
    to: 'import { getTaskAttachments } from "@/app/actions/files/links";'
  },
  {
    file: 'src/hooks/useTaskFileMutations.ts',
    from: 'import {\n  linkNodeToTask,\n  unlinkNodeFromTask,\n  updateTaskNodeLinksOrder,\n} from "@/app/actions/files";',
    to: 'import {\n  linkNodeToTask,\n  unlinkNodeFromTask,\n  updateTaskNodeLinksOrder,\n} from "@/app/actions/files/links";'
  }
];

let failed = 0;
for (const r of replacements) {
  if (!fs.existsSync(r.file)) {
    console.error(`File not found: ${r.file}`);
    continue;
  }
  let content = fs.readFileSync(r.file, 'utf8');
  if (content.includes(r.from)) {
    content = content.replace(r.from, r.to);
    fs.writeFileSync(r.file, content);
    console.log(`Updated ${r.file}`);
  } else {
    // try exact match without whitespace formatting issues
    console.log(`Could not find string in ${r.file}`);
    failed++;
  }
}
if (failed > 0) {
  process.exit(1);
}
