export function pathStatementId(statementIndex: number): string {
  return `path:${statementIndex}`;
}

export function scopeStatementId(statementIndex: number): string {
  return `scope:${statementIndex}`;
}

export function foreachStatementId(statementIndex: number): string {
  return `foreach:${statementIndex}`;
}

export function macroDefinitionStatementId(statementIndex: number): string {
  return `macro-definition:${statementIndex}`;
}

export function macroAliasStatementId(statementIndex: number): string {
  return `macro-alias:${statementIndex}`;
}

export function macroCommandDefinitionStatementId(statementIndex: number): string {
  return `macro-command-definition:${statementIndex}`;
}

export function tikzSetStatementId(statementIndex: number): string {
  return `tikz-set:${statementIndex}`;
}

export function tikzStyleStatementId(statementIndex: number): string {
  return `tikz-style:${statementIndex}`;
}

export function pgfkeysStatementId(statementIndex: number): string {
  return `pgfkeys:${statementIndex}`;
}

export function tikzLibraryStatementId(statementIndex: number): string {
  return `tikz-library:${statementIndex}`;
}

export function colorletStatementId(statementIndex: number): string {
  return `colorlet:${statementIndex}`;
}

export function defineColorStatementId(statementIndex: number): string {
  return `definecolor:${statementIndex}`;
}

export function unknownStatementId(statementIndex: number): string {
  return `unknown-statement:${statementIndex}`;
}

export function coordinateItemId(statementIndex: number, itemIndex: number): string {
  return `coordinate:${statementIndex}:${itemIndex}`;
}

export function nodeItemId(statementIndex: number, itemIndex: number): string {
  return `node:${statementIndex}:${itemIndex}`;
}

export function nodeForeachClauseId(statementIndex: number, itemIndex: number, clauseIndex: number): string {
  return `node-foreach-clause:${statementIndex}:${itemIndex}:${clauseIndex}`;
}

export function pathOptionItemId(statementIndex: number, itemIndex: number): string {
  return `path-option:${statementIndex}:${itemIndex}`;
}

export function pathCommentItemId(statementIndex: number, itemIndex: number): string {
  return `path-comment:${statementIndex}:${itemIndex}`;
}

export function pathKeywordItemId(statementIndex: number, itemIndex: number): string {
  return `path-keyword:${statementIndex}:${itemIndex}`;
}

export function graphOperationItemId(statementIndex: number, itemIndex: number): string {
  return `graph-operation:${statementIndex}:${itemIndex}`;
}

export function plotOperationItemId(statementIndex: number, itemIndex: number): string {
  return `plot-operation:${statementIndex}:${itemIndex}`;
}

export function pathForeachItemId(statementIndex: number, itemIndex: number): string {
  return `path-foreach:${statementIndex}:${itemIndex}`;
}

export function picOperationItemId(statementIndex: number, itemIndex: number): string {
  return `pic-operation:${statementIndex}:${itemIndex}`;
}

export function picForeachClauseId(statementIndex: number, itemIndex: number, clauseIndex: number): string {
  return `pic-foreach-clause:${statementIndex}:${itemIndex}:${clauseIndex}`;
}

export function toOperationItemId(statementIndex: number, itemIndex: number): string {
  return `to-operation:${statementIndex}:${itemIndex}`;
}

export function edgeOperationItemId(statementIndex: number, itemIndex: number): string {
  return `edge-operation:${statementIndex}:${itemIndex}`;
}

export function childOperationItemId(statementIndex: number, itemIndex: number): string {
  return `child-operation:${statementIndex}:${itemIndex}`;
}

export function edgeFromParentOperationItemId(statementIndex: number, itemIndex: number): string {
  return `edge-from-parent-operation:${statementIndex}:${itemIndex}`;
}

export function childForeachClauseId(statementIndex: number, itemIndex: number, clauseIndex: number): string {
  return `child-foreach-clause:${statementIndex}:${itemIndex}:${clauseIndex}`;
}

export function svgOperationItemId(statementIndex: number, itemIndex: number): string {
  return `svg-operation:${statementIndex}:${itemIndex}`;
}

export function letOperationItemId(statementIndex: number, itemIndex: number): string {
  return `let-operation:${statementIndex}:${itemIndex}`;
}

export function decorateOperationItemId(statementIndex: number, itemIndex: number): string {
  return `decorate-operation:${statementIndex}:${itemIndex}`;
}

export function coordinateOperationItemId(statementIndex: number, itemIndex: number): string {
  return `coordinate-operation:${statementIndex}:${itemIndex}`;
}

export function unknownPathItemId(statementIndex: number, itemIndex: number): string {
  return `unknown-path-item:${statementIndex}:${itemIndex}`;
}
