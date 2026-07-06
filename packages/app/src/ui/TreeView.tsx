import type { Tree } from "@lezer/common";
import { useState, useMemo } from "react";

interface TreeNodeData {
  name: string;
  from: number;
  to: number;
  isError: boolean;
  children: TreeNodeData[];
  text: string;
}

function buildTree(tree: Tree, source: string): TreeNodeData[] {
  const roots: TreeNodeData[] = [];
  const stack: TreeNodeData[][] = [roots];

  tree.iterate({
    enter(node) {
      const data: TreeNodeData = {
        name: node.name,
        from: node.from,
        to: node.to,
        isError: node.name === "⚠",
        children: [],
        text: source.slice(node.from, node.to)
      };
      stack[stack.length - 1].push(data);
      stack.push(data.children);
    },
    leave() {
      stack.pop();
    }
  });

  return roots;
}

function TreeNode({
  node,
  depth,
  onHover
}: {
  node: TreeNodeData;
  depth: number;
  onHover: (range: [number, number] | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const isLeaf = !hasChildren;
  const truncatedText = node.text.length > 60 ? node.text.slice(0, 60) + "…" : node.text;

  return (
    <div style={{ paddingLeft: depth * 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          cursor: hasChildren ? "pointer" : "default",
          padding: "1px 4px",
          borderRadius: 2,
          whiteSpace: "nowrap",
          background: node.isError ? "rgba(191,44,41,0.08)" : undefined
        }}
        onClick={() => {
          if (hasChildren) {
            setCollapsed(!collapsed);
          }
        }}
        onMouseEnter={() => { onHover([node.from, node.to]); }}
        onMouseLeave={() => { onHover(null); }}
      >
        <span style={{ flexShrink: 0, fontSize: 10, color: "#8ea0b2" }}>
          {hasChildren ? (collapsed ? "▶" : "▼") : " "}
        </span>
        <span style={{ color: node.isError ? "#bf2c29" : "#0f5a8a", fontWeight: 700 }}>
          {node.name}
        </span>
        <span style={{ color: "#9aa8b5", fontSize: 10 }}>
          [{node.from}–{node.to}]
        </span>
        {isLeaf && (
          <span style={{ color: "#6b7786", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis" }}>
            "{truncatedText}"
          </span>
        )}
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} onHover={onHover} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView({
  tree,
  source,
  onHover
}: {
  tree: Tree | null;
  source: string;
  onHover: (range: [number, number] | null) => void;
}) {
  const nodes = useMemo(() => (tree ? buildTree(tree, source) : []), [tree, source]);

  if (!tree) return <div style={{ padding: 8, color: "#808080" }}>No parse tree</div>;

  return (
    <div>
      {nodes.map((node, i) => (
        <TreeNode key={i} node={node} depth={0} onHover={onHover} />
      ))}
    </div>
  );
}
