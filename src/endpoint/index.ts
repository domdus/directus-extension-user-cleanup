import type { Request, Response, Router } from 'express';
import { accountabilityIsAdmin } from '../shared/admin';
import { FORCE_DELETE_TARGETS, assertUsersDeletable, sortResolutions, validateResolutions, type ValidatedReference } from '../shared/policy';
import { applyResolution, getClientName, listUserReferences } from '../shared/references';
import type { AppliedResolution, CleanupUser, Resolution } from '../shared/types';

type EndpointExtensionContext = {
	database: any;
	getSchema: () => Promise<any>;
	logger: {
		info: (msg: string, ...args: unknown[]) => void;
		warn: (msg: string, ...args: unknown[]) => void;
		error: (msg: string, ...args: unknown[]) => void;
	};
};

type DatabaseUserRow = {
	id: string | number;
	email?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	status?: string | null;
};

function requireAdmin(req: Request, res: Response): boolean {
	if (!accountabilityIsAdmin((req as any).accountability)) {
		res.status(403).json({
			errors: [{ message: 'Admin access required', extensions: { code: 'FORBIDDEN' } }],
		});
		return false;
	}
	return true;
}

function currentUserId(req: Request): string | null {
	const user = (req as any).accountability?.user;
	if (user == null || user === '') return null;
	return String(user);
}

function sendError(res: Response, status: number, message: string) {
	res.status(status).json({ errors: [{ message }] });
}

function truthyFlag(client: string): boolean | number {
	if (client.includes('pg') || client.includes('postgres') || client.includes('cockroach')) return true;
	return 1;
}

async function listAdminIds(database: any, logger: EndpointExtensionContext['logger']): Promise<Set<string>> {
	const ids = new Set<string>();
	const client = getClientName(database);
	const flag = truthyFlag(client);

	try {
		const hasPolicies = await database.schema.hasTable('directus_policies');
		const hasAccess = await database.schema.hasTable('directus_access');
		if (hasPolicies && hasAccess && (await database.schema.hasColumn('directus_policies', 'admin_access'))) {
			const direct = await database('directus_access as a')
				.join('directus_policies as p', 'a.policy', 'p.id')
				.where('p.admin_access', flag)
				.whereNotNull('a.user')
				.select('a.user as id');
			for (const row of direct || []) ids.add(String(row.id));

			if (await database.schema.hasColumn('directus_users', 'role')) {
				const viaRole = await database('directus_users as u')
					.join('directus_access as a', 'a.role', 'u.role')
					.join('directus_policies as p', 'a.policy', 'p.id')
					.where('p.admin_access', flag)
					.whereNotNull('u.role')
					.select('u.id as id');
				for (const row of viaRole || []) ids.add(String(row.id));
			}
			return ids;
		}

		if (
			(await database.schema.hasTable('directus_roles')) &&
			(await database.schema.hasColumn('directus_roles', 'admin_access')) &&
			(await database.schema.hasColumn('directus_users', 'role'))
		) {
			const rows = await database('directus_users as u')
				.join('directus_roles as r', 'u.role', 'r.id')
				.where('r.admin_access', flag)
				.select('u.id as id');
			for (const row of rows || []) ids.add(String(row.id));
		}
	} catch (error: any) {
		logger.warn(`[user-cleanup] Could not list admin users: ${error?.message || error}`);
	}

	return ids;
}

async function loadUsers(
	database: any,
	logger: EndpointExtensionContext['logger'],
	selfId: string | null,
): Promise<CleanupUser[]> {
	const columns = ['id'];
	if (await database.schema.hasColumn('directus_users', 'email')) columns.push('email');
	if (await database.schema.hasColumn('directus_users', 'first_name')) columns.push('first_name');
	if (await database.schema.hasColumn('directus_users', 'last_name')) columns.push('last_name');
	if (await database.schema.hasColumn('directus_users', 'status')) columns.push('status');

	const rows = (await database('directus_users')
		.select(columns)
		.orderBy(columns.includes('email') ? 'email' : 'id')) as DatabaseUserRow[];
	const adminIds = await listAdminIds(database, logger);

	return rows.map((row) => {
		const id = String(row.id);
		return {
			id,
			email: row.email ? String(row.email) : null,
			firstName: row.first_name ? String(row.first_name) : null,
			lastName: row.last_name ? String(row.last_name) : null,
			status: row.status ? String(row.status) : null,
			admin: adminIds.has(id) || id === selfId,
			self: selfId != null && id === selfId,
		};
	});
}

function parseUserIds(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((id) => String(id).trim()).filter(Boolean);
}

function parseResolutions(raw: unknown): Resolution[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((item) => {
		const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
		return {
			collection: String(record.collection || '').trim(),
			field: String(record.field || '').trim(),
			action: record.action as Resolution['action'],
			reassignTo: record.reassignTo == null ? null : String(record.reassignTo).trim(),
		};
	});
}

async function forceDeleteAuthRows(database: any, userIds: string[]): Promise<AppliedResolution[]> {
	const applied: AppliedResolution[] = [];
	for (const target of FORCE_DELETE_TARGETS) {
		const hasTable = await database.schema.hasTable(target.collection);
		if (!hasTable) continue;
		const hasColumn = await database.schema.hasColumn(target.collection, target.field);
		if (!hasColumn) continue;
		const affected = await applyResolution(
			database,
			{ collection: target.collection, field: target.field, action: 'delete_rows' },
			userIds,
		);
		if (affected > 0) {
			applied.push({ ...target, action: 'delete_rows', affected });
		}
	}
	return applied;
}

export default (router: Router, context: EndpointExtensionContext) => {
	const { database, getSchema, logger } = context;

	router.get('/', async (req: Request, res: Response) => {
		if (!requireAdmin(req, res)) return;

		try {
			const users = await loadUsers(database, logger, currentUserId(req));
			res.json({ data: { users } });
		} catch (error: any) {
			logger.error(`[user-cleanup] list failed: ${error?.message || error}`);
			sendError(res, 500, error?.message || 'Failed to list users');
		}
	});

	router.post('/inspect', async (req: Request, res: Response) => {
		if (!requireAdmin(req, res)) return;

		try {
			const selfId = currentUserId(req);
			const users = await loadUsers(database, logger, selfId);
			const verdict = assertUsersDeletable({
				userIds: parseUserIds(req.body?.userIds),
				selfId,
				knownUserIds: new Set(users.map((user) => user.id)),
				adminIds: users.filter((user) => user.admin).map((user) => user.id),
			});
			if (!verdict.ok) {
				sendError(res, 400, verdict.message);
				return;
			}

			const selected = users.filter((user) => verdict.userIds.includes(user.id));
			const candidates = users.filter((user) => !verdict.userIds.includes(user.id));
			const schema = await getSchema();
			const references = (
				await listUserReferences(database, schema, verdict.userIds, candidates.length > 0, logger)
			).filter((reference) => reference.count > 0);

			res.json({
				data: {
					users: selected,
					references,
					reassignCandidates: candidates,
				},
			});
		} catch (error: any) {
			logger.error(`[user-cleanup] inspect failed: ${error?.message || error}`);
			sendError(res, 500, error?.message || 'Inspect failed');
		}
	});

	router.post('/delete', async (req: Request, res: Response) => {
		if (!requireAdmin(req, res)) return;

		try {
			const selfId = currentUserId(req);
			const users = await loadUsers(database, logger, selfId);
			const verdict = assertUsersDeletable({
				userIds: parseUserIds(req.body?.userIds),
				selfId,
				knownUserIds: new Set(users.map((user) => user.id)),
				adminIds: users.filter((user) => user.admin).map((user) => user.id),
			});
			if (!verdict.ok) {
				sendError(res, 400, verdict.message);
				return;
			}

			const resolutions = parseResolutions(req.body?.resolutions);
			const candidateIds = new Set(users.filter((user) => !verdict.userIds.includes(user.id)).map((user) => user.id));
			const schema = await getSchema();

			const result = await database.transaction(async (trx: any) => {
				let lock = trx('directus_users').whereIn('id', verdict.userIds).select('id');
				const client = getClientName(trx);
				const supportsRowLock =
					client.includes('pg') ||
					client.includes('postgres') ||
					client.includes('cockroach') ||
					client.includes('mysql') ||
					client.includes('maria') ||
					client.includes('mssql');
				if (supportsRowLock) lock = lock.forUpdate();
				const locked = await lock;
				if ((locked || []).length !== verdict.userIds.length) {
					throw Object.assign(new Error('One or more users were not found'), { statusCode: 404 });
				}

				const adminIds = await listAdminIds(trx, logger);
				if (selfId) adminIds.add(selfId);
				const remainingAdmins = [...adminIds].filter((id) => !verdict.userIds.includes(id));
				if (adminIds.size > 0 && remainingAdmins.length === 0) {
					throw Object.assign(new Error('Refusing to delete the last admin user'), { statusCode: 400 });
				}

				for (const targetId of candidateIds) {
					if (resolutions.some((resolution) => resolution.action === 'reassign' && resolution.reassignTo === targetId)) {
						const target = await trx('directus_users').where({ id: targetId }).first('id');
						if (!target) {
							throw Object.assign(new Error('The reassign target no longer exists'), { statusCode: 400 });
						}
					}
				}

				const discovered = await listUserReferences(trx, schema, verdict.userIds, candidateIds.size > 0, logger);
				const validation = validateResolutions(discovered as ValidatedReference[], resolutions, candidateIds);
				if (!validation.ok) {
					throw Object.assign(new Error(validation.message), { statusCode: 409 });
				}

				const applied: AppliedResolution[] = [];
				for (const resolution of sortResolutions(resolutions)) {
					if (resolution.action === 'skip') continue;
					const affected = await applyResolution(trx, resolution, verdict.userIds);
					applied.push({
						collection: resolution.collection,
						field: resolution.field,
						action: resolution.action,
						affected,
					});
				}

				const forced = await forceDeleteAuthRows(trx, verdict.userIds);
				for (const row of forced) {
					const existing = applied.find(
						(item) => item.collection === row.collection && item.field === row.field && item.action === 'delete_rows',
					);
					if (existing) existing.affected += row.affected;
					else applied.push(row);
				}

				const remaining = await listUserReferences(trx, schema, verdict.userIds, candidateIds.size > 0, logger);
				const blocking = remaining.filter((reference) => reference.blocks && reference.count > 0);
				if (blocking.length > 0) {
					const summary = blocking.map((reference) => `${reference.collection}.${reference.field} (${reference.count})`).join(', ');
					throw Object.assign(new Error(`References still block deletion: ${summary}`), { statusCode: 409 });
				}

				await trx('directus_users').whereIn('id', verdict.userIds).delete();
				return { deletedUserIds: verdict.userIds, applied };
			});

			logger.info(`[user-cleanup] Deleted ${result.deletedUserIds.length} user(s)`);
			res.json({ data: result });
		} catch (error: any) {
			const status = Number(error?.statusCode) || 500;
			logger.error(`[user-cleanup] delete failed: ${error?.message || error}`);
			sendError(res, status, error?.message || 'Delete failed');
		}
	});
};
