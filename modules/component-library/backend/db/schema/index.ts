/**
 * Schema barrel — exports the tables the component-library repositories
 * need at compile time. Only `component` and `componentVariant` are used
 * for the first-pass new-component wizard flow; other schema files remain
 * in this directory but are not exported until their repositories are
 * wired up in a later pass.
 */

export * from "./base";
export * from "./component";
export * from "./component-variant";
