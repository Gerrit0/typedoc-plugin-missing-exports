import { relative } from "path";
import {
	Application,
	CommentDisplayPart,
	ContainerReflection,
	Context,
	Converter,
	DeclarationReflection,
	InlineTagDisplayPart,
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
	const symbolIdKeyToSymbol = new Map<string, ts.Symbol>();

	/**
	 * Extracts the set of referenced but export-missing symbols owned by a particular module.
	 *
	 * > [!CAUTION]
	 * > This function is not pure. The returned symbols are removed from the "referenced" set and will not be returned again.
	 */
	function discoverMissingExports(
		owningModule: Reflection,
		context: Context,
		program: ts.Program,
	): Set<ts.Symbol> {
		// An export is missing if it was referenced and
		// is not contained in the documentation
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
	Context.prototype.createSymbolReference = function(symbol, context, name) {
		const owningModule = getOwningModule(context);
		markSymbolReferenced(symbol, owningModule, context.program);
		return origCreateSymbolReference.call(this, symbol, context, name);
	};

	const origCreateSymbolId = Context.prototype.createSymbolId;
	Context.prototype.createSymbolId = function(symbol, declaration) {
		// We don't immediately mark the symbol as referenced here because we
		// don't want to include referenced symbols from comments which will
		// be excluded by the excludeTags option.
		const id = origCreateSymbolId.call(this, symbol, declaration);
		symbolIdKeyToSymbol.set(id.getStableKey(), symbol);
		return id;
	};

	app.options.addDeclaration({
		name: "internalModule",
		help:
			"[typedoc-plugin-missing-exports] Define the name of the module that internal symbols which are not exported should be placed into.",
		defaultValue: "<internal>",
	});

	app.options.addDeclaration({
		name: "collapseInternalModule",
		help:
			"[typedoc-plugin-missing-exports] Include JS in the page to collapse all <internal> entries in the navigation on page load.",
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
		help:
			"[typedoc-plugin-missing-exports] If set, also export private symbols only referenced via documentation comments using the @link family of tags.",
		defaultValue: false,
		type: ParameterType.Boolean,
	});

	app.converter.on(Converter.EVENT_BEGIN, () => {
		if (
			app.options.getValue("placeInternalsInOwningModule")
			&& app.options.isSet("internalModule")
		) {
			app.logger.warn(
				`[typedoc-plugin-missing-exports] Both placeInternalsInOwningModule and internalModule are set, the internalModule option will be ignored.`,
			);
		}

		if (app.options.getValue("includeDocCommentReferences") && Number(Application.VERSION.slice(5)) < 9) {
			app.logger.warn(
				`[typedoc-plugin-missing-exports] The includeDocCommentReferences option requires TypeDoc 0.28.9 or later.`,
			);
		}
	});

	function addCommentReferencedSymbols(context: Context, refl: Reflection) {
		if (app.options.getValue("includeDocCommentReferences")) {
			visitReflectionLinkTags(refl, app.options.getValue("excludeTags"), part => {
				const symbol = part.target instanceof ReflectionSymbolId && symbolIdKeyToSymbol.get(part.target.getStableKey());
				if (symbol) {
					markSymbolReferenced(symbol, getOwningModule(context), context.program);
				}
			});
		}
	}

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

			addCommentReferencedSymbols(context, refl);
		},
	);

	app.converter.on(Converter.EVENT_CREATE_SIGNATURE, (context, sig) => {
		addCommentReferencedSymbols(context, sig);
	});

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

			let first = true;

			for (const mod of modules) {
				const program = knownPrograms.get(mod);
				if (!program) continue;

				// Nasty hack here that will almost certainly break in future TypeDoc versions.
				// Do this before discovering missing exports as discovering missing exports will
				// create symbol IDs, which requires a program due to our override of the method
				// on TypeDoc's Context.
				context.setActiveProgram(program);

				if (first) {
					// We have to do this here because we rely on there being an active program,
					// but there isn't any active program during the CREATE_PROJECT event.
					addCommentReferencedSymbols(context, context.project);
					first = false;
				}

				let missing = discoverMissingExports(mod, context, program);
				if (!missing.size) continue;

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
			symbolIdKeyToSymbol.clear();
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
}

function visitReflectionLinkTags(
	reflection: Reflection,
	excludeTags: readonly `@${string}`[],
	visitor: (part: InlineTagDisplayPart) => void,
) {
	if (reflection.isProject() || reflection.isDeclaration()) {
		visitLinkTags(reflection.readme || [], visitor);
	}

	if (reflection.isDocument()) {
		visitLinkTags(reflection.content || [], visitor);
	}

	if (reflection.comment) {
		visitLinkTags(reflection.comment.summary, visitor);
		for (const tag of reflection.comment.blockTags) {
			if (!excludeTags.includes(tag.tag)) {
				visitLinkTags(tag.content, visitor);
			}
		}
	}

	if (
		reflection.isDeclaration()
		&& reflection.kindOf(ReflectionKind.TypeAlias)
		&& reflection.type?.type === "union"
		&& reflection.type.elementSummaries
	) {
		for (const parts of reflection.type.elementSummaries) {
			visitLinkTags(parts, visitor);
		}
	}
}

function visitLinkTags(parts: readonly CommentDisplayPart[], visitor: (part: InlineTagDisplayPart) => void) {
	const linkTags = ["@link", "@linkcode", "@linkplain"];
	for (const part of parts) {
		if (part.kind === "inline-tag" && linkTags.includes(part.tag)) {
			visitor(part);
		}
	}
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

function shouldConvertSymbol(symbol: ts.Symbol, checker: ts.TypeChecker) {
	while (symbol.flags & ts.SymbolFlags.Alias) {
		symbol = checker.getAliasedSymbol(symbol);
	}

	// We're looking at an unknown symbol which is declared in some package without
	// type declarations. We know nothing about it, so don't convert it.
	if (symbol.flags & ts.SymbolFlags.Transient) {
		return false;
	}

	// #35 - Since TypeDoc#2978, TypeDoc will create symbol references which point to
	// class methods. This previously wasn't an issue since references were set up directly
	// upon resolution, but #2978 needs to use symbols to detect methods through inheritance.
	// This somewhat breaks this plugin since we expect to be able to go through all created
	// references and for them to be real missed values. It wasn't intentional that this
	// plugin would lift class/interface symbols up out of the included classes; we'll just
	// entirely ignore symbol references to methods here.
	if (symbol.flags & ts.SymbolFlags.Method) {
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
