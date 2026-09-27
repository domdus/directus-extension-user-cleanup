import {
	allowedActions,
	isSafeIdentifier,
	normalizeOnDelete,
	referenceBlocks,
	referenceKey,
	referenceKind,
	suggestedAction,
	type ReferenceInput,
} from './policy';
import type { Resolution, UserReference } from './types';

type SchemaLike = {
	collections?: Record<
		string,
		{
			fields?: Record<string, { type?: string | null; nullable?: boolean | null; alias?: boolean | null }>;
		}
	>;
	relations?: Array<{
		collection?: string | null;
		field?: string | null;
		related_collection?: string | null;
		meta?: { junction_field?: string | null } | null;
		schema?: { foreign_key_table?: string | null; on_delete?: string | null } | null;
	}>;
};

type CatalogForeignKey = {
	collection: string;
	field: string;
	nullable: boolean;
	onDelete: string;
};

type DiscoveredForeignKey = CatalogForeignKey & {
	junction: boolean;
};

const KNOWN_NULLABLE = new Set([
	'directus_files.uploaded_by',
	'directus_files.modified_by',
	'directus_activity.user',
	'directus_notifications.sender',
	'directus_shares.user_created',
	'directus_comments.user_created',
	'directus_comments.user_updated',
	'directus_versions.user_created',
	'directus_versions.user_updated',
	'directus_flows.user_created',
	'directus_operations.user_created',
	'directus_dashboards.user_created',
	'directus_panels.user_created',
	'directus_folders.user_created',
]);

export function getClientName(database: any): string {
	const client = database?.client?.config?.client ?? database?.client?.driverName ?? '';
	return String(client).toLowerCase();
}

function rawRows(result: unknown): any[] {
	if (!result) return [];
	if (Array.isArray(result)) {
		if (result.length > 0 && Array.isArray(result[0])) return result[0];
		return result;
	}
	if (typeof result === 'object') {
		const record = result as { rows?: unknown; recordset?: unknown };
		if (Array.isArray(record.rows)) return record.rows;
		if (Array.isArray(record.recordset)) return record.recordset;
	}
	return [];
}

function junctionCollections(schema: SchemaLike): Set<string> {
	const junctions = new Set<string>();
	for (const relation of schema.relations || []) {
		if (relation.meta?.junction_field && relation.collection) junctions.add(relation.collection);
	}
	return junctions;
}

function isAliasField(schema: SchemaLike, collection: string, field: string): boolean {
	const overview = schema.collections?.[collection]?.fields?.[field];
	if (!overview) return false;
	return overview.alias === true || overview.type === 'alias';
}

function schemaNullable(schema: SchemaLike, collection: string, field: string): boolean | null {
	const value = schema.collections?.[collection]?.fields?.[field]?.nullable;
	if (typeof value === 'boolean') return value;
	const key = referenceKey(collection, field);
	if (KNOWN_NULLABLE.has(key)) return true;
	return null;
}

function readTotal(row: Record<string, unknown>): number {
	const value = row.total ?? row.TOTAL ?? row.count ?? row.COUNT ?? row['count(*)'];
	const parsed = Number(value ?? 0);
	return Number.isFinite(parsed) ? parsed : 0;
}

function affectedCount(result: unknown): number {
	if (typeof result === 'number') return result;
	if (Array.isArray(result)) {
		const first = result[0];
		if (typeof first === 'number') return first;
	}
	const parsed = Number(result ?? 0);
	return Number.isFinite(parsed) ? parsed : 0;
}

async function listPostgresForeignKeys(database: any): Promise<CatalogForeignKey[]> {
	const result = await database.raw(`
		SELECT
			kcu.table_name AS table_name,
			kcu.column_name AS column_name,
			rc.delete_rule AS on_delete,
			col.is_nullable AS is_nullable
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name
			AND tc.table_schema = kcu.table_schema
		JOIN information_schema.referential_constraints rc
			ON rc.constraint_name = tc.constraint_name
			AND rc.constraint_schema = tc.table_schema
		JOIN information_schema.constraint_column_usage ccu
			ON ccu.constraint_name = tc.constraint_name
			AND ccu.table_schema = tc.table_schema
		JOIN information_schema.columns col
			ON col.table_schema = kcu.table_schema
			AND col.table_name = kcu.table_name
			AND col.column_name = kcu.column_name
		WHERE tc.constraint_type = 'FOREIGN KEY'
			AND tc.table_schema = current_schema()
			AND ccu.table_name = 'directus_users'
			AND kcu.position_in_unique_constraint IS NOT NULL
	`);

	return rawRows(result)
		.map((row) => ({
			collection: String(row.table_name || ''),
			field: String(row.column_name || ''),
			nullable: String(row.is_nullable || '').toUpperCase() === 'YES',
			onDelete: normalizeOnDelete(row.on_delete),
		}))
		.filter((row) => isSafeIdentifier(row.collection) && isSafeIdentifier(row.field));
}

async function listMysqlForeignKeys(database: any): Promise<CatalogForeignKey[]> {
	const result = await database.raw(`
		SELECT
			kcu.TABLE_NAME AS table_name,
			kcu.COLUMN_NAME AS column_name,
			rc.DELETE_RULE AS on_delete,
			col.IS_NULLABLE AS is_nullable
		FROM information_schema.KEY_COLUMN_USAGE kcu
		JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
			ON rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
			AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
		JOIN information_schema.COLUMNS col
			ON col.TABLE_SCHEMA = kcu.TABLE_SCHEMA
			AND col.TABLE_NAME = kcu.TABLE_NAME
			AND col.COLUMN_NAME = kcu.COLUMN_NAME
		WHERE kcu.REFERENCED_TABLE_NAME = 'directus_users'
			AND kcu.TABLE_SCHEMA = DATABASE()
	`);

	return rawRows(result)
		.map((row) => ({
			collection: String(row.table_name || ''),
			field: String(row.column_name || ''),
			nullable: String(row.is_nullable || '').toUpperCase() === 'YES',
			onDelete: normalizeOnDelete(row.on_delete),
		}))
		.filter((row) => isSafeIdentifier(row.collection) && isSafeIdentifier(row.field));
}

async function listMssqlForeignKeys(database: any): Promise<CatalogForeignKey[]> {
	const result = await database.raw(`
		SELECT
			OBJECT_NAME(fkc.parent_object_id) AS table_name,
			COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS column_name,
			fk.delete_referential_action_desc AS on_delete,
			c.is_nullable AS is_nullable
		FROM sys.foreign_keys fk
		INNER JOIN sys.foreign_key_columns fkc
			ON fkc.constraint_object_id = fk.object_id
		INNER JOIN sys.columns c
			ON c.object_id = fkc.parent_object_id
			AND c.column_id = fkc.parent_column_id
		INNER JOIN sys.tables rt
			ON rt.object_id = fk.referenced_object_id
		WHERE rt.name = 'directus_users'
	`);

	return rawRows(result)
		.map((row) => ({
			collection: String(row.table_name || ''),
			field: String(row.column_name || ''),
			nullable: row.is_nullable === true || row.is_nullable === 1,
			onDelete: normalizeOnDelete(row.on_delete),
		}))
		.filter((row) => isSafeIdentifier(row.collection) && isSafeIdentifier(row.field));
}

async function listSqliteForeignKeys(database: any): Promise<CatalogForeignKey[]> {
	const tables = rawRows(
		await database.raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`),
	);
	const found: CatalogForeignKey[] = [];

	for (const table of tables) {
		const name = String(table.name || '');
		if (!isSafeIdentifier(name)) continue;

		const foreignKeys = rawRows(await database.raw('PRAGMA foreign_key_list(??)', [name]));
		if (foreignKeys.length === 0) continue;

		const columns = rawRows(await database.raw('PRAGMA table_info(??)', [name]));
		const nullableByColumn = new Map<string, boolean>();
		for (const column of columns) {
			nullableByColumn.set(String(column.name), Number(column.notnull) === 0);
		}

		for (const foreignKey of foreignKeys) {
			if (String(foreignKey.table) !== 'directus_users') continue;
			const field = String(foreignKey.from || '');
			if (!isSafeIdentifier(field)) continue;
			found.push({
				collection: name,
				field,
				nullable: nullableByColumn.get(field) ?? false,
				onDelete: normalizeOnDelete(foreignKey.on_delete || 'NO ACTION'),
			});
		}
	}

	return found;
}

async function listCatalogForeignKeys(database: any, logger?: { warn: (message: string) => void }): Promise<CatalogForeignKey[]> {
	const client = getClientName(database);
	try {
		if (client.includes('pg') || client.includes('postgres') || client.includes('cockroach')) {
			return await listPostgresForeignKeys(database);
		}
		if (client.includes('mysql') || client.includes('maria')) {
			return await listMysqlForeignKeys(database);
		}
		if (client.includes('mssql') || client.includes('tedious')) {
			return await listMssqlForeignKeys(database);
		}
		if (client.includes('sqlite')) {
			return await listSqliteForeignKeys(database);
		}
	} catch (error: any) {
		logger?.warn(`[user-cleanup] Could not read foreign keys from the database catalog: ${error?.message || error}`);
	}
	return [];
}

function listSchemaForeignKeys(schema: SchemaLike): DiscoveredForeignKey[] {
	const junctions = junctionCollections(schema);
	const found: DiscoveredForeignKey[] = [];

	for (const relation of schema.relations || []) {
		const related = relation.related_collection || relation.schema?.foreign_key_table || null;
		if (related !== 'directus_users') continue;
		const collection = String(relation.collection || '');
		const field = String(relation.field || '');
		if (!isSafeIdentifier(collection) || !isSafeIdentifier(field)) continue;
		if (isAliasField(schema, collection, field)) continue;

		const nullable = schemaNullable(schema, collection, field);
		found.push({
			collection,
			field,
			nullable: nullable ?? false,
			onDelete: relation.schema ? normalizeOnDelete(relation.schema.on_delete || 'NO ACTION') : 'NONE',
			junction: junctions.has(collection),
		});
	}

	return found;
}

export async function discoverUserForeignKeys(
	database: any,
	schema: SchemaLike,
	logger?: { warn: (message: string) => void },
): Promise<DiscoveredForeignKey[]> {
	const junctions = junctionCollections(schema);
	const merged = new Map<string, DiscoveredForeignKey>();

	for (const reference of listSchemaForeignKeys(schema)) {
		merged.set(referenceKey(reference.collection, reference.field), reference);
	}

	for (const reference of await listCatalogForeignKeys(database, logger)) {
		const key = referenceKey(reference.collection, reference.field);
		const existing = merged.get(key);
		if (!existing) {
			merged.set(key, {
				...reference,
				junction: junctions.has(reference.collection),
			});
			continue;
		}
		existing.nullable = reference.nullable;
		existing.onDelete = reference.onDelete;
		existing.junction = existing.junction || junctions.has(reference.collection);
	}

	return [...merged.values()].sort((a, b) => {
		const aSystem = a.collection.startsWith('directus_') ? 0 : 1;
		const bSystem = b.collection.startsWith('directus_') ? 0 : 1;
		if (aSystem !== bSystem) return aSystem - bSystem;
		const byCollection = a.collection.localeCompare(b.collection);
		if (byCollection !== 0) return byCollection;
		return a.field.localeCompare(b.field);
	});
}

async function countByUser(
	database: any,
	collection: string,
	field: string,
	userIds: string[],
): Promise<Record<string, number>> {
	const rows = await database(collection).select(field).whereIn(field, userIds).count({ total: '*' }).groupBy(field);
	const counts: Record<string, number> = {};
	for (const row of rows || []) {
		const id = row[field];
		if (id == null) continue;
		counts[String(id)] = readTotal(row);
	}
	return counts;
}

export async function listUserReferences(
	database: any,
	schema: SchemaLike,
	userIds: string[],
	hasReassignTarget: boolean,
	logger?: { warn: (message: string) => void },
): Promise<UserReference[]> {
	const discovered = await discoverUserForeignKeys(database, schema, logger);
	const references: UserReference[] = [];

	for (const foreignKey of discovered) {
		let countsByUser: Record<string, number> = {};
		try {
			countsByUser = await countByUser(database, foreignKey.collection, foreignKey.field, userIds);
		} catch (error: any) {
			logger?.warn(
				`[user-cleanup] Skipped ${foreignKey.collection}.${foreignKey.field}: ${error?.message || error}`,
			);
			continue;
		}

		const count = Object.values(countsByUser).reduce((sum, value) => sum + value, 0);
		const input: ReferenceInput = {
			collection: foreignKey.collection,
			field: foreignKey.field,
			nullable: foreignKey.nullable,
			onDelete: foreignKey.onDelete,
			junction: foreignKey.junction,
		};

		references.push({
			...input,
			kind: referenceKind(input),
			count,
			blocks: referenceBlocks(input),
			countsByUser,
			allowedActions: allowedActions(input),
			suggestedAction: suggestedAction(input, hasReassignTarget),
		});
	}

	return references;
}

export async function applyResolution(database: any, resolution: Resolution, userIds: string[]): Promise<number> {
	if (resolution.action === 'skip') return 0;
	if (!isSafeIdentifier(resolution.collection) || !isSafeIdentifier(resolution.field)) {
		throw new Error('Invalid collection or field');
	}
	if (resolution.action === 'delete_rows' && (resolution.collection === 'directus_users' || resolution.collection === 'directus_files')) {
		throw new Error(`Refusing to delete rows from ${resolution.collection}`);
	}

	const query = database(resolution.collection).whereIn(resolution.field, userIds);
	if (resolution.action === 'null') return affectedCount(await query.update({ [resolution.field]: null }));
	if (resolution.action === 'delete_rows') return affectedCount(await query.delete());
	if (resolution.action === 'reassign') {
		return affectedCount(await query.update({ [resolution.field]: resolution.reassignTo }));
	}
	throw new Error('Unknown resolution action');
}
