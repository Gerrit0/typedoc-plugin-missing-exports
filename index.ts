import { relative } from "path";
import {
	Application,
	ContainerReflection,
	Context,
	Converter,
	DeclarationReflection,
	JSX,
	ParameterType,
	ProjectReflection,
	Reflection,
	ReflectionKind,
	ReflectionSymbolId,
	Renderer,
	TypeScript as ts,
} from "typedoc";

declare module "typedoc" {
	export interface TypeDocOptionMap {
		internalModule: string;
		placeInternalsInOwningModule: boolean;
		collapseInternalModule: boolean;
		includeDocCommentReferences: boolean;
	}

	export interface Reflection {
		[InternalModule]?: boolean;
	}
}

let hasMonkeyPatched = false;
const ModuleLike: ReflectionKind = ReflectionKind.Project | ReflectionKind.Module;
const InternalModule = Symbol();

const HOOK_JS = `
<script>for (let k in localStorage) if (k.includes("tsd-accordion-") && k.includes(NAME)) localStorage.setItem(k, "false");</script>
`.trim();

export function load(app: Application) {
	if (hasMonkeyPatched) {
		throw new Error(
			"typedoc-plugin-missing-exports cannot be loaded multiple times",
		);
	}
	hasMonkeyPatched = true;

	const referencedSymbols = new Map<ts.Program, Set<ts.Symbol>>();
	const symbolToOwningModule = new Map<ts.Symbol, Reflection>();
	const knownPrograms = new Map<Reflection, ts.Program>();

	/**
	 * Extracts the set of referenced but export-missing symbols owned by a particular module.
	 *
	 * > [!CAUTION]
	 * > This function is not pure. The returned symbols are removed from the “referenced” set and will not be returned again.
	 */
	function discoverMissingExports(
		owningModule: Reflection,
		context: Context,
		program: ts.Program,
	): Set<ts.Symbol> {
		// An export is missing if if was referenced
		// and is not contained in the documented reflections.
		const referenced = referencedSymbols.get(program) || new Set();
		const ownedByOther = new Set<ts.Symbol>();
		referencedSymbols.set(program, ownedByOther);

		for (const s of [...referenced]) {
			if (context.getReflectionFromSymbol(s)) {
				referenced.delete(s);
			} else if (symbolToOwningModule.get(s) !== owningModule) {
				referenced.delete(s);
				ownedByOther.add(s);
			}
		}

		return referenced;
	}

	/**
	 * Adds a symbol to the set of referenced (but not necessarily unexported) symbols in the provided {@link Context}.
	 */
	function markSymbolReferenced(
		symbol: ts.Symbol,
		owningModule: Reflection,
		program: ts.Program,
	) {
		const set = referencedSymbols.get(program);
		symbolToOwningModule.set(symbol, owningModule);
		if (set) {
			set.add(symbol);
		} else {
			referencedSymbols.set(program, new Set([symbol]));
		}
	}

	// Monkey patch the constructor for references so that we can inspect them.
	const origCreateSymbolReference = Context.prototype.createSymbolReference;
	Context.prototype.createSymbolReference = function (symbol, context, name) {
		const owningModule = getOwningModule(context);
		markSymbolReferenced(symbol, owningModule, context.program);
		return origCreateSymbolReference.call(this, symbol, context, name);
	};

	app.options.addDeclaration({
		name: "internalModule",
		help: "[typedoc-plugin-missing-exports] Define the name of the module that internal symbols which are not exported should be placed into.",
		defaultValue: "<internal>",
	});

	app.options.addDeclaration({
		name: "collapseInternalModule",
		help: "[typedoc-plugin-missing-exports] Include JS in the page to collapse all <internal> entries in the navigation on page load.",
		defaultValue: false,
		type: ParameterType.Boolean,
	});

	app.options.addDeclaration({
		name: "placeInternalsInOwningModule",
		help:
			"[typedoc-plugin-missing-exports] If set internal symbols will not be placed into an internals module, but directly into the module which references them.",
		defaultValue: false,
		type: ParameterType.Boolean,
	});

	app.options.addDeclaration({
		name: "includeDocCommentReferences",
		help: "[typedoc-plugin-missing-exports] If set, also export private symbols only referenced via documentation comments using the @link family of tags.",
		defaultValue: false,
		type: ParameterType.Boolean,
	});

	app.converter.on(Converter.EVENT_BEGIN, () => {
		if (
			app.options.getValue("placeInternalsInOwningModule") &&
			app.options.isSet("internalModule")
		) {
			app.logger.warn(
				`[typedoc-plugin-missing-exports] Both placeInternalsInOwningModule and internalModule are set, the internalModule option will be ignored.`,
			);
		}
	});

	app.converter.on(
		Converter.EVENT_CREATE_DECLARATION,
		(context: Context, refl: Reflection) => {
			// TypeDoc 0.26+ doesn't fire EVENT_CREATE_DECLARATION for project
			// We need to ensure the project has a program attached to it, so
			// do that when the first declaration is created.
			if (knownPrograms.size === 0) {
				knownPrograms.set(refl.project, context.program);
			}
			if (refl.kindOf(ModuleLike)) {
				knownPrograms.set(refl, context.program);
			}

			// #12 - This plugin might cause TypeDoc to convert some module without
			// an export symbol to give it a name other than the full absolute
			// path to the symbol. Detect this and rename it to a relative path
			// based on base path if specified or CWD.
			const symbol = context.getSymbolFromReflection(refl);
			const file = symbol?.declarations?.find(ts.isSourceFile);
			if (file && /^".*"$/.test(refl.name)) {
				refl.name = getModuleName(
					file.fileName,
					app.options.getValue("basePath") || process.cwd(),
				);
			}
		},
	);

	app.converter.on(
		Converter.EVENT_RESOLVE_BEGIN,
		function onResolveBegin(context: Context) {
			const modules: (DeclarationReflection | ProjectReflection)[] = context.project.getChildrenByKind(
				ReflectionKind.Module,
			);
			if (modules.length === 0) {
				// Single entry point, just target the project.
				modules.push(context.project);
			}

			const docCommentLinksProcessed = new Set<Reflection>();

			for (const mod of modules) {
				const program = knownPrograms.get(mod);
				if (!program) continue;

				if (app.options.getValue("includeDocCommentReferences"))
					discoverLinkedSymbols(docCommentLinksProcessed, context, program);
				let missing = discoverMissingExports(mod, context, program);
				if (!missing.size) continue;

				// Nasty hack here that will almost certainly break in future TypeDoc versions.
				context.setActiveProgram(program);

				let internalContext: Context;
				if (app.options.getValue("placeInternalsInOwningModule")) {
					internalContext = context.withScope(mod);
				} else {
					const internalNs = context
						.withScope(mod)
						.createDeclarationReflection(
							ReflectionKind.Module,
							void 0,
							void 0,
							app.options.getValue("internalModule"),
						);
					internalNs[InternalModule] = true;
					context.finalizeDeclarationReflection(internalNs);
					internalContext = context.withScope(mod).withScope(internalNs);
				}

				// Keep track of which symbols we've tried to convert. If they don't get converted
				// when calling convertSymbol, then the user has excluded them somehow, don't go into
				// an infinite loop when converting.
				const tried = new Set<ts.Symbol>();

				// Any re-exports will be deferred, so we need to allow deferred conversion here
				// and finalize it after the loop.
				app.converter.permitDeferredConversion();
				do {
					for (const s of missing) {
						if (shouldConvertSymbol(s, context.checker)) {
							internalContext.converter.convertSymbol(internalContext, s);
						}
						tried.add(s);
					}

					if (app.options.getValue("includeDocCommentReferences"))
						discoverLinkedSymbols(docCommentLinksProcessed, context, program);
					missing = discoverMissingExports(mod, context, program);
					for (const s of tried) {
						missing.delete(s);
					}
				} while (missing.size > 0);
				app.converter.finalizeDeferredConversion();

				// If we added a module and all the missing symbols were excluded, get rid of our namespace.
				if (
					internalContext.scope[InternalModule]
					&& !(internalContext.scope as ContainerReflection).children?.length
				) {
					context.project.removeReflection(internalContext.scope);
				}

				context.setActiveProgram(void 0);
			}

			knownPrograms.clear();
			referencedSymbols.clear();
			symbolToOwningModule.clear();
		},
		1e9,
	);

	app.renderer.on(Renderer.EVENT_BEGIN, () => {
		if (app.options.getValue("collapseInternalModule")) {
			app.renderer.hooks.on("head.end", () =>
				JSX.createElement(JSX.Raw, {
					html: HOOK_JS.replace(
						"NAME",
						JSON.stringify(app.options.getValue("internalModule")),
					),
				}));
		}
	});

	function discoverLinkedSymbols(
		docCommentLinksProcessed: Set<Reflection>,
		context: Context,
		program: ts.Program,
	) {
		for (const refl of Object.values(context.project.reflections).filter(
			(refl) => !docCommentLinksProcessed.has(refl),
		)) {
			docCommentLinksProcessed.add(refl);

			const linkTags = ["@link", "@linkcode", "@linkplain"];

			if (refl.comment !== undefined)
				for (const part of [
					...refl.comment.summary,
					...refl.comment.blockTags
						.filter((bt) => bt.tag != "@privateRemarks")
						.flatMap((bt) => bt.content),
				]) {
					if (
						part.kind === "inline-tag" &&
						linkTags.includes(part.tag) &&
						part.target instanceof ReflectionSymbolId
					) {
						const [symbol, decl] = resolveReflectionSymbolId(
							part.target,
							program,
						);
						const owningSymbol = getNodeOwningSymbol(
							decl,
							program.getTypeChecker(),
						);
						const owningModule = context.getReflectionFromSymbol(owningSymbol);

						// if we can't tell who owns the target, it's likely an undocumented file or namespace.
						if (owningModule === undefined) continue;

						markSymbolReferenced(symbol, owningModule, program);
					}
				}
		}
	}
}

/**
 * Attempts to locate a {@link ts.Symbol} that corresponds to the provided {@link ReflectionSymbolId} in a given program.
 *
 * > [!NOTE]
 * > Currently, this resolution is implemented as a walk over the TS AST, as TypeDoc does not preserve information about non-exported `ReflectionSymbolId`s.
 * >
 * > There are some heuristics involved in this search, so it might not locate all possible symbols.
 */
function resolveReflectionSymbolId(
	target: ReflectionSymbolId,
	program: ts.Program,
): [symbol: ts.Symbol, declaration: ts.Node] {
	if (target.fileName === undefined) throw new Error("missing file path :(");

	const sourceFile = program.getSourceFile(target.fileName);
	if (sourceFile === undefined) throw new Error("source file unknown :(");

	let token = getTokenByStartPos(sourceFile, target.pos);

	const checker = program.getTypeChecker();

	let node: ts.Node | undefined = token;
	while (node !== undefined) {
		const symbolNode =
			ts.isDeclarationStatement(node) ||
			[
				ts.SyntaxKind.VariableDeclaration,
				ts.SyntaxKind.PropertyDeclaration,
				ts.SyntaxKind.MethodDeclaration,
			].includes(node.kind)
				? (node as ts.NamedDeclaration).name
				: undefined;

		if (symbolNode !== undefined) {
			const symbol = checker.getSymbolAtLocation(symbolNode);

			if (symbol === undefined)
				throw new Error("the located node does not seem to hold a symbol.");

			const targetName = target.qualifiedName.split(".").at(-1)!;
			if (symbol.name !== targetName)
				throw new Error(
					`the located symbol's name (\`${symbol.name}\`) doesn't match the expected one (\`${targetName}\`); the referenced symbol may be currently unsupported.`,
				);

			return [symbol, node];
		}
		node = node.parent;
	}
	throw new Error(
		"failed to locate a symbol-holding node for the target token; the referenced symbol may be currently unsupported.",
	);
}

function getTokenByStartPos(sourceFile: ts.SourceFile, pos: number): ts.Node {
	let token: ts.Node = sourceFile;
	while (!ts.isToken(token)) {
		const nodeNext = token
			.getChildren()
			.find((ch) => ch.pos <= pos && pos < ch.end);

		if (nodeNext === undefined)
			throw new Error("there are no tokens at the requested position. :(");

		token = nodeNext;
	}

	if (token.getStart() != pos)
		throw new Error(
			"the requested position does not point at a start of a token.",
		);

	return token;
}

function getOwningModule(context: Context): Reflection {
	let refl = context.scope;
	// Go up the reflection hierarchy until we get to a module
	while (!refl.kindOf(ModuleLike)) {
		refl = refl.parent!;
	}

	// The <internal> module cannot be an owning module.
	if (refl[InternalModule]) {
		return refl.parent!;
	}

	return refl;
}

function getNodeOwningSymbol(
	node: ts.Node,
	checker: ts.TypeChecker,
): ts.Symbol {
	let ancestor: ts.Node | undefined = node.parent;
	while (ancestor !== undefined) {
		const symbolNode = ts.isDeclarationStatement(ancestor)
			? ancestor.name
			: ts.isSourceFile(ancestor)
				? ancestor
				: undefined;

		if (symbolNode !== undefined) {
			const sym = checker.getSymbolAtLocation(symbolNode);
			if (sym === undefined)
				throw new Error(
					"the symbol node does not seem to have an associated symbol. this is a bug.",
				);
			return sym;
		}

		ancestor = ancestor.parent;
	}
	throw new Error("every node should have an owning `SourceFile`.");
}

function shouldConvertSymbol(symbol: ts.Symbol, checker: ts.TypeChecker) {
	while (symbol.flags & ts.SymbolFlags.Alias) {
		symbol = checker.getAliasedSymbol(symbol);
	}

	// We're looking at an unknown symbol which is declared in some package without
	// type declarations. We know nothing about it, so don't convert it.
	if (symbol.flags & ts.SymbolFlags.Transient) {
		return false;
	}

	// This is something inside the special Node `Globals` interface. Don't convert it
	// because TypeDoc will reasonably assert that "Property" means that a symbol should be
	// inside something that can have properties.
	if (symbol.flags & ts.SymbolFlags.Property && symbol.name !== "default") {
		return false;
	}

	return true;
}

function getModuleName(fileName: string, baseDir: string) {
	return relative(baseDir, fileName)
		.replace(/\\/g, "/")
		.replace(/(\/index)?(\.d)?\.([cm]?[tj]s|[tj]sx?)$/, "");
}
