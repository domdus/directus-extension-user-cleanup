import assert from 'node:assert/strict';
import {
	allowedActions,
	assertUsersDeletable,
	normalizeOnDelete,
	referenceBlocks,
	referenceKind,
	suggestedAction,
	validateResolutions,
	type ReferenceInput,
	type ValidatedReference,
} from './policy';

function ref(partial: Partial<ReferenceInput> & Pick<ReferenceInput, 'collection' | 'field'>): ReferenceInput {
	return {
		nullable: false,
		onDelete: 'NO ACTION',
		junction: false,
		...partial,
	};
}

function validated(input: ReferenceInput, count = 1): ValidatedReference {
	return {
		...input,
		count,
		blocks: referenceBlocks(input),
		allowedActions: allowedActions(input),
	};
}

const files = ref({ collection: 'directus_files', field: 'uploaded_by', nullable: true, onDelete: 'NO ACTION' });
assert.equal(referenceBlocks(files), true);
assert.deepEqual(allowedActions(files), ['null', 'reassign']);
assert.equal(suggestedAction(files, true), 'null');
assert.equal(referenceKind(files), 'system');

const cascadedFiles = ref({ collection: 'directus_files', field: 'uploaded_by', nullable: true, onDelete: 'CASCADE' });
assert.equal(referenceBlocks(cascadedFiles), true);
assert.equal(allowedActions(cascadedFiles).includes('skip'), false);

const sessions = ref({ collection: 'directus_sessions', field: 'user', nullable: false, onDelete: 'CASCADE' });
assert.equal(referenceBlocks(sessions), false);
assert.deepEqual(allowedActions(sessions), ['delete_rows']);
assert.equal(suggestedAction(sessions, true), 'delete_rows');
assert.equal(referenceKind(sessions), 'auth');

const inbox = ref({ collection: 'directus_notifications', field: 'recipient', nullable: false });
assert.deepEqual(allowedActions(inbox), ['delete_rows']);
assert.equal(referenceKind(inbox), 'inbox');

const sender = ref({ collection: 'directus_notifications', field: 'sender', nullable: true, onDelete: 'SET NULL' });
assert.equal(referenceBlocks(sender), false);
assert.equal(allowedActions(sender).includes('delete_rows'), false);
assert.equal(suggestedAction(sender, true), 'skip');

const junction = ref({
	collection: 'articles_directus_users',
	field: 'directus_users_id',
	nullable: false,
	onDelete: 'NO ACTION',
	junction: true,
});
assert.equal(referenceBlocks(junction), true);
assert.equal(suggestedAction(junction, true), 'delete_rows');
assert.equal(allowedActions(junction).includes('reassign'), true);
assert.equal(allowedActions(junction).includes('null'), false);

const author = ref({ collection: 'articles', field: 'author', nullable: false, onDelete: 'RESTRICT' });
assert.equal(referenceKind(author), 'content');
assert.deepEqual(allowedActions(author), ['reassign']);
assert.equal(suggestedAction(author, false), 'reassign');

const activity = ref({ collection: 'directus_activity', field: 'user', nullable: true, onDelete: 'SET NULL' });
assert.equal(referenceKind(activity), 'system');
assert.equal(referenceBlocks(activity), false);
assert.equal(allowedActions(activity).includes('skip'), true);

const presets = ref({ collection: 'directus_presets', field: 'user', nullable: true, onDelete: 'NO ACTION' });
assert.equal(referenceKind(presets), 'preset');
assert.equal(allowedActions(presets).includes('reassign'), false);
assert.equal(allowedActions(presets).includes('delete_rows'), true);
assert.equal(suggestedAction(presets, true), 'delete_rows');

assert.equal(normalizeOnDelete('SET_NULL'), 'SET NULL');
assert.equal(normalizeOnDelete(''), 'NO ACTION');
assert.equal(normalizeOnDelete('none'), 'NONE');

const references = [validated(files), validated(sessions), validated(author), validated(activity, 2)];
const targets = new Set(['admin-2']);

assert.equal(
	validateResolutions(
		references,
		[
			{ collection: 'directus_files', field: 'uploaded_by', action: 'null' },
			{ collection: 'directus_sessions', field: 'user', action: 'delete_rows' },
			{ collection: 'articles', field: 'author', action: 'reassign', reassignTo: 'admin-2' },
		],
		targets,
	).ok,
	true,
);

const missing = validateResolutions(references, [], targets);
assert.equal(missing.ok, false);

const badNull = validateResolutions(
	references,
	[{ collection: 'directus_sessions', field: 'user', action: 'null' }],
	targets,
);
assert.equal(badNull.ok, false);

const badTarget = validateResolutions(
	[validated(author)],
	[{ collection: 'articles', field: 'author', action: 'reassign', reassignTo: 'missing' }],
	targets,
);
assert.equal(badTarget.ok, false);

const skipped = validateResolutions(
	[validated(activity)],
	[{ collection: 'directus_activity', field: 'user', action: 'skip' }],
	targets,
);
assert.equal(skipped.ok, true);

const unknown = validateResolutions(
	references,
	[{ collection: 'directus_files', field: 'title', action: 'null' }],
	targets,
);
assert.equal(unknown.ok, false);

const fileDelete = validateResolutions(
	[validated(files)],
	[{ collection: 'directus_files', field: 'uploaded_by', action: 'delete_rows' }],
	targets,
);
assert.equal(fileDelete.ok, false);

const selfDelete = assertUsersDeletable({
	userIds: ['self'],
	selfId: 'self',
	knownUserIds: new Set(['self']),
	adminIds: ['self'],
});
assert.equal(selfDelete.ok, false);

const lastAdmin = assertUsersDeletable({
	userIds: ['admin-2'],
	selfId: null,
	knownUserIds: new Set(['admin-2']),
	adminIds: ['admin-2'],
});
assert.equal(lastAdmin.ok, false);

const okDelete = assertUsersDeletable({
	userIds: ['former'],
	selfId: 'self',
	knownUserIds: new Set(['former', 'self']),
	adminIds: ['self'],
});
assert.equal(okDelete.ok, true);
if (okDelete.ok) assert.deepEqual(okDelete.userIds, ['former']);

console.log('policy tests passed');
