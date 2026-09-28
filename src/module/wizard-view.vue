<template>
	<private-view title="User Cleanup" icon="person_remove">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'User Cleanup', to: '/user-cleanup' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="About">
				<p class="sidebar-text">
					Directus user delete fails while any row still points at that user. This wizard lists those
					references, lets you clear or reassign them, then deletes the user. Files and other content stay
					in place.
				</p>
			</sidebar-detail>
			<sidebar-detail id="resolutions" icon="tune" title="Resolutions">
				<p class="sidebar-text">
					<strong>Set Null</strong> keeps the row and clears the user.
					<strong>Reassign</strong> points it at someone else.
					<strong>Delete Rows</strong> is only offered for sessions, access, presets, inbox notifications,
					and M2M junction links.
				</p>
				<p class="sidebar-text">
					Nothing is written until you confirm. Sessions, access grants, and inbox notifications are always
					removed with the user.
				</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-divider
				class="section-divider"
				large
				:inline-title="false"
				:style="{ '--v-divider-color': 'var(--theme--border-color-subdued)' }"
			>
				<template #icon><v-icon name="person_remove" /></template>
				Wizard
			</v-divider>

			<p class="page-intro">
				Select users, review what still points at them, choose how to resolve each reference, then delete.
				Nothing is changed until you confirm.
			</p>

			<div class="steps">
				<div class="step" :class="{ active: step === 0 && !incoming, done: step > 0 }">1. Select</div>
				<div class="step" :class="{ active: step === 1 || incoming, done: step > 1 }">2. Inspect</div>
				<div class="step" :class="{ active: step === 2, done: step > 2 }">3. Resolve</div>
				<div class="step" :class="{ active: step === 3 }">4. Delete</div>
			</div>

			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<v-notice v-if="notice" :type="notice.type" class="notice">{{ notice.text }}</v-notice>

			<div v-if="incoming" class="incoming">
				<v-progress-circular indeterminate />
				<p>Inspecting references…</p>
			</div>

			<template v-else-if="step === 0">
				<div class="toolbar">
					<v-input v-model="search" class="search" placeholder="Filter Users…" :nullable="false" />
					<div class="scope-radios">
						<v-radio v-model="statusScope" value="all" label="All" />
						<v-radio v-model="statusScope" value="active" label="Active" />
						<v-radio v-model="statusScope" value="inactive" label="Inactive" />
					</div>
					<div class="toolbar-actions">
						<v-button secondary small :disabled="selectableFiltered.length === 0" @click="selectFiltered">
							Select Filtered
						</v-button>
						<v-button secondary small :disabled="selected.size === 0" @click="selected.clear()">
							Clear
						</v-button>
					</div>
				</div>

				<v-notice v-if="selected.size > MAX_USERS" type="warning" class="notice">
					Select at most {{ MAX_USERS }} users at a time.
				</v-notice>
				<v-notice v-else-if="removesLastAdmin" type="warning" class="notice">
					This selection includes every admin. Your own user cannot be deleted, and at least one admin has to
					remain.
				</v-notice>

				<v-progress-circular v-if="loading" indeterminate />

				<div v-else class="table">
					<div class="row head">
						<span class="col check"></span>
						<span class="col name">User</span>
						<span class="col email">Email</span>
						<span class="col status">Status</span>
						<span class="col access">Access</span>
					</div>
					<div v-for="user in filtered" :key="user.id" class="row">
						<span class="col check">
							<v-checkbox
								:model-value="selected.has(user.id)"
								:disabled="user.self"
								@update:model-value="toggle(user, $event)"
							/>
						</span>
						<span class="col name">{{ personName(user) }}</span>
						<span class="col email">
							<code v-if="user.email">{{ user.email }}</code>
							<span v-else class="muted">—</span>
						</span>
						<span class="col status">{{ statusLabel(user.status) }}</span>
						<span class="col access">
							<v-chip v-if="user.self" small>You</v-chip>
							<v-chip v-else-if="user.admin" small>Admin</v-chip>
							<span v-else class="muted">User</span>
						</span>
					</div>
					<p v-if="filtered.length === 0" class="empty">No users match the current filters.</p>
				</div>

				<div class="footer">
					<span class="muted">{{ selected.size }} Selected</span>
					<v-button :disabled="!canInspect" :loading="busyKey === 'inspect'" @click="runInspect">
						Inspect Selected
					</v-button>
				</div>
			</template>

			<template v-else-if="step === 1">
				<v-notice v-if="inspectReferences.length === 0" type="info" class="notice">
					Nothing points at the selected users. You can delete them directly.
				</v-notice>
				<v-notice v-else-if="blockingCount > 0" type="warning" class="notice">
					{{ blockingCount }} reference{{ blockingCount === 1 ? '' : 's' }} block deletion until you resolve
					them. Files stay in the library.
				</v-notice>
				<v-notice v-else type="info" class="notice">
					These references do not block deletion. You can still clear or reassign them before the user is
					removed. Files stay in the library.
				</v-notice>

				<div v-if="inspectReferences.length > 0" class="table">
					<div class="row head refs">
						<span class="col name">Reference</span>
						<span class="col badge">Kind</span>
						<span class="col fields">Items</span>
						<span class="col status">On Delete</span>
						<span class="col access">Blocking</span>
					</div>
					<div v-for="reference in inspectReferences" :key="referenceKey(reference)" class="row refs">
						<span class="col name">
							<code>{{ reference.collection }}.{{ reference.field }}</code>
						</span>
						<span class="col badge">
							<v-chip small>{{ kindLabel(reference.kind) }}</v-chip>
						</span>
						<span class="col fields">{{ reference.count }}</span>
						<span class="col status">{{ onDeleteLabel(reference.onDelete) }}</span>
						<span class="col access">
							<span v-if="reference.blocks" class="bad">Yes</span>
							<span v-else class="ok">No</span>
						</span>
					</div>
				</div>

				<div class="footer">
					<v-button secondary @click="step = 0">Back</v-button>
					<v-button v-if="inspectReferences.length > 0" @click="step = 2">Resolve References</v-button>
					<v-button v-else @click="step = 3">Continue To Delete</v-button>
				</div>
			</template>

			<template v-else-if="step === 2">
				<v-notice v-if="hasFileReferences" type="warning" class="notice">
					Files stay in the library. Set Null or Reassign only changes who uploaded or edited them. Delete
					Rows removes personal records and M2M links, not the related content.
				</v-notice>

				<div class="toolbar">
					<div class="scope-radios">
						<v-radio v-model="referenceScope" value="all" :label="`All (${inspectReferences.length})`" />
						<v-radio v-model="referenceScope" value="blocking" :label="`Blocking (${blockingCount})`" />
						<v-radio
							v-model="referenceScope"
							value="open"
							:label="`Not blocking (${inspectReferences.length - blockingCount})`"
						/>
					</div>
				</div>

				<div v-if="needsReassignTarget" class="toolbar">
					<label class="muted">Reassign To</label>
					<v-select v-model="reassignTo" class="user-select" :items="reassignItems" placeholder="Select a user" />
				</div>
				<v-notice v-if="needsReassignTarget && reassignCandidates.length === 0" type="danger" class="notice">
					A required reference needs another user, and there is no one left to receive it.
				</v-notice>

				<div class="results">
					<div v-for="reference in visibleReferences" :key="referenceKey(reference)" class="result-card">
						<div class="result-head">
							<code>{{ reference.collection }}.{{ reference.field }}</code>
							<span class="muted">{{ itemCountLabel(reference.count) }}</span>
							<v-chip small>{{ kindLabel(reference.kind) }}</v-chip>
							<v-chip v-if="reference.blocks" small class="bad-chip">Blocking</v-chip>
							<v-chip v-else small class="ok-chip">Not blocking</v-chip>
						</div>
						<p v-if="countSummary(reference)" class="hint muted">{{ countSummary(reference) }}</p>
						<div class="resolve-row">
							<v-select
								v-if="reference.allowedActions.length > 1"
								class="action-select"
								:full-width="false"
								:model-value="actionFor(reference)"
								:items="actionItems(reference)"
								@update:model-value="setAction(reference, $event)"
							/>
							<span v-else>{{ actionLabel(actionFor(reference)) }}</span>
						</div>
						<p class="hint muted">{{ actionHint(reference, actionFor(reference)) }}</p>
					</div>
					<p v-if="visibleReferences.length === 0" class="empty">No references match this filter.</p>
				</div>

				<div class="footer">
					<v-button secondary @click="step = 1">Back</v-button>
					<v-button :disabled="!canContinue" @click="step = 3">Continue To Delete</v-button>
				</div>
			</template>

			<template v-else>
				<v-notice type="warning" class="notice">
					This deletes the selected users after the resolutions below are applied. Sessions, access grants,
					and inbox notifications are removed with them. Files and other content stay.
				</v-notice>
				<v-notice v-if="deletingOtherAdmins" type="warning" class="notice">
					This selection includes other admin users.
				</v-notice>

				<div class="results">
					<div v-for="user in inspectedUsers" :key="user.id" class="result-card">
						<div class="result-head">
							<strong>{{ personName(user) }}</strong>
							<code v-if="user.email">{{ user.email }}</code>
							<v-chip v-if="user.admin" small>Admin</v-chip>
						</div>
					</div>
					<div v-for="reference in plannedResolutions" :key="referenceKey(reference)" class="result-card">
						<div class="result-head">
							<code>{{ reference.collection }}.{{ reference.field }}</code>
							<span class="muted">{{ itemCountLabel(reference.count) }}</span>
							<span>{{ actionLabel(actionFor(reference)) }}</span>
							<span v-if="actionFor(reference) === 'reassign'" class="muted">→ {{ reassignLabel }}</span>
						</div>
					</div>
					<p v-if="plannedResolutions.length === 0" class="empty">No references to update.</p>
				</div>

				<div class="footer">
					<v-button secondary @click="step = inspectReferences.length > 0 ? 2 : 1">Back</v-button>
					<v-button
						kind="danger"
						:loading="busyKey === 'delete'"
						:disabled="!canContinue"
						@click="runDelete"
					>
						Delete {{ inspectedUsers.length }} User{{ inspectedUsers.length === 1 ? '' : 's' }}
					</v-button>
				</div>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { MAX_USERS } from '../shared/config';
import type { CleanupUser, ReferenceAction, ReferenceKind, UserReference } from '../shared/types';
import ModuleNavigation from './navigation.vue';
import { usePageClass } from './composables/use-page-class';
import { useUserCleanup } from './composables/use-user-cleanup';

const ACTION_LABELS: Record<ReferenceAction, string> = {
	null: 'Set Null',
	reassign: 'Reassign',
	delete_rows: 'Delete Rows',
	skip: 'Leave As Is',
};

const KIND_LABELS: Record<ReferenceKind, string> = {
	auth: 'Access',
	inbox: 'Inbox',
	preset: 'Presets',
	junction: 'Junction',
	system: 'System',
	content: 'Content',
};

const pageClass = usePageClass();
const { loading, error, users, loadUsers, inspect, deleteUsers } = useUserCleanup();

const step = ref(0);
const incoming = ref(queryUserIds().length > 0);
const search = ref('');
const statusScope = ref<'all' | 'active' | 'inactive'>('all');
const selected = reactive(new Set<string>());
const busyKey = ref<string | null>(null);
const notice = ref<{ type: 'success' | 'warning' | 'info' | 'danger'; text: string } | null>(null);

const inspectedUsers = ref<CleanupUser[]>([]);
const inspectReferences = ref<UserReference[]>([]);
const reassignCandidates = ref<CleanupUser[]>([]);
const resolutionActions = reactive<Record<string, ReferenceAction>>({});
const reassignTo = ref('');
const referenceScope = ref<'all' | 'blocking' | 'open'>('all');

const filtered = computed(() => {
	const query = String(search.value ?? '').trim().toLowerCase();
	return users.value.filter((user) => {
		if (statusScope.value === 'active' && user.status !== 'active') return false;
		if (statusScope.value === 'inactive' && user.status === 'active') return false;
		if (!query) return true;
		const haystack = [user.email, user.firstName, user.lastName, user.id].filter(Boolean).join(' ').toLowerCase();
		return haystack.includes(query);
	});
});

const selectableFiltered = computed(() => filtered.value.filter((user) => !user.self));

const removesLastAdmin = computed(() => {
	const admins = users.value.filter((user) => user.admin);
	if (admins.length === 0) return false;
	return admins.every((user) => selected.has(user.id));
});

const canInspect = computed(
	() => selected.size > 0 && selected.size <= MAX_USERS && !removesLastAdmin.value,
);

const blockingCount = computed(() => inspectReferences.value.filter((reference) => reference.blocks).length);

const visibleReferences = computed(() =>
	inspectReferences.value.filter((reference) => {
		if (referenceScope.value === 'blocking') return reference.blocks;
		if (referenceScope.value === 'open') return !reference.blocks;
		return true;
	}),
);

const hasFileReferences = computed(() =>
	inspectReferences.value.some((reference) => reference.collection === 'directus_files'),
);

const needsReassignTarget = computed(() =>
	inspectReferences.value.some((reference) => actionFor(reference) === 'reassign'),
);

const canContinue = computed(() => {
	if (removesLastAdmin.value) return false;
	if (needsReassignTarget.value && !reassignTo.value) return false;
	return true;
});

const deletingOtherAdmins = computed(() => inspectedUsers.value.some((user) => user.admin));

const reassignItems = computed(() =>
	[...reassignCandidates.value]
		.sort((a, b) => Number(b.self) - Number(a.self) || personName(a).localeCompare(personName(b)))
		.map((user) => ({
			text: optionLabel(user),
			value: user.id,
		})),
);

const reassignLabel = computed(() => {
	const match = reassignCandidates.value.find((user) => user.id === reassignTo.value);
	return match ? personName(match) : 'Selected user';
});

const plannedResolutions = computed(() =>
	inspectReferences.value.filter((reference) => actionFor(reference) !== 'skip'),
);

function referenceKey(reference: Pick<UserReference, 'collection' | 'field'>): string {
	return `${reference.collection}.${reference.field}`;
}

function personName(user: CleanupUser): string {
	const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
	return name || user.email || user.id;
}

function optionLabel(user: CleanupUser): string {
	const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
	const who = name && user.email ? `${name} (${user.email})` : personName(user);
	return user.self ? `${who} (You)` : who;
}

function statusLabel(status: string | null): string {
	if (!status) return 'Unknown';
	return status.charAt(0).toUpperCase() + status.slice(1);
}

function kindLabel(kind: ReferenceKind): string {
	return KIND_LABELS[kind];
}

function onDeleteLabel(value: string): string {
	if (value === 'NONE') return 'No Constraint';
	return value;
}

function itemCountLabel(count: number): string {
	return `${count} Item${count === 1 ? '' : 's'}`;
}

function actionLabel(action: ReferenceAction): string {
	return ACTION_LABELS[action];
}

function actionFor(reference: UserReference): ReferenceAction {
	return resolutionActions[referenceKey(reference)] || reference.suggestedAction;
}

function actionItems(reference: UserReference) {
	return reference.allowedActions.map((action) => ({ text: ACTION_LABELS[action], value: action }));
}

function setAction(reference: UserReference, action: ReferenceAction) {
	resolutionActions[referenceKey(reference)] = action;
}

function actionHint(reference: UserReference, action: ReferenceAction): string {
	if (action === 'null') {
		if (reference.collection === 'directus_files') return 'Keeps the file and clears this user.';
		return 'Keeps the row and clears this user.';
	}
	if (action === 'reassign') return 'Points the row at the user selected above.';
	if (action === 'delete_rows') {
		if (reference.kind === 'junction') return 'Removes the link row. The related item stays.';
		return 'Removes these rows.';
	}
	if (reference.onDelete === 'SET NULL') return 'The database clears this user when the account is deleted.';
	return 'Leaves the stored user id as it is.';
}

function countSummary(reference: UserReference): string {
	const parts = Object.entries(reference.countsByUser)
		.filter(([, count]) => count > 0)
		.map(([id, count]) => {
			const user = inspectedUsers.value.find((item) => item.id === id);
			return `${user ? personName(user) : id} ×${count}`;
		});
	if (parts.length <= 1) return '';
	return parts.join(', ');
}

function toggle(user: CleanupUser, value: boolean) {
	if (user.self) return;
	if (value) selected.add(user.id);
	else selected.delete(user.id);
}

function selectFiltered() {
	for (const user of selectableFiltered.value) selected.add(user.id);
}

function errorMessage(err: any, fallback: string): string {
	return err?.response?.data?.errors?.[0]?.message || err?.message || fallback;
}

function applySuggestions(references: UserReference[]) {
	for (const key of Object.keys(resolutionActions)) delete resolutionActions[key];
	for (const reference of references) {
		resolutionActions[referenceKey(reference)] = reference.suggestedAction;
	}
	if (reassignTo.value && !reassignCandidates.value.some((user) => user.id === reassignTo.value)) {
		reassignTo.value = '';
	}
}

function queryUserIds(): string[] {
	const raw = new URLSearchParams(window.location.search).get('users') || '';
	return [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))];
}

async function applyIncomingSelection() {
	const ids = queryUserIds();
	if (ids.length === 0) return;
	selected.clear();
	for (const id of ids) {
		const user = users.value.find((item) => item.id === id);
		if (user && !user.self) selected.add(user.id);
	}
	if (selected.size > 0) await runInspect();
}

async function runInspect() {
	notice.value = null;
	busyKey.value = 'inspect';
	try {
		const result = await inspect([...selected]);
		inspectedUsers.value = result.users || [];
		inspectReferences.value = result.references || [];
		reassignCandidates.value = result.reassignCandidates || [];
		applySuggestions(inspectReferences.value);
		step.value = 1;
	} catch (err: any) {
		notice.value = { type: 'danger', text: errorMessage(err, 'Inspect failed') };
	} finally {
		busyKey.value = null;
	}
}

async function runDelete() {
	notice.value = null;
	busyKey.value = 'delete';
	try {
		const userIds = inspectedUsers.value.map((user) => user.id);
		const resolutions = inspectReferences.value.map((reference) => {
			const action = actionFor(reference);
			return {
				collection: reference.collection,
				field: reference.field,
				action,
				reassignTo: action === 'reassign' ? reassignTo.value : null,
			};
		});
		const result = await deleteUsers(userIds, resolutions);
		const count = result.deletedUserIds?.length || userIds.length;
		selected.clear();
		inspectedUsers.value = [];
		inspectReferences.value = [];
		step.value = 0;
		notice.value = {
			type: 'success',
			text: `Deleted ${count} user${count === 1 ? '' : 's'}.`,
		};
	} catch (err: any) {
		notice.value = { type: 'danger', text: errorMessage(err, 'Delete failed') };
	} finally {
		busyKey.value = null;
	}

	if (notice.value?.type === 'success') await loadUsers();
}

onMounted(async () => {
	try {
		await loadUsers();
		await applyIncomingSelection();
	} finally {
		incoming.value = false;
	}
});
</script>

<style scoped>
.page-container {
	padding: var(--content-padding);
	padding-block-end: var(--content-padding-bottom);
	max-inline-size: 67.5rem;
}

.page-container--flush-top {
	padding-block-start: 0;
}

.section-divider {
	margin-bottom: 12px;
}

.page-intro,
.sidebar-text {
	margin: 0 0 24px;
	line-height: 1.55;
	color: var(--theme--foreground);
}

.sidebar-text code {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 0.9em;
}

.steps {
	display: flex;
	gap: 8px;
	margin: 20px 0;
	flex-wrap: wrap;
}

.step {
	padding: 6px 12px;
	border-radius: var(--theme--border-radius);
	background: var(--theme--background-normal);
	color: var(--theme--foreground-subdued);
	font-size: 13px;
}

.step.active {
	background: var(--theme--primary);
	color: var(--foreground-inverted, #fff);
}

.step.done {
	background: var(--theme--background-accent);
	color: var(--theme--foreground);
}

.toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 12px 16px;
	align-items: center;
	margin-bottom: 16px;
}

.toolbar .search {
	max-width: 240px;
	flex: 0 1 240px;
}

.scope-radios {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	align-items: center;
}

.toolbar-actions {
	display: flex;
	gap: 8px;
	margin-left: auto;
}

.table {
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.row {
	display: grid;
	grid-template-columns: 40px minmax(140px, 1.3fr) minmax(180px, 1.6fr) 110px 100px;
	gap: 8px;
	align-items: center;
	padding: 10px 12px;
	border-bottom: 1px solid var(--theme--border-color-subdued);
}

.row.refs {
	grid-template-columns: minmax(220px, 1.8fr) 110px 80px minmax(120px, 1fr) 90px;
}

.row.head {
	background: var(--theme--background-normal);
	font-size: 12px;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--theme--foreground-subdued);
}

.row:last-child {
	border-bottom: none;
}

code {
	font-size: 13px;
}

.muted {
	color: var(--theme--foreground-subdued);
}

.ok {
	color: var(--theme--success);
}

.bad {
	color: var(--theme--danger);
}

.empty {
	padding: 24px;
	text-align: center;
	color: var(--theme--foreground-subdued);
}

.incoming {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;
	padding: 48px 24px;
	color: var(--theme--foreground-subdued);
}

.incoming p {
	margin: 0;
}

.footer {
	display: flex;
	justify-content: flex-end;
	align-items: center;
	gap: 12px;
	margin-top: 20px;
}

.notice {
	margin-bottom: 16px;
}

.results {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.result-card {
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	padding: 12px 14px;
}

.result-head {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	align-items: center;
}

.resolve-row {
	margin-top: 12px;
}

.resolve-row :deep(.v-input) {
	inline-size: 13rem;
	max-inline-size: 100%;
}

.user-select {
	max-width: 360px;
	flex: 1 1 240px;
}

.hint {
	margin: 8px 0 0;
	font-size: 13px;
	line-height: 1.45;
}

.bad-chip {
	--v-chip-color: var(--theme--danger);
}

.ok-chip {
	--v-chip-color: var(--theme--success);
}
</style>
