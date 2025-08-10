/**
 * This module has a few unexported symbols which are only referenced via a {\@link} tag.
 *
 * It serves as a test for the the following issue: https://github.com/Gerrit0/typedoc-plugin-missing-exports/issues/33.
 *
 * @module
 */

/**
 * Does what it says on the tin!
 *
 * For those who prefer a more Java-like approach,
 * please see {@link GreatnessFactoryFactoryBuilderAdapterSingleton.get | get}
 * and {@link GreatnessFactoryFactoryBuilderAdapterSingleton.build | build}
 * on {@link GreatnessFactoryFactoryBuilderAdapterSingleton}.
 */
function greatnessFactory(num: SecretType) {
	return `${num}× as great!`;
}

// used to test that combining the usual reference discovery with link discovery works.
/** Despite JavaScript's idiosyncrasies, not the same as {@link SecretType2}! */
type SecretType =
	| number
	| (void & { _: "something interesting for typedoc to document this type" });
type SecretType2 = string;

class GreatnessFactoryFactoryBuilderAdapterSingleton {
	static get = () => {
		// TBD. :)
	};

	build() {
		// TBD. :)
	}
}

/**
 * Even better than {@link myBasicSymbol}!
 *
 * @see {@link greatnessFactory} — the source of all this greatness.
 *
 * @privateRemarks This is as great as we can let the users have—keep {@link mySecretSymbol} well hidden!
 */
export const myGreatSymbol = greatnessFactory(1);

/** Just your regular kind of stuff. Better be glad it's not {@link ShamefullyHidden.myWorstSymbol}! */
const myBasicSymbol = greatnessFactory(-1);

/** Only for internal use! It's too powerful for the general public! */
const mySecretSymbol = greatnessFactory(2);

namespace ShamefullyHidden {
	// must be exported, as only links resolvable by TS (i.e. what `useTsLinkResolution` does) are supported for now.
	export const myWorstSymbol = greatnessFactory(-2);
}
