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
}

/** Second level deep */
class Bar {
    readonly isBar = true;
}
