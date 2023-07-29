/**
 * This module has a two levels of missing exports, requiring the plugin to recursively
 * check for exports.
 * @module
 */

/**
 * This type is properly exported.
 */
export declare function foo(): Foo;

/** First level deep */
class Foo {
    bar?: Bar;
    baz?: Baz;
}

/** Second level deep */
class Bar {
    /** @internal */
    readonly isBar = true;
}

/** @internal */
class Baz {
    readonly isBaz = true;
}
