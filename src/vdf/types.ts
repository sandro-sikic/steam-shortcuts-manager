/** A VDF value: a string, an unsigned 32-bit integer, or a nested map (insertion-ordered). */
export type VdfValue = string | number | VdfMap;
export type VdfMap = Map<string, VdfValue>;
