/**
 * This module has a single level of missing exports, not requiring any recursive
 * discovery of non-exported symbols.
 * @module
 */

/**
 * This type is properly exported.
 */
export function foo(): FooType {
	return 123 as FooType;
}

/**
 * This is an internal type which is not exported.
 */
type FooType = number & { readonly __fooType: unique symbol };
