import type {
  GraphConnectorOperator,
  GraphSpec,
  GraphSpecChain,
  GraphSpecConnector,
  GraphSpecNode,
  GraphSpecSegment
} from "../../ast/types.js";

const CONNECTOR_OPERATORS: GraphConnectorOperator[] = ["<->", "-!-", "->", "<-", "--"];

export function parseGraphSpec(raw: string, from: number): GraphSpec {
  const segments: GraphSpecSegment[] = [];
  const body = stripOuterBraces(raw, from);
  const bodyRaw = body?.raw ?? raw;
  const bodyFrom = body?.from ?? from;

  for (const part of splitTopLevel(bodyRaw, [",", ";"], bodyFrom)) {
    const trimmed = trimSlice(part.raw, part.from);
    if (!trimmed) {
      continue;
    }

    const chain = parseGraphChain(trimmed.raw, trimmed.from);
    segments.push({
      span: {
        from: trimmed.from,
        to: trimmed.to
      },
      raw: trimmed.raw,
      chain
    });
  }

  return {
    span: {
      from,
      to: from + raw.length
    },
    raw,
    segments
  };
}

function stripOuterBraces(raw: string, from: number): { raw: string; from: number } | null {
  const trimmed = trimSlice(raw, from);
  if (!trimmed) {
    return null;
  }
  if (!trimmed.raw.startsWith("{") || !trimmed.raw.endsWith("}")) {
    return null;
  }

  const segment = readBalancedSegment(trimmed.raw, 0, "{", "}");
  if (segment?.next !== trimmed.raw.length) {
    return null;
  }

  return {
    raw: trimmed.raw.slice(1, -1),
    from: trimmed.from + 1
  };
}

function parseGraphChain(raw: string, from: number): GraphSpecChain {
  const nodes: GraphSpecNode[] = [];
  const connectors: GraphSpecConnector[] = [];

  let cursor = 0;
  const firstNode = parseNodeSpec(raw, from, cursor);
  if (!firstNode) {
    return {
      span: {
        from,
        to: from + raw.length
      },
      raw,
      nodes,
      connectors
    };
  }

  nodes.push(firstNode.node);
  cursor = firstNode.next;

  for (;;) {
    const connectorStart = skipWhitespace(raw, cursor);
    const connector = readConnector(raw, connectorStart);
    if (!connector) {
      break;
    }
    cursor = connector.next;

    const optionRead = readOptionList(raw, from, cursor);
    if (optionRead) {
      cursor = optionRead.next;
    }

    const nextNode = parseNodeSpec(raw, from, cursor);
    if (!nextNode) {
      break;
    }

    const connectorAst: GraphSpecConnector = {
      operator: connector.operator,
      span: {
        from: from + connector.index,
        to: from + connector.next
      }
    };
    if (optionRead) {
      connectorAst.optionsRaw = optionRead.raw;
      connectorAst.optionsSpan = optionRead.span;
    }
    connectors.push(connectorAst);

    nodes.push(nextNode.node);
    cursor = nextNode.next;
  }

  return {
    span: {
      from,
      to: from + raw.length
    },
    raw,
    nodes,
    connectors
  };
}

function parseNodeSpec(raw: string, from: number, cursor: number): { node: GraphSpecNode; next: number } | null {
  const start = skipWhitespace(raw, cursor);
  if (start >= raw.length) {
    return null;
  }

  const group = readBalancedSegment(raw, start, "{", "}");
  if (group) {
    return {
      node: {
        span: {
          from: from + group.start,
          to: from + group.next
        },
        raw: group.raw
      },
      next: group.next
    };
  }

  const connector = findNextConnector(raw, start);
  const end = connector ? connector.index : raw.length;
  const trimmed = trimSlice(raw.slice(start, end), from + start);
  if (!trimmed) {
    return null;
  }

  return {
    node: {
      span: {
        from: trimmed.from,
        to: trimmed.to
      },
      raw: trimmed.raw
    },
    next: end
  };
}

function readOptionList(
  raw: string,
  from: number,
  cursor: number
): { raw: string; span: { from: number; to: number }; next: number } | null {
  const start = skipWhitespace(raw, cursor);
  const segment = readBalancedSegment(raw, start, "[", "]");
  if (!segment) {
    return null;
  }
  return {
    raw: segment.raw,
    span: {
      from: from + segment.start,
      to: from + segment.next
    },
    next: segment.next
  };
}

function splitTopLevel(raw: string, separators: string[], from: number): Array<{ raw: string; from: number }> {
  const parts: Array<{ raw: string; from: number }> = [];
  let partStart = 0;
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw[index - 1] !== "\\") {
      if (inQuote && raw[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (isCommentStart(raw, index)) {
      while (index < raw.length && raw[index] !== "\n" && raw[index] !== "\r") {
        index += 1;
      }
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }

    if (depthBrace === 0 && depthSquare === 0 && depthParen === 0 && separators.includes(char)) {
      parts.push({
        raw: raw.slice(partStart, index),
        from: from + partStart
      });
      partStart = index + 1;
    }
  }

  parts.push({
    raw: raw.slice(partStart),
    from: from + partStart
  });
  return parts;
}

function readConnector(raw: string, start: number): { operator: GraphConnectorOperator; index: number; next: number } | null {
  for (const operator of CONNECTOR_OPERATORS) {
    if (raw.startsWith(operator, start)) {
      return {
        operator,
        index: start,
        next: start + operator.length
      };
    }
  }
  return null;
}

function findNextConnector(raw: string, start: number): { operator: GraphConnectorOperator; index: number } | null {
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw[index - 1] !== "\\") {
      if (inQuote && raw[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (isCommentStart(raw, index)) {
      while (index < raw.length && raw[index] !== "\n" && raw[index] !== "\r") {
        index += 1;
      }
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }

    if (depthBrace === 0 && depthSquare === 0 && depthParen === 0) {
      for (const operator of CONNECTOR_OPERATORS) {
        if (raw.startsWith(operator, index)) {
          return { operator, index };
        }
      }
    }
  }

  return null;
}

function readBalancedSegment(
  raw: string,
  start: number,
  open: string,
  close: string
): { raw: string; start: number; next: number } | null {
  if (raw[start] !== open) {
    return null;
  }

  let depth = 0;
  let inQuote = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw[index - 1] !== "\\") {
      if (inQuote && raw[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (isCommentStart(raw, index)) {
      while (index < raw.length && raw[index] !== "\n" && raw[index] !== "\r") {
        index += 1;
      }
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          raw: raw.slice(start, index + 1),
          start,
          next: index + 1
        };
      }
    }
  }
  return null;
}

function skipWhitespace(raw: string, cursor: number): number {
  let index = cursor;
  while (index < raw.length) {
    const char = raw.charAt(index);
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (isCommentStart(raw, index)) {
      while (index < raw.length && raw[index] !== "\n" && raw[index] !== "\r") {
        index += 1;
      }
      continue;
    }
    break;
  }
  return index;
}

function isCommentStart(raw: string, index: number): boolean {
  if (raw[index] !== "%") {
    return false;
  }
  if (index > 0 && raw[index - 1] === "\\") {
    return false;
  }
  return true;
}

function trimSlice(raw: string, from: number): { raw: string; from: number; to: number } | null {
  let left = 0;
  let right = raw.length;
  while (left < right && /\s/.test(raw.charAt(left))) {
    left += 1;
  }
  while (right > left && /\s/.test(raw.charAt(right - 1))) {
    right -= 1;
  }
  if (left >= right) {
    return null;
  }
  return {
    raw: raw.slice(left, right),
    from: from + left,
    to: from + right
  };
}
