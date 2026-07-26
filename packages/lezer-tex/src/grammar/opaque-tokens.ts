import {
  ContextTracker,
  ExternalTokenizer,
  type InputStream,
} from "@lezer/lr";

import {
  OpaqueAllttBegin,
  OpaqueAllttBody,
  OpaqueAllttEnd,
  OpaqueAllttEnvironment,
  OpaqueBVerbatimBegin,
  OpaqueBVerbatimBody,
  OpaqueBVerbatimEnd,
  OpaqueBVerbatimEnvironment,
  OpaqueLstlistingBegin,
  OpaqueLstlistingBody,
  OpaqueLstlistingEnd,
  OpaqueLstlistingEnvironment,
  OpaqueMintedBegin,
  OpaqueMintedBody,
  OpaqueMintedEnd,
  OpaqueMintedEnvironment,
  OpaqueSemiverbatimBegin,
  OpaqueSemiverbatimBody,
  OpaqueSemiverbatimEnd,
  OpaqueSemiverbatimEnvironment,
  OpaqueVerbatimBegin,
  OpaqueVerbatimBody,
  OpaqueVerbatimCapitalBegin,
  OpaqueVerbatimCapitalBody,
  OpaqueVerbatimCapitalEnd,
  OpaqueVerbatimCapitalEnvironment,
  OpaqueVerbatimEnd,
  OpaqueVerbatimEnvironment,
  OpaqueVerbatimStarBegin,
  OpaqueVerbatimStarBody,
  OpaqueVerbatimStarEnd,
  OpaqueVerbatimStarEnvironment,
  OptionalArgument,
  Group,
} from "./tex-parser.terms.js";

interface OpaqueEnvironmentTokens {
  readonly name: string;
  readonly begin: number;
  readonly body: number;
  readonly end: number;
  readonly node: number;
  readonly header: "body" | "optional" | "minted-language";
}

const ENVIRONMENTS: readonly OpaqueEnvironmentTokens[] = [
  {
    name: "BVerbatim",
    begin: OpaqueBVerbatimBegin,
    body: OpaqueBVerbatimBody,
    end: OpaqueBVerbatimEnd,
    node: OpaqueBVerbatimEnvironment,
    header: "optional",
  },
  {
    name: "Verbatim",
    begin: OpaqueVerbatimCapitalBegin,
    body: OpaqueVerbatimCapitalBody,
    end: OpaqueVerbatimCapitalEnd,
    node: OpaqueVerbatimCapitalEnvironment,
    header: "optional",
  },
  {
    name: "alltt",
    begin: OpaqueAllttBegin,
    body: OpaqueAllttBody,
    end: OpaqueAllttEnd,
    node: OpaqueAllttEnvironment,
    header: "body",
  },
  {
    name: "lstlisting",
    begin: OpaqueLstlistingBegin,
    body: OpaqueLstlistingBody,
    end: OpaqueLstlistingEnd,
    node: OpaqueLstlistingEnvironment,
    header: "optional",
  },
  {
    name: "minted",
    begin: OpaqueMintedBegin,
    body: OpaqueMintedBody,
    end: OpaqueMintedEnd,
    node: OpaqueMintedEnvironment,
    header: "minted-language",
  },
  {
    name: "semiverbatim",
    begin: OpaqueSemiverbatimBegin,
    body: OpaqueSemiverbatimBody,
    end: OpaqueSemiverbatimEnd,
    node: OpaqueSemiverbatimEnvironment,
    header: "body",
  },
  {
    name: "verbatim",
    begin: OpaqueVerbatimBegin,
    body: OpaqueVerbatimBody,
    end: OpaqueVerbatimEnd,
    node: OpaqueVerbatimEnvironment,
    header: "body",
  },
  {
    name: "verbatim*",
    begin: OpaqueVerbatimStarBegin,
    body: OpaqueVerbatimStarBody,
    end: OpaqueVerbatimStarEnd,
    node: OpaqueVerbatimStarEnvironment,
    header: "body",
  },
];

interface OpaqueEnvironmentContext {
  readonly environment: OpaqueEnvironmentTokens;
  readonly header: OpaqueEnvironmentTokens["header"];
}

export const opaqueEnvironmentContext =
  new ContextTracker<OpaqueEnvironmentContext | null>({
    start: null,
    shift(context, term, _stack, input) {
      const environment = ENVIRONMENTS.find((entry) => entry.begin === term);
      return environment &&
        matchesExact(input, `\\begin{${environment.name}}`)
        ? { environment, header: environment.header }
        : context;
    },
    reduce(context, term) {
      if (!context) {
        return null;
      }
      if (term === context.environment.node) {
        return null;
      }
      if (term === OptionalArgument && context.header === "optional") {
        return { ...context, header: "body" };
      }
      if (term === Group && context.header === "minted-language") {
        return { ...context, header: "body" };
      }
      return context;
    },
    reuse(context, node, _stack, input) {
      const environment = ENVIRONMENTS.find(
        (entry) => entry.begin === node.type.id
      );
      return environment &&
        matchesExact(input, `\\begin{${environment.name}}`)
        ? { environment, header: environment.header }
        : context;
    },
    strict: false,
  });

export const opaqueEnvironmentTokens = new ExternalTokenizer(
  (input, stack) => {
    const context = stack.context as OpaqueEnvironmentContext | null;
    if (!context) {
      for (const environment of ENVIRONMENTS) {
        if (
          stack.canShift(environment.begin) &&
          acceptExact(input, `\\begin{${environment.name}}`)
        ) {
          input.acceptToken(environment.begin);
          return;
        }
      }
      return;
    }

    const { environment } = context;
    if (
      stack.canShift(environment.end) &&
      acceptExact(input, `\\end{${environment.name}}`)
    ) {
      input.acceptToken(environment.end);
      return;
    }
    if (shouldParseHeader(input, context)) {
      return;
    }
    if (stack.canShift(environment.body)) {
      acceptBody(input, environment);
    }
  },
  { contextual: true }
);

function shouldParseHeader(
  input: InputStream,
  context: OpaqueEnvironmentContext
): boolean {
  if (context.header === "optional") {
    return input.next === 91;
  }
  if (context.header === "minted-language") {
    return input.next === 91 || input.next === 123;
  }
  return false;
}

function acceptBody(
  input: InputStream,
  environment: OpaqueEnvironmentTokens
): void {
  const terminator = `\\end{${environment.name}}`;
  let length = 0;
  while (input.next >= 0) {
    if (matchesExact(input, terminator)) {
      break;
    }
    input.advance();
    length += 1;
  }
  if (length > 0) {
    input.acceptToken(environment.body);
  }
}

function acceptExact(input: InputStream, value: string): boolean {
  if (!matchesExact(input, value)) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    input.advance();
  }
  return true;
}

function matchesExact(input: InputStream, value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (input.peek(index) !== value.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}
