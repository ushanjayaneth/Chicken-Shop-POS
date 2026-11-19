export type CoconutSnapshot = Record<string, unknown>;
export interface CoconutCommand {id: string; updates: Record<string, unknown>; expected: Record<string, unknown>}
export const ledgerCollections: string[];
export function validId(id: unknown): id is string;
export function coconutSnapshot(source: CoconutSnapshot, settings: Record<string, unknown>): CoconutSnapshot;
export function publicSnapshot(snapshot: CoconutSnapshot): CoconutSnapshot;
export function validateCommand(command: unknown): asserts command is CoconutCommand;
export function applyCoconutCommand(snapshot: CoconutSnapshot, command: CoconutCommand): {snapshot: CoconutSnapshot; replayed: boolean};
