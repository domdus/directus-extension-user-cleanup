import { MAX_USERS } from './config';
import type { ReferenceAction, ReferenceKind, Resolution } from './types';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Rows that are the user's own access, not shared content.
 * Always removed during delete, and the wizard only offers Delete Rows.
 */
export const DELETE_ONLY_TARGETS = new Set([
	'directus_sessions.user',
	'directus_access.user',
	'directus_permissions.user',
	'directus_notifications.recipient',
]);

/** Safety net inside the delete transaction, even if the scan missed a row. */
export const FORCE_DELETE_TARGETS: Array<{ collection: string; field: string }> = [
	{ collection: 'directus_sessions', field: 'user' },
	{ collection: 'directus_access', field: 'user' },
	{ collection: 'directus_permissions', field: 'user' },
	{ collection: 'directus_notifications', field: 'recipient' },
];

const ACTIONS = new Set<ReferenceAction>(['null', 'reassign', 'delete_rows', 'skip']);

export type ReferenceInput = {
	collection: string;
	field: string;
	nullable: boolean;
	onDelete: string;
	junction: boolean;
};

export type ValidatedReference = ReferenceInput & {
	count: number;
	blocks: boolean;
	allowedActions: ReferenceAction[];
};

export function isSafeIdentifier(value: string): boolean {
	return IDENTIFIER.test(value);
}

export function referenceKey(collection: string, field: string): string {
	return `${collection}.${field}`;
}

export function isReferenceAction(value: unknown): value is ReferenceAction {
	return typeof value === 'string' && ACTIONS.has(value as ReferenceAction);
}

export function normalizeOnDelete(value: unknown): string {
	const raw = String(value ?? '')
		.trim()
		.toUpperCase()
		.replace(/_/g, ' ');
	if (!raw) return 'NO ACTION';
	return raw;
}

export function referenceKind(input: ReferenceInput): ReferenceKind {
	const key = referenceKey(input.collection, input.field);
	if (key === 'directus_notifications.recipient') return 'inbox';
	if (key === 'directus_presets.user') return 'preset';
	if (DELETE_ONLY_TARGETS.has(key)) return 'auth';
	if (input.junction) return 'junction';
	if (input.collection.startsWith('directus_')) return 'system';
	return 'content';
}

/** Cascade may remove these rows. It must not remove files or other content. */
export function safeToCascade(input: ReferenceInput): boolean {
	const kind = referenceKind(input);
	return kind === 'auth' || kind === 'inbox' || kind === 'preset' || kind === 'junction';
}

/**
 * True when deleting the user would fail, or would cascade-delete content
 * (for example files whose uploader FK is ON DELETE CASCADE).
 */
export function referenceBlocks(input: ReferenceInput): boolean {
	const rule = normalizeOnDelete(input.onDelete);
	if (rule === 'NONE' || rule === 'SET NULL') return false;
	if (rule === 'CASCADE' && safeToCascade(input)) return false;
	return true;
}

export function allowedActions(input: ReferenceInput): ReferenceAction[] {
	const key = referenceKey(input.collection, input.field);
	if (DELETE_ONLY_TARGETS.has(key)) return ['delete_rows'];

	const actions: ReferenceAction[] = [];
	const kind = referenceKind(input);
	const protectedCollection = input.collection === 'directus_users' || input.collection === 'directus_files';

	if ((kind === 'preset' || kind === 'junction') && !protectedCollection) actions.push('delete_rows');
	if (input.nullable) actions.push('null');
	if (kind !== 'preset') actions.push('reassign');
	if (!referenceBlocks(input)) actions.push('skip');

	return actions;
}

export function suggestedAction(input: ReferenceInput, hasReassignTarget: boolean): ReferenceAction {
	const actions = allowedActions(input);
	const kind = referenceKind(input);

	if ((kind === 'auth' || kind === 'inbox' || kind === 'preset' || kind === 'junction') && actions.includes('delete_rows')) {
		return 'delete_rows';
	}
	if (!referenceBlocks(input) && actions.includes('skip')) return 'skip';
	if (input.nullable && actions.includes('null')) return 'null';
	if (hasReassignTarget && actions.includes('reassign')) return 'reassign';
	const concrete = actions.find((action) => action !== 'skip');
	return concrete || actions[0] || 'skip';
}

export function validateResolutions(
	references: ValidatedReference[],
	resolutions: Resolution[],
	reassignTargetIds: Set<string>,
): { ok: true } | { ok: false; message: string } {
	const refsByKey = new Map<string, ValidatedReference>();
	for (const reference of references) {
		refsByKey.set(referenceKey(reference.collection, reference.field), reference);
	}

	const seen = new Set<string>();
	for (const resolution of resolutions) {
		if (!isSafeIdentifier(resolution.collection) || !isSafeIdentifier(resolution.field)) {
			return { ok: false, message: 'Invalid collection or field' };
		}
		if (!isReferenceAction(resolution.action)) {
			return { ok: false, message: 'Unknown resolution action' };
		}

		const key = referenceKey(resolution.collection, resolution.field);
		if (seen.has(key)) return { ok: false, message: `Duplicate resolution for ${key}` };
		seen.add(key);

		const reference = refsByKey.get(key);
		if (!reference) return { ok: false, message: `Unknown reference ${key}` };
		if (!reference.allowedActions.includes(resolution.action)) {
			return { ok: false, message: `${resolution.action} is not allowed for ${key}` };
		}
		if (resolution.action === 'delete_rows' && (resolution.collection === 'directus_users' || resolution.collection === 'directus_files')) {
			return { ok: false, message: `Refusing to delete rows from ${resolution.collection}` };
		}
		if (resolution.action === 'reassign') {
			const target = String(resolution.reassignTo || '').trim();
			if (!target || !reassignTargetIds.has(target)) {
				return { ok: false, message: `Choose a user to receive ${key}` };
			}
		}
	}

	for (const reference of references) {
		if (reference.count <= 0 || !reference.blocks) continue;
		const key = referenceKey(reference.collection, reference.field);
		if (!seen.has(key)) return { ok: false, message: `${key} still blocks deletion` };
	}

	return { ok: true };
}

export function assertUsersDeletable(options: {
	userIds: string[];
	selfId: string | null;
	knownUserIds: Set<string>;
	adminIds: string[];
}): { ok: true; userIds: string[] } | { ok: false; message: string } {
	const userIds = [...new Set(options.userIds.map((id) => String(id).trim()).filter(Boolean))];

	if (userIds.length === 0) return { ok: false, message: 'Select at least one user' };
	if (userIds.length > MAX_USERS) {
		return { ok: false, message: `Select at most ${MAX_USERS} users at a time` };
	}
	if (options.selfId && userIds.includes(options.selfId)) {
		return { ok: false, message: 'You cannot delete your own user' };
	}
	for (const id of userIds) {
		if (!options.knownUserIds.has(id)) return { ok: false, message: 'One or more users were not found' };
	}

	const admins = new Set(options.adminIds.map(String));
	if (options.selfId) admins.add(options.selfId);
	const remaining = [...admins].filter((id) => !userIds.includes(id));
	if (admins.size > 0 && remaining.length === 0) {
		return { ok: false, message: 'Refusing to delete the last admin user' };
	}

	return { ok: true, userIds };
}

export function sortResolutions(resolutions: Resolution[]): Resolution[] {
	const order: Record<ReferenceAction, number> = {
		delete_rows: 0,
		null: 1,
		reassign: 2,
		skip: 3,
	};
	return [...resolutions].sort((a, b) => order[a.action] - order[b.action]);
}
