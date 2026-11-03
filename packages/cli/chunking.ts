import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { toString } from 'mdast-util-to-string';
import type { Root, RootContent } from 'mdast';

interface ChunkLocator {
  filePath: string;
  headingPath: string[];
  lineRange: {
    start: number;
    end: number;
  }
}

interface LocatedMarkdownChunk {
  locator: ChunkLocator; 
  content: string;
}

export function chunkMd(markdownText: string, filePath:string): LocatedMarkdownChunk[] {
  // Memory documents (approved proposals) are single short statements:
  // one chunk covering the whole text, no heading splitting.
  if (filePath.startsWith("memory://")) {
    const content = markdownText.trim();
    if (!content) return [];
    return [
      {
        locator: {
          filePath,
          headingPath: [],
          lineRange: { start: 1, end: content.split("\n").length },
        },
        content,
      },
    ];
  }

  const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml', 'toml'])

  const tree = processor.parse(markdownText) as Root;

  const chunks: LocatedMarkdownChunk[] = [];
  let currentHeadings: string[] = [];
  let currentChunkNodes: RootContent[] = [];

  const finalizeChunk = () => {
    if (currentChunkNodes.length === 0) return;

    const firstNode: RootContent | undefined = currentChunkNodes[0];
    const lastNode: RootContent | undefined =
      currentChunkNodes[currentChunkNodes.length - 1];
    const startLine = firstNode?.position?.start.line ?? 1;
    const lastLine = lastNode?.position?.end.line ?? startLine;
    
    const textContent = currentChunkNodes.map(node => toString(node)).join('\n').trim();
    
    if (textContent) {
      chunks.push({
        locator: {
          filePath,
          headingPath: [...currentHeadings],
          lineRange: {
            start: startLine,
            end: lastLine
          }
        },
        content: textContent
      })
    }

    currentChunkNodes = [];
  }

  for (const node of tree.children) {
    if (
      node.type === 'yaml' ||
      (node.type as string) === 'toml'
    ) {
      continue;
    }

    if (node.type === 'heading') {
      finalizeChunk();

      const headingText = toString(node);
      const headingIndex = node.depth - 1;

      currentHeadings = currentHeadings.slice(0, headingIndex);
      currentHeadings[headingIndex] = headingText;

      currentHeadings = currentHeadings.filter(Boolean)
      continue;
    }
    currentChunkNodes.push(node);
  }

  finalizeChunk()
  return chunks;
}